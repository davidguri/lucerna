<script lang="ts">
	import { onMount, onDestroy, createEventDispatcher } from 'svelte';
	import maplibregl from 'maplibre-gl';
	import * as turf from '@turf/turf';
	import { PUBLIC_MAP_TILER_API } from '$env/static/public';
	import type { AreaPayload } from './Sheet.view.svelte';

	const dispatch = createEventDispatcher<{ select: AreaPayload }>();
	let map: maplibregl.Map;

	// Basemap
	const styleUrl = `https://api.maptiler.com/maps/darkmatter/style.json?key=${PUBLIC_MAP_TILER_API}`;

	// Albania region with padding
	const CENTER_ALBANIA: [number, number] = [20.0, 41.3];
	const ALBANIA_BOUNDS: [[number, number], [number, number]] = [
		[18.0, 38.6], // Southwest corner with padding
		[22.1, 43.9]  // Northeast corner with padding
	];

	// ASIG endpoints / layer
	const WFS_BASE = 'https://geoportal.asig.gov.al/service/zrpp/wfs';
	const WMS_BASE = 'https://geoportal.asig.gov.al/service/zrpp/wms';
	const LAYER = 'zrpp:zona_kadastrale_qkd_042025';

	// ---------- Utils ----------
	function buildWfsUrl_V20() {
		const [[minX, minY], [maxX, maxY]] = ALBANIA_BOUNDS;
		const p = new URLSearchParams({
			service: 'WFS',
			request: 'GetFeature',
			version: '2.0.0',
			typeNames: LAYER,
			outputFormat: 'application/json',
			srsName: 'EPSG:4326',
			bbox: `${minX},${minY},${maxX},${maxY},EPSG:4326`
		});
		return `${WFS_BASE}?${p.toString()}`;
	}
	function buildWfsUrl_V11() {
		const [[minX, minY], [maxX, maxY]] = ALBANIA_BOUNDS;
		const p = new URLSearchParams({
			service: 'WFS',
			request: 'GetFeature',
			version: '1.1.0',
			typeName: LAYER,
			outputFormat: 'application/json',
			srsName: 'EPSG:4326',
			bbox: `${minX},${minY},${maxX},${maxY},EPSG:4326`
		});
		return `${WFS_BASE}?${p.toString()}`;
	}
	async function fetchCadastralGeoJSON(): Promise<any | null> {
		const urls = [buildWfsUrl_V20(), buildWfsUrl_V11()];
		for (const u of urls) {
			try {
				const r = await fetch(u);
				if (r.ok) {
					const gj = await r.json();
					if (gj?.features?.length) return gj;
				}
			} catch {}
		}
		return null;
	}
	function normalizeIds(gj: any) {
		let i = 1;
		for (const f of gj.features) {
			const fid = (f.id ?? f.properties?.id ?? `fid_${i++}`).toString();
			f.id = fid;
			f.properties = { __id: fid, ...f.properties };
		}
		return gj;
	}
	function lonLatTo3857(lng: number, lat: number) {
		const x = (lng * 20037508.34) / 180;
		let y = Math.log(Math.tan(((90 + lat) * Math.PI) / 360)) / (Math.PI / 180);
		y = (y * 20037508.34) / 180;
		return [x, y];
	}

	// AIS stream (via server-sent events proxy)
	let es: EventSource | null = null;
	let vessels: Map<string, any> = new Map();
	let waveRefreshTimer: number | null = null;
	let hazardRefreshTimer: number | null = null;

	function connectAISWebSocket() {
		try {
			if (es) es.close();
			es = new EventSource('/api/ais/stream');

			// Optional: react to server status events
			es.addEventListener('ready', () => {
				// stream is ready
			});
			es.addEventListener('status', (ev: MessageEvent) => {
				try {
					const s = JSON.parse(ev.data);
					console.debug('AIS status:', s);
				} catch {}
			});

			es.onmessage = (event) => {
				try {
					const d = JSON.parse(event.data);
					if (d?.type === 'position') {
						const mmsi = d.mmsi?.toString() ?? 'unknown';
						vessels.set(mmsi, {
							mmsi,
							latitude: d.lat,
							longitude: d.lon,
							course: d.course,
							speed: d.speed,
							timestamp: new Date(d.ts ?? Date.now()).toISOString()
						});
						updateVesselLayer();
					}
				} catch {}
			};

			es.onerror = () => {
				// reconnect on error
				es?.close();
				setTimeout(connectAISWebSocket, 3000);
			};
		} catch {}
	}

	function updateVesselLayer() {
		if (!map) return;

		const features = Array.from(vessels.values()).map(vessel => ({
			type: 'Feature' as const,
			geometry: {
				type: 'Point' as const,
				coordinates: [vessel.longitude, vessel.latitude] as [number, number]
			},
			properties: {
				mmsi: vessel.mmsi,
				course: vessel.course,
				speed: vessel.speed,
				timestamp: vessel.timestamp
			}
		}));

		const geoJsonData = {
			type: 'FeatureCollection' as const,
			features
		};

		try {
			(map.getSource('ais-vessels') as maplibregl.GeoJSONSource).setData(geoJsonData as any);
		} catch (err) {
			console.warn('Error updating AIS vessel layer:', err);
		}
	}

	// Ensure AIS points render above all other overlays
	function bringAisToFront() {
		try {
			if (!map.getLayer('ais-vessels')) return;
			// move without "before" puts it at the very top
			map.moveLayer('ais-vessels');
		} catch {}
	}

	// Find a safe "before" layer id (prefer first label/symbol layer)
	function findBeforeLabelLayerId(m: maplibregl.Map): string | undefined {
		try {
			const style = m.getStyle();
			const layers = style?.layers ?? [];

			// Common label layer ids across MapTiler/Mapbox styles
			const preferredIds = [
				'place_label',
				'poi_label',
				'road-label',
				'water-name-label',
				'water-label',
				'marine_label',
				'country-label',
				'state-label'
			];
			for (const id of preferredIds) {
				if (layers.some(l => l.id === id)) return id;
			}

			// Fallback: first symbol layer (usually labels)
			const firstSymbol = layers.find(l => l.type === 'symbol');
			return firstSymbol?.id;
		} catch {
			return undefined;
		}
	}

	// ---------- Ports (Overpass via /api/ports) ----------
	function addPortsLayer() {
		if (!map) return;


		map.addSource('illyra-ports', {
			type: 'geojson',
			data: { type: 'FeatureCollection', features: [] } as any,
			cluster: true,
			clusterRadius: 40,
			clusterMaxZoom: 11
		});

		map.addLayer({
			id: 'illyra-port-clusters',
			type: 'circle',
			source: 'illyra-ports',
			filter: ['has', 'point_count'],
			paint: {
				'circle-radius': [
					'step',
					['get', 'point_count'],
					12, 10, 16, 30, 22
				],
				'circle-color': '#005f73',
				'circle-opacity': 0.85
			}
		});

		map.addLayer({
			id: 'illyra-port-cluster-count',
			type: 'symbol',
			source: 'illyra-ports',
			filter: ['has', 'point_count'],
			layout: {
				'text-field': ['get', 'point_count_abbreviated'],
				'text-size': 12
			},
			paint: {
				'text-color': '#ffffff'
			}
		});

		map.addLayer({
			id: 'illyra-port-points',
			type: 'circle',
			source: 'illyra-ports',
			filter: ['!', ['has', 'point_count']],
			paint: {
				'circle-radius': 6,
				'circle-color': '#0a9396',
				'circle-stroke-color': '#001219',
				'circle-stroke-width': 1.5
			}
		});

		map.on('click', 'illyra-port-points', (e) => {
			const feature = e.features?.[0];
			if (!feature) return;

			const coords = (feature.geometry as any).coordinates as [number, number];
			const props = feature.properties as Record<string, unknown>;

			console.log('Port clicked', { lon: coords[0], lat: coords[1], props });
		});

		map.on('mouseenter', 'illyra-port-points', () => {
			map.getCanvas().style.cursor = 'pointer';
		});
		map.on('mouseleave', 'illyra-port-points', () => {
			map.getCanvas().style.cursor = '';
		});

		// Load data on main thread to avoid worker fetch issues in dev
		fetch('/api/ports')
			.then(async (r) => {
				if (!r.ok) throw new Error(`Failed to fetch /api/ports: ${r.status}`);
				return r.json();
			})
			.then((geojson) => {
				try {
					(map.getSource('illyra-ports') as maplibregl.GeoJSONSource).setData(geojson);
				} catch (err) {
					console.warn('Error setting ports GeoJSON:', err);
				}
			})
			.catch((err) => {
				console.warn('Ports fetch error:', err);
			});
	}

	// ---------- Waves (Open-Meteo via /api/sea/waves) ----------
	async function addWaveGridLayer(m: maplibregl.Map) {
		try {
			const beforeId = findBeforeLabelLayerId(m);

			async function refreshWaveData() {
				try {
					const r = await fetch('/api/sea/waves');
					if (!r.ok) return;
					const gj = await r.json();
					const src = m.getSource('illyra-wave-grid') as maplibregl.GeoJSONSource | undefined;
					if (src && 'setData' in src) {
						src.setData(gj);
					}
				} catch {}
			}

			// initial load
			{
				const res = await fetch('/api/sea/waves');
				if (!res.ok) return;
				const geojson = await res.json();

				m.addSource('illyra-wave-grid', {
					type: 'geojson',
					data: geojson
				});

				// circles sized/colored by wave height
				m.addLayer({
					id: 'illyra-wave-grid-circles',
					type: 'circle',
					source: 'illyra-wave-grid',
					paint: {
						'circle-radius': [
							'interpolate',
							['linear'],
							['get', 'waveHeight'],
							0, 2,
							1, 4,
							3, 8,
							6, 14
						],
						'circle-color': [
							'interpolate',
							['linear'],
							['get', 'waveHeight'],
							0, '#18ffb1',
							1, '#00c7ff',
							2, '#0080ff',
							4, '#ff9900',
							6, '#ff0033'
						],
						'circle-opacity': 0.7
					}
				}, beforeId);

				// direction arrows using symbol rotation
				m.addLayer({
					id: 'illyra-wave-grid-arrows',
					type: 'symbol',
					source: 'illyra-wave-grid',
					layout: {
						'text-field': '▲',
						'text-allow-overlap': true,
						'text-rotate': ['get', 'waveDirection'],
						'text-size': 12
					},
					paint: {
						'text-opacity': 0.7,
						'text-color': '#000000'
					}
				}, beforeId);
			}

			// periodic refresh (align with server cache)
			if (waveRefreshTimer) clearInterval(waveRefreshTimer);
			waveRefreshTimer = window.setInterval(refreshWaveData, 5 * 60 * 1000);
		} catch {
			// no-op on error
		}
	}

	// ---------- Hazard cells (alerts derived from wave height via /api/sea/alerts) ----------
	async function addHazardCellsLayer(m: maplibregl.Map) {
		try {
			const beforeId = findBeforeLabelLayerId(m);

			async function refreshHazardData() {
				try {
					const r = await fetch('/api/sea/alerts');
					if (!r.ok) return;
					const gj = await r.json();
					const src = m.getSource('illyra-hazard-cells') as maplibregl.GeoJSONSource | undefined;
					if (src && 'setData' in src) {
						src.setData(gj);
					}
				} catch {}
			}

			// initial load
			{
				const res = await fetch('/api/sea/alerts');
				if (!res.ok) return;
				const geojson = await res.json();

				m.addSource('illyra-hazard-cells', {
					type: 'geojson',
					data: geojson
				});

				m.addLayer({
					id: 'illyra-hazard-cells',
					type: 'circle',
					source: 'illyra-hazard-cells',
					paint: {
						'circle-radius': 8,
						'circle-opacity': 0.6,
						'circle-color': [
							'match',
							['get', 'alertLevel'],
							'ok', '#18ffb1',
							'warning', '#ffcc00',
							'danger', '#ff0033',
							/* other */ '#999999'
						]
					}
				}, beforeId);

				m.on('click', 'illyra-hazard-cells', (e) => {
					const feature = e.features?.[0];
					if (!feature) return;
					const props = feature.properties as any;
					const [lon, lat] = (feature.geometry as any).coordinates;
					const level = props?.alertLevel ?? 'unknown';
					const h = props?.waveHeight;
					console.log(`Sea state here: ${level}${h != null ? ` (${h}m waves)` : ''}`, { lon, lat });
				});

				m.on('mouseenter', 'illyra-hazard-cells', () => {
					m.getCanvas().style.cursor = 'pointer';
				});
				m.on('mouseleave', 'illyra-hazard-cells', () => {
					m.getCanvas().style.cursor = '';
				});
			}

			// periodic refresh (align with server cache)
			if (hazardRefreshTimer) clearInterval(hazardRefreshTimer);
			hazardRefreshTimer = window.setInterval(refreshHazardData, 5 * 60 * 1000);
		} catch {
			// no-op
		}
	}

	// ---------- Underwater features (OSM Seamarks via /api/fish/underwater) ----------
	async function addUnderwaterFeaturesLayer(m: maplibregl.Map) {
		try {
			const res = await fetch('/api/fish/underwater');
			if (!res.ok) return;
			const geojson = await res.json();

			m.addSource('illyra-underwater', {
				type: 'geojson',
				data: geojson
			});

			// Polygons (reefs / bigger obstructions)
			m.addLayer({
				id: 'illyra-underwater-areas-fill',
				type: 'fill',
				source: 'illyra-underwater',
				filter: ['==', ['geometry-type'], 'Polygon'],
				paint: {
					'fill-color': [
						'match',
						['get', 'seamarkType'],
						'reef', '#00c7ff',
						'marine_farm', '#ff9800',
						'obstruction', '#ff5252',
						/* default */ '#9e9e9e'
					],
					'fill-opacity': 0.25
				}
			});

			m.addLayer({
				id: 'illyra-underwater-areas-outline',
				type: 'line',
				source: 'illyra-underwater',
				filter: ['==', ['geometry-type'], 'Polygon'],
				paint: {
					'line-color': '#00c7ff',
					'line-width': 1.2
				}
			});

			// Points (rocks, wrecks, fish havens, etc.)
			m.addLayer({
				id: 'illyra-underwater-points',
				type: 'circle',
				source: 'illyra-underwater',
				filter: ['==', ['geometry-type'], 'Point'],
				paint: {
					'circle-radius': 4,
					'circle-color': [
						'case',
						['get', 'fishHaven'],
						'#18ffb1',
						[
							'match',
							['get', 'seamarkType'],
							'rock', '#ffcc00',
							'reef', '#00c7ff',
							'wreck', '#ff4081',
							'obstruction', '#ff5252',
							'marine_farm', '#ff9800',
							/* default */ '#9e9e9e'
						]
					],
					'circle-stroke-color': '#001018',
					'circle-stroke-width': 1
				}
			});

			m.on('click', 'illyra-underwater-points', (e) => {
				const feature = e.features?.[0];
				if (!feature) return;
				const props = feature.properties as any;
				const [lon, lat] = (feature.geometry as any).coordinates;
				console.log('Underwater feature clicked', { lon, lat, props });
			});

			m.on('mouseenter', 'illyra-underwater-points', () => {
				m.getCanvas().style.cursor = 'pointer';
			});
			m.on('mouseleave', 'illyra-underwater-points', () => {
				m.getCanvas().style.cursor = '';
			});
		} catch {
			// no-op
		}
	}

	// Selection (filter-based)
	let selectedId: string | null = null;
	function applySelectedFilter() {
		const f = selectedId
			? ['==', ['get', '__id'], selectedId]
			: ['==', ['get', '__id'], '___none___'];
		try {
			map.setFilter('cz-selected-fill', f as any);
		} catch {}
		try {
			map.setFilter('cz-selected-line', f as any);
		} catch {}
	}

	// ---------- Map ----------
	onMount(async () => {
		map = new maplibregl.Map({
			container: 'map',
			style: styleUrl,
			center: CENTER_ALBANIA,
			zoom: 0,
			minZoom: 0,
			maxZoom: 17,
			maxBounds: ALBANIA_BOUNDS,
			dragRotate: false,
			pitchWithRotate: false,
			cooperativeGestures: false,
			attributionControl: false
		});

		map.on('load', async () => {
			// Add AIS boat positions source and layer
			map.addSource('ais-vessels', {
				type: 'geojson',
				data: { type: 'FeatureCollection', features: [] } as any
			});

			map.addLayer({
				id: 'ais-vessels',
				type: 'circle',
				source: 'ais-vessels',
				paint: {
					'circle-radius': 4,
					'circle-color': '#FF6B35',
					'circle-stroke-color': '#FFFFFF',
					'circle-stroke-width': 2
				}
			});
			bringAisToFront();

			map.addSource('openseamap-seamarks', {
				type: 'raster',
				tiles: ['https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png'],
				tileSize: 256,
				attribution: '© OpenStreetMap contributors, © OpenSeaMap'
			});

			map.addLayer({	
				id: 'openseamap-seamarks',
				type: 'raster',
				source: 'openseamap-seamarks',
				paint: {
					'raster-opacity': 1
				}
			});

			map.addSource('bathymetry-emodnet', {
				type: 'raster',
				tiles: [
					'https://ows.emodnet-bathymetry.eu/wms?' +
						'SERVICE=WMS&VERSION=1.3.0&REQUEST=GetMap&' +
						// Use a sea-only layer (transparent on land)
						'LAYERS=mean_multicolour&' +
						'STYLES=&FORMAT=image/png&TRANSPARENT=true&' +
						'CRS=EPSG:3857&WIDTH=256&HEIGHT=256&' +
						'BBOX={bbox-epsg-3857}'
				],
				tileSize: 256,
				attribution:
					'Bathymetry © EMODnet Bathymetry, DO NOT USE FOR NAVIGATION'
			});

			const beforeId = findBeforeLabelLayerId(map);

			map.addLayer(
				{
					id: 'bathymetry-emodnet-layer',
					type: 'raster',
					source: 'bathymetry-emodnet',
					paint: {
						'raster-opacity': 0.75
					}
				},
				beforeId
			);

			// After bathymetry, add wave grid layer
			await addWaveGridLayer(map);
			// Add hazard cells overlay (derived alerts)
			await addHazardCellsLayer(map);

			addPortsLayer();
			await addUnderwaterFeaturesLayer(map);

			// Open AIS stream only after the map is fully idle
			try {
				map.once('idle', () => {
					setTimeout(() => {
						bringAisToFront();
						connectAISWebSocket();
					}, 300);
				});
			} catch {
				bringAisToFront();
				connectAISWebSocket();
			}

			// Keep AIS on top even if the style reloads or dev HMR tweaks layers
			map.on('styledata', () => {
				bringAisToFront();
			});

			if (navigator.geolocation) {
				navigator.geolocation.getCurrentPosition(
					(pos) =>
						map.flyTo({
							center: [pos.coords.longitude, pos.coords.latitude],
							zoom: 13.2,
							duration: 600
						}),
					() => {},
					{ enableHighAccuracy: true, timeout: 3000 }
				);
			}
		});
	});

	onDestroy(() => {
		map?.remove();
		if (es) es.close();
		if (waveRefreshTimer) clearInterval(waveRefreshTimer);
		if (hazardRefreshTimer) clearInterval(hazardRefreshTimer);
	});
</script>

<div id="map"></div>

<style>
	#map {
		position: fixed;
		inset: 0;
	}
</style>
