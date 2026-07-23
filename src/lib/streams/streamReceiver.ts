/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import { isNativePlatform } from "@/lib/native/platform";
import { StreamUdp } from "@/lib/native/streamUdp";
import type { PluginListenerHandle } from "@capacitor/core";

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
  /**
   * Resolves once the receiver is ready and {@link destination} is final. Optional: the web
   * receiver knows its destination synchronously; the native receiver must first bind a UDP
   * socket to learn the phone's address, so a caller must await this before telling the
   * device where to stream.
   */
  ready?(): Promise<void>;
  close(): void;
}

export interface StreamReceiverOptions {
  name: StreamName;
  /** WebSocket bridge base URL, e.g. "ws://host:8788". Defaults to the app origin. */
  bridgeUrl?: string;
  /** The host:port the device should stream to (defaults to the bridge host + `port`). */
  destination?: string;
  /** UDP port the device streams to / the bridge binds (defaults 11000 video / 11001 audio). */
  port?: number;
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
    const port = options.port ?? defaultPortFor(options.name);
    const url = `${bridge.replace(/\/+$/, "")}/streams/${options.name}`;
    this.destination = options.destination ?? `${bridgeHost(bridge)}:${port}`;
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
    } catch (error) {
      addLog("debug", "Stream receiver socket already closed", {
        error: (error as Error)?.message ?? String(error),
      });
    }
  }
}

const base64ToBytes = (base64: string): Uint8Array => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/** Native receiver: binds a UDP port through the StreamUdp plugin and forwards datagrams. */
export class NativeUdpStreamReceiver implements StreamReceiver {
  private datagramHandler: ((data: Uint8Array) => void) | null = null;
  private stateHandler: ((state: StreamConnectionState) => void) | null = null;
  destination = "";
  private closed = false;
  private readonly name: StreamName;
  private readonly listener: Promise<PluginListenerHandle>;
  private readonly readyPromise: Promise<void>;

  constructor(options: StreamReceiverOptions) {
    this.name = options.name;
    const port = options.port ?? defaultPortFor(options.name);
    this.listener = StreamUdp.addListener("datagram", (event) => {
      if (event.name !== this.name || !this.datagramHandler) return;
      this.datagramHandler(base64ToBytes(event.data));
    });
    this.readyPromise = StreamUdp.bind({ name: this.name, port })
      .then((result) => {
        if (this.closed) return;
        this.destination = options.destination ?? `${result.localIp}:${result.port}`;
        this.stateHandler?.("open");
      })
      .catch((error) => {
        this.stateHandler?.("error");
        addLog("warn", "Native UDP stream bind failed", { error: (error as Error)?.message ?? String(error) });
      });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  onDatagram(handler: (data: Uint8Array) => void): void {
    this.datagramHandler = handler;
  }

  onStateChange(handler: (state: StreamConnectionState) => void): void {
    this.stateHandler = handler;
    handler("connecting");
  }

  close(): void {
    this.closed = true;
    void StreamUdp.close({ name: this.name }).catch(() => {});
    void this.listener.then((handle) => handle.remove()).catch(() => {});
    if (this.stateHandler) this.stateHandler("closed");
  }
}

/** Unavailable-transport fallback (e.g. a platform with neither bridge nor UDP plugin). */
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
 * Resolve a receiver for the platform: native binds a UDP socket via the StreamUdp plugin;
 * web/Docker consumes the server's UDP -> WebSocket bridge (a caller may inject a
 * socketFactory for tests). Either falls back to an unsupported receiver on construction error.
 */
export const createStreamReceiver = (options: StreamReceiverOptions): StreamReceiver => {
  if (isNativePlatform()) {
    try {
      return new NativeUdpStreamReceiver(options);
    } catch {
      return new UnsupportedStreamReceiver();
    }
  }
  try {
    return new WebSocketStreamReceiver(options);
  } catch {
    return new UnsupportedStreamReceiver();
  }
};
