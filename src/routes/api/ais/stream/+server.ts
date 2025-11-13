import type { RequestHandler } from '@sveltejs/kit';
import { PUBLIC_AISSTREAMIO_API } from '$env/static/public';
import WebSocket from 'ws';

// This endpoint streams data; never prerender
export const prerender = false;

// Albania bounds used in the map (SW, NE)
const ALBANIA_BOUNDS: [[number, number], [number, number]] = [
  [18.0, 38.6],
  [22.1, 43.9]
];

export const GET: RequestHandler = async ({ request, url }) => {
  const encoder = new TextEncoder();
  let closed = false;
  let upstream: WebSocket | null = null;
  // Prefer public env var, allow private fallback for local setups
  const apiKey =
    PUBLIC_AISSTREAMIO_API;
  const mockParam = url.searchParams.get('mock');
  const useMock = mockParam === '1' || !apiKey;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Heartbeat to keep proxies from closing the connection
      const keepAlive = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(': keep-alive\n\n'));
        } catch {
          // Controller likely closed; stop interval to avoid crashes
          clearInterval(keepAlive);
        }
      }, 10000);

      function send(data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
        } catch {
          // If enqueue fails, mark closed and cleanup
          closed = true;
          if (upstream && upstream.readyState === WebSocket.OPEN) {
            try { upstream.close(); } catch { }
          }
        }
      }

      // Immediately hint the client to retry in case of network hiccups
      try {
        controller.enqueue(encoder.encode('retry: 3000\n\n'));
      } catch { }
      // Also send an initial ready event so the browser processes the stream immediately
      try {
        controller.enqueue(encoder.encode(`event: ready\ndata: {}\n\n`));
      } catch { }

      function sendEvent(eventName: string, data: unknown) {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch { }
      }

      // Inform client of mode
      sendEvent('status', { state: 'connected', mode: useMock ? 'mock' : 'live' });

      // Mock mode: emit synthetic vessel positions if no API key is configured
      let mockTimer: ReturnType<typeof setInterval> | null = null;
      function startMock() {
        // 25 synthetic vessels moving inside the Albania bounds
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
            // simple drift
            const rad = (v.course * Math.PI) / 180;
            const dLon = (Math.cos(rad) * v.speed) / 5000;
            const dLat = (Math.sin(rad) * v.speed) / 5000;
            v.lon += dLon;
            v.lat += dLat;
            // bounce inside bounds
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
            // errors are handled by close event with reconnect
            sendEvent('status', { state: 'upstream_error' });
          });

          upstream.on('close', () => {
            if (closed) return;
            // backoff reconnect
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

      // Tie lifecycle to client abort (tab closed/navigation)
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

      // Cleanup is driven by onAbort/cancel
    },
    cancel() {
      closed = true;
      // Best-effort cleanup
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
      // Disable proxy buffering where applicable (nginx)
      'X-Accel-Buffering': 'no'
    }
  });
};


