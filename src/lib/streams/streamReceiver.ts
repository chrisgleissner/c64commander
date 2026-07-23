/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capabilities D/E — platform stream receiver seam.
 *
 * Receiving raw UDP needs a real socket. Following the app's native/web split:
 *   - Web/Docker: the app server binds the UDP port and bridges datagrams to the
 *     client over a WebSocket; the WebSocketStreamReceiver consumes that bridge.
 *   - Native: a small Capacitor plugin receives UDP directly (follow-up work). Until
 *     it ships, native resolves to an unsupported receiver so the feature degrades
 *     cleanly rather than crashing.
 *
 * The receiver only transports datagrams and connection state. Telling the DEVICE
 * where to stream (PUT /v1/streams/{name}:start?ip=…) is the hook's job.
 */

export type StreamName = "audio" | "video";
export type StreamConnectionState = "connecting" | "open" | "closed" | "error";

export interface StreamReceiver {
  onDatagram(handler: (data: Uint8Array) => void): void;
  onStateChange(handler: (state: StreamConnectionState) => void): void;
  /** The host:port the device should stream to (the receiver's own address). */
  readonly destination: string;
  close(): void;
}

export interface StreamReceiverOptions {
  name: StreamName;
  /** WebSocket bridge base URL, e.g. "ws://host:8788". Defaults to the app origin. */
  bridgeUrl?: string;
  /** The host:port the device should stream to (defaults to the bridge host + default port). */
  destination?: string;
  /** Injectable WebSocket constructor for tests. */
  socketFactory?: (url: string) => WebSocketLike;
}

export interface WebSocketLike {
  binaryType: string;
  onopen: ((event?: unknown) => void) | null;
  onclose: ((event?: unknown) => void) | null;
  onerror: ((event?: unknown) => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  close(): void;
}

export const DEFAULT_VIDEO_PORT = 11000;
export const DEFAULT_AUDIO_PORT = 11001;

const defaultPortFor = (name: StreamName) => (name === "audio" ? DEFAULT_AUDIO_PORT : DEFAULT_VIDEO_PORT);

const toUint8 = (data: unknown): Uint8Array | null => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
};

/** Web receiver: consumes the app server's UDP→WebSocket bridge. */
export class WebSocketStreamReceiver implements StreamReceiver {
  private socket: WebSocketLike;
  private datagramHandler: ((data: Uint8Array) => void) | null = null;
  private stateHandler: ((state: StreamConnectionState) => void) | null = null;
  readonly destination: string;

  constructor(options: StreamReceiverOptions) {
    const bridge = options.bridgeUrl ?? deriveBridgeUrl();
    const url = `${bridge.replace(/\/+$/, "")}/streams/${options.name}`;
    this.destination = options.destination ?? `${bridgeHost(bridge)}:${defaultPortFor(options.name)}`;
    const factory = options.socketFactory ?? defaultSocketFactory;
    this.socket = factory(url);
    this.socket.binaryType = "arraybuffer";
    this.socket.onopen = () => this.stateHandler?.("open");
    this.socket.onclose = () => this.stateHandler?.("closed");
    this.socket.onerror = () => this.stateHandler?.("error");
    this.socket.onmessage = (event) => {
      const bytes = toUint8(event.data);
      if (bytes) this.datagramHandler?.(bytes);
    };
  }

  onDatagram(handler: (data: Uint8Array) => void): void {
    this.datagramHandler = handler;
  }

  onStateChange(handler: (state: StreamConnectionState) => void): void {
    this.stateHandler = handler;
    handler("connecting");
  }

  close(): void {
    try {
      this.socket.close();
    } catch {
      /* already closed */
    }
  }
}

/** Native (until the UDP plugin ships) / unavailable-transport fallback. */
export class UnsupportedStreamReceiver implements StreamReceiver {
  readonly destination = "";
  onDatagram(): void {}
  onStateChange(handler: (state: StreamConnectionState) => void): void {
    handler("error");
  }
  close(): void {}
}

const deriveBridgeUrl = (): string => {
  if (typeof location === "undefined") return "ws://localhost:8788";
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${location.host}`;
};

const bridgeHost = (bridgeUrl: string): string => {
  try {
    return new URL(bridgeUrl).hostname;
  } catch {
    return "localhost";
  }
};

const defaultSocketFactory = (url: string): WebSocketLike => {
  if (typeof WebSocket === "undefined") throw new Error("WebSocket unavailable");
  return new WebSocket(url) as unknown as WebSocketLike;
};

/**
 * Resolve a receiver for the platform. On web returns a WebSocket bridge receiver;
 * a caller may inject a socketFactory for tests. Native returns unsupported until
 * the UDP plugin ships (`video_mirror_enabled` stays developer_only meanwhile).
 */
export const createStreamReceiver = (options: StreamReceiverOptions): StreamReceiver => {
  try {
    return new WebSocketStreamReceiver(options);
  } catch {
    return new UnsupportedStreamReceiver();
  }
};
