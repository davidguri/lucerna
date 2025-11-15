import type { RequestHandler } from './$types';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const OVERPASS_QUERY = `
[out:json][timeout:25];
area["ISO3166-1"="AL"]["admin_level"="2"]->.albania;
(
  node["seamark:type"~"^(rock|reef|wreck|obstruction|marine_farm)$"](area.albania);
  way["seamark:type"~"^(rock|reef|wreck|obstruction|marine_farm)$"](area.albania);
  relation["seamark:type"~"^(rock|reef|wreck|obstruction|marine_farm)$"](area.albania);
);
out body geom;
`;

export const GET: RequestHandler = async () => {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: OVERPASS_QUERY,
    headers: {
      'Content-Type': 'text/plain;charset=UTF-8',
      'User-Agent': 'Illyra/0.1 (contact@illyra.app)'
    }
  });

  if (!res.ok) {
    return new Response('Overpass error', { status: 502 });
  }

  const data = (await res.json()) as any;

  const features: any[] = [];

  for (const el of data.elements as any[]) {
    const tags = el.tags ?? {};
    const seamarkType = tags['seamark:type'] ?? null;
    const fishHaven =
      seamarkType === 'obstruction' &&
      tags['seamark:obstruction:category'] === 'fish_haven';

    const baseProps = {
      id: el.id,
      seamarkType,
      name: tags['seamark:name'] ?? tags['name'] ?? null,
      obstructionCategory: tags['seamark:obstruction:category'] ?? null,
      fishHaven
    };

    if (el.type === 'node') {
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Point',
          coordinates: [el.lon, el.lat]
        },
        properties: baseProps
      });
    } else if (el.type === 'way' && el.geometry) {
      const coords = el.geometry.map((g: any) => [g.lon, g.lat]);
      features.push({
        type: 'Feature',
        geometry: {
          type: 'Polygon',
          coordinates: [coords]
        },
        properties: baseProps
      });
    }
  }

  const fc = {
    type: 'FeatureCollection',
    features
  };

  return new Response(JSON.stringify(fc), {
    headers: { 'Content-Type': 'application/json' }
  });
};


