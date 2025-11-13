import type { RequestHandler } from './$types';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

// Albania harbours & marinas via OSM seamark tags
// - area["ISO3166-1"="AL"][admin_level=2] gets Albania as an area
// - we grab harbour-related seamarks as nodes (good enough for ports overview)
const OVERPASS_QUERY = `
[out:json][timeout:60];

// Find the Albania country boundary and turn it into an area
area["ISO3166-1"="AL"]["admin_level"="2"]->.searchArea;

// All harbour-ish seamark nodes inside Albania
(
  node["seamark:type"="harbour"](area.searchArea);
  node["seamark:type"="small_craft_facility"](area.searchArea);
  node["harbour"="yes"](area.searchArea);
  node["seamark:harbour:category"](area.searchArea);
);

out body;
`;

type OverpassElement = {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
};

function overpassToGeoJSON(data: { elements: OverpassElement[] }) {
  const features = data.elements
    .filter((el) => el.type === 'node' && typeof el.lat === 'number' && typeof el.lon === 'number')
    .map((node) => {
      const tags = node.tags ?? {};
      return {
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [node.lon as number, node.lat as number]
        },
        properties: {
          id: node.id,
          name: tags['seamark:name'] ?? tags['name'] ?? null,
          category: tags['seamark:harbour:category'] ?? null,
          type: tags['seamark:type'] ?? null,
          harbour: tags['harbour'] ?? null
        }
      };
    });

  return {
    type: 'FeatureCollection',
    features
  } as const;
}

// Optional: super basic in-memory cache to avoid hammering Overpass
let cached: { json: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24h

export const GET: RequestHandler = async () => {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return new Response(cached.json, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=3600'
      }
    });
  }

  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      // Overpass etiquette: identify your app + contact
      'User-Agent': 'Illyra/0.1 (your-email@example.com)'
    },
    body: OVERPASS_QUERY
  });

  if (!res.ok) {
    console.error('Overpass error', res.status, await res.text());
    return new Response(JSON.stringify({ error: 'Failed to fetch ports from Overpass' }), {
      status: 502
    });
  }

  const data = (await res.json()) as { elements: OverpassElement[] };
  const geojson = overpassToGeoJSON(data);
  const json = JSON.stringify(geojson);

  cached = { json, fetchedAt: now };

  return new Response(json, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600'
    }
  });
};
