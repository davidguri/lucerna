import type { RequestHandler } from './$types';

const LAT_MIN = 39.0;
const LAT_MAX = 42.5;
const LON_MIN = 18.5;
const LON_MAX = 21.5;
const GRID_STEP = 0.25;

const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';
const HOURLY_VARS = 'wave_height';

let cached: { json: string; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function buildGridPairs(): Array<{ lat: number; lon: number }> {
  const pairs: Array<{ lat: number; lon: number }> = [];
  for (let lat = LAT_MIN; lat <= LAT_MAX + 1e-9; lat += GRID_STEP) {
    for (let lon = LON_MIN; lon <= LON_MAX + 1e-9; lon += GRID_STEP) {
      const rlat = Math.round(lat * 1000) / 1000;
      const rlon = Math.round(lon * 1000) / 1000;
      pairs.push({ lat: rlat, lon: rlon });
    }
  }
  return pairs;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function classifyAlert(h: number | null | undefined): 'ok' | 'warning' | 'danger' | 'unknown' {
  if (h == null || !isFinite(h)) return 'unknown';
  if (h < 1.0) return 'ok';
  if (h < 2.5) return 'warning';
  return 'danger';
}

export const GET: RequestHandler = async () => {
  const now = Date.now();
  if (cached && now - cached.fetchedAt < CACHE_TTL_MS) {
    return new Response(cached.json, {
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600'
      }
    });
  }

  const pairs = buildGridPairs();
  const features: any[] = [];
  const CHUNK_SIZE = 24;
  for (const group of chunk(pairs, CHUNK_SIZE)) {
    const batch = await Promise.all(
      group.map(async ({ lat, lon }) => {
        try {
          const url = new URL(MARINE_BASE);
          url.searchParams.set('latitude', String(lat));
          url.searchParams.set('longitude', String(lon));
          url.searchParams.set('hourly', HOURLY_VARS);
          url.searchParams.set('timezone', 'auto');

          const res = await fetch(url.toString(), {
            headers: {
              'User-Agent': 'Illyra/0.1 (contact@example.com)'
            }
          });
          if (!res.ok) throw new Error(`Open-Meteo ${res.status}`);
          const data = (await res.json()) as any;

          const times: string[] = (data?.hourly?.time as string[]) ?? [];
          const nowMs = Date.now();
          let idx = 0;
          if (times.length > 0) {
            let best = 0;
            let bestDiff = Infinity;
            for (let i = 0; i < times.length; i++) {
              const t = Date.parse(times[i]);
              const diff = Math.abs(t - nowMs);
              if (diff < bestDiff) {
                bestDiff = diff;
                best = i;
              }
            }
            idx = best;
          }

          const h = Number(data?.hourly?.wave_height?.[idx] ?? NaN);
          const level = classifyAlert(h);

          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [lon, lat] as [number, number]
            },
            properties: {
              waveHeight: isFinite(h) ? h : null,
              alertLevel: level
            }
          };
        } catch {
          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [lon, lat] as [number, number]
            },
            properties: {
              waveHeight: null,
              alertLevel: 'unknown' as const
            }
          };
        }
      })
    );
    features.push(...batch);
  }

  const fc = {
    type: 'FeatureCollection' as const,
    features
  };
  const json = JSON.stringify(fc);
  cached = { json, fetchedAt: now };

  return new Response(json, {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=600'
    }
  });
};


