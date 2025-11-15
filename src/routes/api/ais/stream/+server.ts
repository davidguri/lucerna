import type { RequestHandler } from '@sveltejs/kit';
import { PUBLIC_AISSTREAMIO_API } from '$env/static/public';
import WebSocket from 'ws';

export const prerender = false;

const ALBANIA_BOUNDS: [[number, number], [number, number]] = [
  [18.0, 38.6],
  [22.1, 43.9]
];

export const GET: RequestHandler = async ({ request, url }) => {
  const encoder = new TextEncoder();
  let closed = false;
  let upstream: WebSocket | null = null;
  const apiKey =
    PUBLIC_AISSTREAMIO_API;
  const mockParam = url.searchParams.get('mock');
  const useMock = mockParam === '1' || !apiKey;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          clearInterval(keepAlive);
        }
      }, 10000);

      function send(data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          closed = true;
          if (upstream && upstream.readyState === WebSocket.OPEN) {
            try { upstream.close(); } catch { }
          }
        }
      }

      try {
        controller.enqueue(encoder.encode('retry: 3000\n\n'));
      } catch { }
      try {
        controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));
      } catch { }

      function sendEvent(eventName: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { }
      }

      sendEvent('status', { state: 'connected', mode: useMock ? 'mock' : 'live' });

      let mockTimer: ReturnType<typeof setInterval> | null = null;
      function startMock() {
        const [[minLon, minLat], [maxLon, maxLat]] = ALBANIA_BOUNDS;
        const num = 25;
        const vessels = Array.from({ length: num }).map((_, i) => {
          const lon = minLon + Math.random() * (maxLon - minLon);
          const lat = minLat + Math.random() * (maxLat - minLat);
          return {
            mmsi: String(100000000 + i),
            lon,
            lat,
            course: Math.random() * 360,
            speed: 2 + Math.random() * 8
          };
        });

        mockTimer = setInterval(() => {
          if (closed) return;
          for (const v of vessels) {
            const rad = (v.course * Math.PI) / 180;
            const dLon = (Math.cos(rad) * v.speed) / 5000;
            const dLat = (Math.sin(rad) * v.speed) / 5000;
            v.lon += dLon;
            v.lat += dLat;
            if (v.lon < minLon || v.lon > maxLon) v.course = 180 - v.course;
            if (v.lat < minLat || v.lat > maxLat) v.course = 360 - v.course;

            send({
              type: 'position',
              mmsi: v.mmsi,
              lat: v.lat,
              lon: v.lon,
              course: v.course,
              speed: v.speed,
              ts: Date.now()
            });
          }
        }, 1000);
      }

      function connectReal() {
        if (closed) return;

        try {
          upstream = new WebSocket('wss://stream.aisstream.io/v0/stream');
          sendEvent('status', { state: 'connecting_upstream' });

          upstream.on('open', () => {
            sendEvent('status', { state: 'upstream_open' });
            const sub = {
              APIKey: apiKey,
              BoundingBoxes: [[
                [ALBANIA_BOUNDS[0][0], ALBANIA_BOUNDS[0][1]],
                [ALBANIA_BOUNDS[1][0], ALBANIA_BOUNDS[1][1]]
              ]],
              FilterMessageTypes: ['PositionReport']
            };
            upstream?.send(JSON.stringify(sub));
          });

          upstream.on('message', (raw) => {
            try {
              const msg = JSON.parse(String(raw));
              if (msg?.MessageType === 'PositionReport') {
                const v = msg.Message?.PositionReport;
                if (typeof v?.Latitude === 'number' && typeof v?.Longitude === 'number') {
                  send({
                    type: 'position',
                    mmsi: String(v.UserID ?? ''),
                    lat: v.Latitude,
                    lon: v.Longitude,
                    course: v.TrueHeading ?? v.Cog ?? null,
                    speed: v.Sog ?? null,
                    ts: Date.now()
                  });
                }
              }
            } catch { }
          });

          upstream.on('error', () => {
            sendEvent('status', { state: 'upstream_error' });
          });

          upstream.on('close', () => {
            if (closed) return;
            sendEvent('status', { state: 'reconnecting_upstream' });
            setTimeout(connectReal, 3000);
          });
        } catch {
          sendEvent('status', { state: 'upstream_exception' });
          setTimeout(connectReal, 3000);
        }
      }

      if (useMock) {
        startMock();
      } else {
        connectReal();
      }

      const onAbort = () => {
        closed = true;
        try { clearInterval(keepAlive); } catch { }
        if (mockTimer) {
          try { clearInterval(mockTimer); } catch { }
        }
        if (upstream && upstream.readyState === WebSocket.OPEN) {
          try { upstream.close(); } catch { }
        }
        upstream = null;
      };
      request.signal.addEventListener('abort', onAbort, { once: true });

    },
    cancel() {
      closed = true;
      if (upstream && upstream.readyState === WebSocket.OPEN) {
        upstream.close();
      }
      upstream = null;
    }
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      Pragma: 'no-cache',
      'X-Accel-Buffering': 'no'
    }
  });
};


