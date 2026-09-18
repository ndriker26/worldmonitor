import WebSocket from 'ws';
import type { AisFrame } from './ais-types.js';
import type { Terminal } from './geo.js';

const AISSTREAM_URL = 'wss://stream.aisstream.io/v0/stream';
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

export interface AisSocketOptions {
  apiKey: string;
  terminals: Terminal[];
  onFrame: (frame: AisFrame, raw: string) => void;
  onStatus?: (status: string) => void;
}

export interface AisSocketHandle {
  close: () => void;
}

/** Connects to aisstream.io, subscribes to bounding boxes around each terminal, and reconnects with backoff+jitter on drop. */
export function connectAisStream(opts: AisSocketOptions): AisSocketHandle {
  let ws: WebSocket | null = null;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: NodeJS.Timeout | null = null;

  const subscribe = () => {
    // aisstream requires the subscription within 3s of connecting.
    const boundingBoxes = opts.terminals.map((t) => [t.bbox.sw, t.bbox.ne]);
    ws!.send(JSON.stringify({
      APIKey: opts.apiKey,
      BoundingBoxes: boundingBoxes,
      FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
    }));
  };

  const scheduleReconnect = () => {
    if (closed) return;
    attempt += 1;
    const backoff = Math.min(RECONNECT_MAX_MS, RECONNECT_BASE_MS * 2 ** attempt);
    const delay = backoff * (0.5 + Math.random() * 0.5); // jitter
    opts.onStatus?.(`reconnecting in ${Math.round(delay)}ms (attempt ${attempt})`);
    reconnectTimer = setTimeout(connect, delay);
  };

  function connect(): void {
    if (closed) return;
    ws = new WebSocket(AISSTREAM_URL);

    ws.on('open', () => {
      attempt = 0;
      opts.onStatus?.('connected');
      subscribe();
    });

    ws.on('message', (data) => {
      const raw = data.toString();
      let frame: AisFrame;
      try {
        frame = JSON.parse(raw) as AisFrame;
      } catch {
        return; // malformed frame — skip
      }
      if (frame.MessageType === 'SubscriptionConfirmation') {
        opts.onStatus?.('subscription confirmed');
        return;
      }
      opts.onFrame(frame, raw);
    });

    ws.on('close', (code) => {
      if (closed) return;
      opts.onStatus?.(`disconnected (code ${code})`);
      scheduleReconnect();
    });

    ws.on('error', (err) => {
      opts.onStatus?.(`socket error: ${err.message}`);
      // 'close' fires after 'error' and drives the reconnect.
    });
  }

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
    },
  };
}
