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

	// Tirana clamp
	const CENTER_TIRANA: [number, number] = [19.8187, 41.3275];
	const TIRANA_BOUNDS: [[number, number], [number, number]] = [
		[19.7, 41.25],
		[19.95, 41.45]
	];

	// ASIG endpoints / layer
	const WFS_BASE = 'https://geoportal.asig.gov.al/service/zrpp/wfs';
	const WMS_BASE = 'https://geoportal.asig.gov.al/service/zrpp/wms';
	const LAYER = 'zrpp:zona_kadastrale_qkd_042025';

	// ---------- Utils ----------
	function buildWfsUrl_V20() {
		const [[minX, minY], [maxX, maxY]] = TIRANA_BOUNDS;
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
		const [[minX, minY], [maxX, maxY]] = TIRANA_BOUNDS;
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
	function addAlbaniaMask() {
		const WORLD_RING = [
			[-180, -85],
			[180, -85],
			[180, 85],
			[-180, 85],
			[-180, -85]
		]; // CCW
		const ALBANIA_HOLE = [
			[19.0, 39.6],
			[19.0, 42.9],
			[21.1, 42.9],
			[21.1, 39.6],
			[19.0, 39.6]
		]; // CW
		const MASK = {
			type: 'FeatureCollection',
			features: [
				{
					type: 'Feature',
					properties: {},
					geometry: { type: 'Polygon', coordinates: [WORLD_RING, ALBANIA_HOLE] }
				}
			]
		};
		map.addSource('mask', { type: 'geojson', data: MASK as any });
		map.addLayer({
			id: 'world-mask',
			type: 'fill',
			source: 'mask',
			paint: { 'fill-color': '#000', 'fill-opacity': 1 }
		});
		map.setRenderWorldCopies(false);
		map.moveLayer('world-mask');
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
			center: CENTER_TIRANA,
			zoom: 14,
			minZoom: 12.5,
			maxZoom: 16.5,
			maxBounds: TIRANA_BOUNDS,
			dragRotate: false,
			pitchWithRotate: false,
			cooperativeGestures: false,
			attributionControl: false
		});

		map.on('load', async () => {
			// Try WFS (vector, interactive)
			const gjRaw = await fetchCadastralGeoJSON();

			if (gjRaw?.features?.length) {
				const gj = normalizeIds(gjRaw);

				// Source + layers
				map.addSource('cz-geo', { type: 'geojson', data: gj, promoteId: '__id' });

				map.addLayer({
					id: 'cz-fill',
					type: 'fill',
					source: 'cz-geo',
					paint: { 'fill-color': '#1A9EFF', 'fill-opacity': 0.12 }
				});
				map.addLayer({
					id: 'cz-line',
					type: 'line',
					source: 'cz-geo',
					paint: { 'line-color': '#49B4FF', 'line-width': 1.2 }
				});

				// Selected (filter by __id)
				map.addLayer({
					id: 'cz-selected-fill',
					type: 'fill',
					source: 'cz-geo',
					filter: ['==', ['get', '__id'], '___none___'],
					paint: { 'fill-color': '#1A9EFF', 'fill-opacity': 0.25 }
				});
				map.addLayer({
					id: 'cz-selected-line',
					type: 'line',
					source: 'cz-geo',
					filter: ['==', ['get', '__id'], '___none___'],
					paint: { 'line-color': '#137EF5', 'line-width': 2.2 }
				});

				// Click → select + fit + dispatch
				const handleSelect = (ft: any) => {
					selectedId = ft.properties?.__id?.toString();
					applySelectedFilter();

					const [minX, minY, maxX, maxY] = turf.bbox(ft as any);
					map.fitBounds(
						[
							[minX, minY],
							[maxX, maxY]
						],
						{
							padding: { top: 24, left: 24, right: 24, bottom: 240 },
							duration: 500,
							maxZoom: 16
						}
					);

					const name =
						ft.properties?.emri ||
						ft.properties?.label ||
						ft.properties?.zone ||
						ft.properties?.kod ||
						ft.id ||
						'Zona kadastrale';

					dispatch('select', { id: selectedId ?? '', name, current: null, upcomingCount: 0 });
				};

				map.on('click', 'cz-fill', (e) => {
					const f = e.features?.[0];
					if (f) handleSelect(f);
				});
				map.on('click', 'cz-line', (e) => {
					const f = e.features?.[0];
					if (f) handleSelect(f);
				});

				// Fit once to all zones returned
				const [minX, minY, maxX, maxY] = turf.bbox(gj as any);
				map.fitBounds(
					[
						[minX, minY],
						[maxX, maxY]
					],
					{ padding: 24, maxZoom: 13.5, duration: 400 }
				);
			} else {
				// Fallback: WMS overlay + GetFeatureInfo interactivity
				const cql = encodeURIComponent(
					`BBOX(the_geom,${TIRANA_BOUNDS[0][0]},${TIRANA_BOUNDS[0][1]},${TIRANA_BOUNDS[1][0]},${TIRANA_BOUNDS[1][1]},'EPSG:4326')`
				);
				map.addSource('cz-wms', {
					type: 'raster',
					tileSize: 256,
					tiles: [
						`${WMS_BASE}?service=WMS&version=1.1.1&request=GetMap&format=image/png&transparent=true` +
							`&layers=${encodeURIComponent(LAYER)}&styles=&srs=EPSG:3857&width=256&height=256&bbox={bbox-epsg-3857}&cql_filter=${cql}`
					],
					attribution: '© ASIG'
				});
				map.addLayer({
					id: 'cz-wms',
					type: 'raster',
					source: 'cz-wms',
					paint: { 'raster-opacity': 0.7 }
				});

				// Vector highlight source for GetFeatureInfo result
				map.addSource('cz-hi', {
					type: 'geojson',
					data: { type: 'FeatureCollection', features: [] } as any
				});
				map.addLayer({
					id: 'cz-hi-fill',
					type: 'fill',
					source: 'cz-hi',
					paint: { 'fill-color': '#1A9EFF', 'fill-opacity': 0.25 }
				});
				map.addLayer({
					id: 'cz-hi-line',
					type: 'line',
					source: 'cz-hi',
					paint: { 'line-color': '#137EF5', 'line-width': 2.2 }
				});

				map.on('click', async (e) => {
					try {
						const p = map.project(e.lngLat);
						const b = map.getBounds();
						const sw = lonLatTo3857(b.getWest(), b.getSouth());
						const ne = lonLatTo3857(b.getEast(), b.getNorth());

						const params = new URLSearchParams({
							service: 'WMS',
							version: '1.1.1',
							request: 'GetFeatureInfo',
							srs: 'EPSG:3857',
							info_format: 'application/json',
							layers: LAYER,
							query_layers: LAYER,
							styles: '',
							bbox: `${sw[0]},${sw[1]},${ne[0]},${ne[1]}`,
							width: String((map.getCanvas() as HTMLCanvasElement).width),
							height: String((map.getCanvas() as HTMLCanvasElement).height),
							x: String(Math.round(p.x)),
							y: String(Math.round(p.y)),
							feature_count: '5',
							// keep the same Tirana filter server-side
							cql_filter: `BBOX(the_geom,${TIRANA_BOUNDS[0][0]},${TIRANA_BOUNDS[0][1]},${TIRANA_BOUNDS[1][0]},${TIRANA_BOUNDS[1][1]},'EPSG:4326')`
						});
						const url = `${WMS_BASE}?${params.toString()}`;
						const info = await (await fetch(url)).json();

						if (info?.features?.length) {
							const ft = info.features[0];

							(map.getSource('cz-hi') as maplibregl.GeoJSONSource).setData({
								type: 'FeatureCollection',
								features: [ft]
							} as any);

							const [minX, minY, maxX, maxY] = turf.bbox(ft as any);
							map.fitBounds(
								[
									[minX, minY],
									[maxX, maxY]
								],
								{
									padding: { top: 24, left: 24, right: 24, bottom: 240 },
									duration: 500,
									maxZoom: 16
								}
							);

							const name =
								ft.properties?.emri ||
								ft.properties?.label ||
								ft.properties?.zone ||
								ft.properties?.kod ||
								ft.id ||
								'Zona kadastrale';

							dispatch('select', {
								id: String(ft.id ?? name),
								name,
								current: null,
								upcomingCount: 0
							});
						}
					} catch (err) {
						console.warn('GetFeatureInfo failed', err);
					}
				});
			}

			addAlbaniaMask();

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

	onDestroy(() => map?.remove());
</script>

<div id="map"></div>

<style>
	#map {
		position: fixed;
		inset: 0;
	}
</style>
