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
 *   - Native: the StreamUdp Capacitor plugin binds the UDP port and joins the multicast
 *     group directly; the NativeUdpStreamReceiver consumes its `datagram` events.
 *
 * The device streams to a **multicast group** ({@link MULTICAST_GROUP}) — unicast fails
 * ("Network Host Resolve Error") because the firmware streams from its wired port and
 * cannot ARP-resolve a Wi-Fi client. The receiver only transports datagrams and connection
 * state; telling the device where to stream (PUT /v1/streams/{name}:start?ip=…) is the hook's job.
 */

export type StreamName = "audio" | "video";
export type StreamConnectionState = "connecting" | "open" | "closed" | "error";

export interface StreamReceiver {
  /**
   * `arrivalMs` is a monotonic wire-arrival timestamp (ms). Native supplies the plugin's
   * `System.nanoTime`-based stamp captured off the socket (before the bridge/decode); the web
   * bridge supplies `performance.now()` at message receipt. The A/V sync analyzer measures the
   * audio↔video offset from this so asymmetric downstream latency cannot skew it.
   */
  onDatagram(handler: (data: Uint8Array, arrivalMs: number) => void): void;
  /**
   * Optional native fast path: pre-assembled whole VIC frames. When the transport reassembles
   * frames itself (the native Android plugin with `assemble:true`), it delivers each complete
   * frame here instead of per-packet `datagram`s — so the caller skips JS-side assembly. `frame`
   * is the 52224-byte 4bpp buffer, `height` its line count (PAL 272 / NTSC 240), `arrivalMs` the
   * frame-start wire time, `droppedPackets` the cumulative sequence-gap count, and `framesLost` the
   * cumulative frame-number gaps (frames that never completed). Transports that do not assemble (web
   * WebSocket bridge, audio) omit this method; the caller falls back to `onDatagram` + JS assembly.
   */
  onFrame?(
    handler: (frame: Uint8Array, height: number, arrivalMs: number, droppedPackets: number, framesLost: number) => void,
  ): void;
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
  /**
   * Native video fast path: assemble VIC frames in the plugin (one bridge hop per frame). Video-only
   * and native-only; defaults on. Threaded from the app setting so it can be A/B toggled at runtime.
   */
  nativeVideoAssembly?: boolean;
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

/**
 * The firmware's default (and reliable) stream destinations are **multicast** — a unicast
 * `streams:start` fails with "Network Host Resolve Error" because the device streams from its
 * wired port and cannot ARP-resolve a Wi-Fi client. The receiver joins the group instead
 * (matching the device's `Stream VIC/Audio to` config defaults).
 */
export const MULTICAST_GROUP: Record<StreamName, string> = { video: "239.0.1.64", audio: "239.0.1.65" };

const defaultPortFor = (name: StreamName) => (name === "audio" ? DEFAULT_AUDIO_PORT : DEFAULT_VIDEO_PORT);
const multicastDestination = (name: StreamName, port: number) => `${MULTICAST_GROUP[name]}:${port}`;

/** Monotonic clock for wire-arrival stamps; falls back to Date.now where performance is absent. */
const nowMs = (): number => (typeof performance !== "undefined" ? performance.now() : Date.now());

const toUint8 = (data: unknown): Uint8Array | null => {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  return null;
};

/** Web receiver: consumes the app server's UDP→WebSocket bridge. */
export class WebSocketStreamReceiver implements StreamReceiver {
  private socket: WebSocketLike;
  private datagramHandler: ((data: Uint8Array, arrivalMs: number) => void) | null = null;
  private stateHandler: ((state: StreamConnectionState) => void) | null = null;
  readonly destination: string;

  constructor(options: StreamReceiverOptions) {
    const bridge = options.bridgeUrl ?? deriveBridgeUrl();
    const port = options.port ?? defaultPortFor(options.name);
    const url = `${bridge.replace(/\/+$/, "")}/streams/${options.name}`;
    // Tell the device to stream to the multicast group; the web server's bridge joins it.
    this.destination = options.destination ?? multicastDestination(options.name, port);
    const factory = options.socketFactory ?? defaultSocketFactory;
    this.socket = factory(url);
    this.socket.binaryType = "arraybuffer";
    this.socket.onopen = () => this.stateHandler?.("open");
    this.socket.onclose = () => this.stateHandler?.("closed");
    this.socket.onerror = () => this.stateHandler?.("error");
    this.socket.onmessage = (event) => {
      const bytes = toUint8(event.data);
      if (bytes) this.datagramHandler?.(bytes, nowMs());
    };
  }

  onDatagram(handler: (data: Uint8Array, arrivalMs: number) => void): void {
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
  private datagramHandler: ((data: Uint8Array, arrivalMs: number) => void) | null = null;
  private frameHandler:
    | ((frame: Uint8Array, height: number, arrivalMs: number, droppedPackets: number, framesLost: number) => void)
    | null = null;
  private stateHandler: ((state: StreamConnectionState) => void) | null = null;
  destination = "";
  private closed = false;
  private readonly name: StreamName;
  private readonly assemble: boolean;
  private readonly listeners: Promise<PluginListenerHandle>[] = [];
  private readonly readyPromise: Promise<void>;

  constructor(options: StreamReceiverOptions) {
    this.name = options.name;
    const port = options.port ?? defaultPortFor(options.name);
    const group = MULTICAST_GROUP[options.name];
    // Native frame assembly is a video-only fast path; audio stays per-packet (~250/s is cheap).
    this.assemble = options.name === "video" && (options.nativeVideoAssembly ?? true);
    // Destination is the multicast group (known up front); the device streams there.
    this.destination = options.destination ?? multicastDestination(options.name, port);
    // Always listen for per-packet datagrams (audio, and the video fallback when assembly is off).
    this.listeners.push(
      StreamUdp.addListener("datagram", (event) => {
        if (event.name !== this.name || !this.datagramHandler) return;
        // Prefer the native wire-arrival stamp; fall back for pre-timestamp plugin builds.
        this.datagramHandler(base64ToBytes(event.data), typeof event.t === "number" ? event.t : nowMs());
      }),
    );
    // In assembly mode the plugin emits whole frames instead — one bridge hop per frame, not per packet.
    if (this.assemble) {
      this.listeners.push(
        StreamUdp.addListener("videoframe", (event) => {
          if (event.name !== this.name || !this.frameHandler) return;
          this.frameHandler(
            base64ToBytes(event.data),
            event.height,
            typeof event.t === "number" ? event.t : nowMs(),
            event.dropped ?? 0,
            event.lost ?? 0,
          );
        }),
      );
    }
    this.readyPromise = StreamUdp.bind({ name: this.name, port, group, assemble: this.assemble })
      .then(() => {
        if (!this.closed) this.stateHandler?.("open");
      })
      .catch((error) => {
        this.stateHandler?.("error");
        addLog("warn", "Native UDP stream bind failed", { error: (error as Error)?.message ?? String(error) });
      });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  onDatagram(handler: (data: Uint8Array, arrivalMs: number) => void): void {
    this.datagramHandler = handler;
  }

  onFrame(
    handler: (frame: Uint8Array, height: number, arrivalMs: number, droppedPackets: number, framesLost: number) => void,
  ): void {
    this.frameHandler = handler;
  }

  onStateChange(handler: (state: StreamConnectionState) => void): void {
    this.stateHandler = handler;
    handler("connecting");
  }

  close(): void {
    this.closed = true;
    void StreamUdp.close({ name: this.name }).catch(() => {});
    for (const listener of this.listeners) void listener.then((handle) => handle.remove()).catch(() => {});
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
