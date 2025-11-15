import type { RequestHandler } from './$types';

const LAT_MIN = 39.0;
const LAT_MAX = 42.5;
const LON_MIN = 18.5;
const LON_MAX = 21.5;
const GRID_STEP = 0.25; // degrees

const MARINE_BASE = 'https://marine-api.open-meteo.com/v1/marine';
const HOURLY_VARS =
  'wave_height,wave_direction,wave_period,' +
  'wind_wave_height,wind_wave_direction,wind_wave_period,' +
  'swell_wave_height,swell_wave_direction,swell_wave_period';

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
  const CHUNK_SIZE = 24; // limit parallelism
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

          const h = Number(data?.hourly?.wave_height?.[idx] ?? 0);
          const dir = Number(data?.hourly?.wave_direction?.[idx] ?? 0);
          const period = Number(data?.hourly?.wave_period?.[idx] ?? 0);

          const windH = Number(data?.hourly?.wind_wave_height?.[idx] ?? 0);
          const windDir = Number(data?.hourly?.wind_wave_direction?.[idx] ?? 0);
          const windPer = Number(data?.hourly?.wind_wave_period?.[idx] ?? 0);

          const swellH = Number(data?.hourly?.swell_wave_height?.[idx] ?? 0);
          const swellDir = Number(data?.hourly?.swell_wave_direction?.[idx] ?? 0);
          const swellPer = Number(data?.hourly?.swell_wave_period?.[idx] ?? 0);

          return {
            type: 'Feature' as const,
            geometry: {
              type: 'Point' as const,
              coordinates: [lon, lat] as [number, number]
            },
            properties: {
              waveHeight: isFinite(h) ? h : 0,
              waveDirection: isFinite(dir) ? dir : 0,
              wavePeriod: isFinite(period) ? period : 0,
              windWaveHeight: isFinite(windH) ? windH : 0,
              windWaveDirection: isFinite(windDir) ? windDir : 0,
              windWavePeriod: isFinite(windPer) ? windPer : 0,
              swellWaveHeight: isFinite(swellH) ? swellH : 0,
              swellWaveDirection: isFinite(swellDir) ? swellDir : 0,
              swellWavePeriod: isFinite(swellPer) ? swellPer : 0
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
              waveHeight: 0,
              waveDirection: 0,
              wavePeriod: 0,
              windWaveHeight: 0,
              windWaveDirection: 0,
              windWavePeriod: 0,
              swellWaveHeight: 0,
              swellWaveDirection: 0,
              swellWavePeriod: 0
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


