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
import type { SenderFilterDiagnostics } from "./senderMismatch";
import { Capacitor, type PluginListenerHandle } from "@capacitor/core";

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
    handler: (
      frame: Uint8Array,
      height: number,
      arrivalMs: number,
      droppedPackets: number,
      framesLost: number,
      present: boolean,
    ) => void,
  ): void;
  /**
   * Optional: push the video keep-fraction (0–1) to a transport that decimates natively (the Android
   * plugin), so decimated frames skip their Base64 encode + bridge payload. Present only when the
   * transport supports it; the caller falls back to JS-side decimation otherwise.
   */
  /** Returns true iff the NATIVE side will decimate (assembly on); false → keep JS decimation. */
  setNativeCadence?(fraction: number): boolean;
  onStateChange(handler: (state: StreamConnectionState) => void): void;
  /**
   * Optional: what the transport's sender filter has dropped, and whose packets those were.
   *
   * Present only where a filter exists (the native plugin). The mirror controllers read it when a
   * live stream goes silent, because a filter aimed at the wrong address of a dual-homed Ultimate
   * is silent in exactly the same way as a stream that stopped — see `streams/senderMismatch`.
   */
  readDiagnostics?(): Promise<SenderFilterDiagnostics | null>;
  /**
   * Optional: point the sender filter at a different machine on the already-bound socket.
   *
   * Used by the one-tap recovery from a filter mismatch, and cheaper than a restart: the socket
   * stays in the multicast group, so the next packet from the adopted sender is accepted.
   */
  setExpectedSource?(host: string | null): Promise<void>;
  /** The host:port the device should stream to (the receiver's own address). */
  readonly destination: string;
  /**
   * The **unicast** host:port for a Wi‑Fi audio stream (firmware `wifi=true`) —
   * the phone's own site-local address + this receiver's port. Present only on
   * the native transport (learned from the UDP bind), and only once {@link ready}
   * resolves. Undefined ⇒ this transport can't receive a Wi‑Fi stream, so callers
   * must use {@link destination} (Ethernet multicast) instead.
   */
  readonly wifiDestination?: string;
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
  /**
   * The machine whose packets this receiver should accept, as a host name or IPv4.
   *
   * The mirror's groups are multicast and every Ultimate defaults to the same ones, so a second
   * machine streaming into them arrives here too. Naming the expected sender lets the native
   * receiver drop the rest before any frame assembly, which is what keeps the picture right without
   * depending on the other machine being stopped. Omitted accepts any sender.
   */
  expectedSource?: string | null;
  /**
   * Demo Mode: receive from the mock stream server on loopback instead of joining the real
   * multicast group. Joining a multicast group needs a live network interface ({@link
   * MULTICAST_GROUP} would otherwise fail `StreamUdp.bind` outright with Wi-Fi off / airplane
   * mode), but 127.0.0.1 is always reachable regardless of network state — which is also what
   * keeps the synthetic stream off the shared LAN entirely. See {@link MockStreamServer}.
   */
  demoLoopback?: boolean;
  /** Injectable WebSocket constructor for tests. */
  socketFactory?: (url: string) => WebSocketLike;
}

/** Loopback host Demo Mode's mock stream server sends to and {@link demoLoopback} receives on. */
export const DEMO_LOOPBACK_HOST = "127.0.0.1";

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
    | ((
        frame: Uint8Array,
        height: number,
        arrivalMs: number,
        droppedPackets: number,
        framesLost: number,
        present: boolean,
      ) => void)
    | null = null;
  private static readonly EMPTY = new Uint8Array(0);
  private stateHandler: ((state: StreamConnectionState) => void) | null = null;
  destination = "";
  /** Unicast phone-address:port for a Wi‑Fi audio stream — set once bind resolves. */
  wifiDestination: string | undefined = undefined;
  private closed = false;
  private readonly name: StreamName;
  private readonly assemble: boolean;
  private readonly listeners: Promise<PluginListenerHandle | undefined>[] = [];
  private readonly readyPromise: Promise<void>;

  constructor(options: StreamReceiverOptions) {
    this.name = options.name;
    const port = options.port ?? defaultPortFor(options.name);
    // Demo Mode's mock stream server sends to loopback and never joins a multicast group (see
    // demoLoopback's doc comment) — binding a plain unicast socket needs no network interface.
    const group = options.demoLoopback ? undefined : MULTICAST_GROUP[options.name];
    // Native frame assembly is a video-only fast path; audio stays per-packet (~250/s is cheap).
    this.assemble = options.name === "video" && (options.nativeVideoAssembly ?? true);
    // Destination is the multicast group, or loopback in Demo Mode (known up front either way).
    this.destination =
      options.destination ??
      (options.demoLoopback ? `${DEMO_LOOPBACK_HOST}:${port}` : multicastDestination(options.name, port));
    // Always listen for per-packet datagrams (audio, and the video fallback when assembly is off).
    this.listeners.push(
      this.trackListener(
        "datagram",
        StreamUdp.addListener("datagram", (event) => {
          if (event.name !== this.name || !this.datagramHandler) return;
          // Prefer the native wire-arrival stamp; fall back for pre-timestamp plugin builds.
          this.datagramHandler(base64ToBytes(event.data), typeof event.t === "number" ? event.t : nowMs());
        }),
      ),
    );
    // In assembly mode the plugin emits whole frames instead — one bridge hop per frame, not per packet.
    if (this.assemble) {
      this.listeners.push(
        this.trackListener(
          "videoframe",
          StreamUdp.addListener("videoframe", (event) => {
            if (event.name !== this.name || !this.frameHandler) return;
            // Decimated frames (present=false) carry no payload — skip the base64 decode entirely.
            const present = event.present !== false;
            this.frameHandler(
              present ? base64ToBytes(event.data) : NativeUdpStreamReceiver.EMPTY,
              event.height,
              typeof event.t === "number" ? event.t : nowMs(),
              event.dropped ?? 0,
              event.lost ?? 0,
              present,
            );
          }),
        ),
      );
    }
    this.readyPromise = StreamUdp.bind({
      name: this.name,
      port,
      group,
      assemble: this.assemble,
      source: options.expectedSource ?? undefined,
    })
      .then((result) => {
        // The bind reports the phone's site-local IPv4 — the unicast address a
        // Wi‑Fi audio stream (firmware wifi=true) must be relayed to.
        if (result?.localIp) this.wifiDestination = `${result.localIp}:${port}`;
        if (!this.closed) this.stateHandler?.("open");
      })
      .catch((error) => {
        this.stateHandler?.("error");
        addLog("warn", "Native UDP stream bind failed", { error: (error as Error)?.message ?? String(error) });
        // Rethrow: audioMirrorController/videoMirrorController await ready() inside a
        // try/catch specifically to avoid telling the device to stream into a socket
        // that was never bound (HARD25-004). A resolved readyPromise here would let
        // that happen silently, with only this warn log to show for it.
        throw error;
      });
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  onDatagram(handler: (data: Uint8Array, arrivalMs: number) => void): void {
    this.datagramHandler = handler;
  }

  onFrame(
    handler: (
      frame: Uint8Array,
      height: number,
      arrivalMs: number,
      droppedPackets: number,
      framesLost: number,
      present: boolean,
    ) => void,
  ): void {
    this.frameHandler = handler;
  }

  /**
   * Push the keep-fraction to the native assembler (video only) so it decimates before encoding.
   * Returns whether the NATIVE path will actually decimate: false when native assembly is off (the
   * escape hatch), so the caller keeps JS-side decimation enabled instead of assuming the native
   * side handled it — otherwise Auto/50%/25% would silently render every frame.
   */
  setNativeCadence(fraction: number): boolean {
    if (!this.assemble) return false;
    const permille = Math.max(0, Math.min(1000, Math.round(fraction * 1000)));
    void StreamUdp.setKeepFraction({ name: this.name, permille }).catch((error) => {
      addLog("debug", "Native keep-fraction set failed", { error: (error as Error)?.message ?? String(error) });
    });
    return true;
  }

  onStateChange(handler: (state: StreamConnectionState) => void): void {
    this.stateHandler = handler;
    handler("connecting");
  }

  /**
   * Read the plugin's sender-filter counters. Null when the plugin cannot answer — a diagnosis that
   * cannot be made must not replace the plain "stopped arriving" message with an error of its own.
   */
  async readDiagnostics(): Promise<SenderFilterDiagnostics | null> {
    try {
      return await StreamUdp.readStreamDiagnostics({ name: this.name });
    } catch (error) {
      addLog("debug", "Native stream diagnostics read failed", {
        name: this.name,
        error: (error as Error)?.message ?? String(error),
      });
      return null;
    }
  }

  /** Retarget the sender filter on the bound socket (the mismatch recovery). */
  async setExpectedSource(host: string | null): Promise<void> {
    await StreamUdp.setExpectedSource({ name: this.name, host });
  }

  /**
   * A registration that rejects — the plugin is missing on this platform — would otherwise be an
   * unhandled rejection, because the only `.catch` used to be added later in `close()`. Resolve to
   * `undefined` instead so the reason is logged once and `close()` has nothing to remove.
   */
  private trackListener(
    event: string,
    registration: Promise<PluginListenerHandle>,
  ): Promise<PluginListenerHandle | undefined> {
    return registration.catch((error: unknown) => {
      addLog("warn", "Stream receiver: registering a native listener failed", {
        name: this.name,
        event,
        error: (error as Error)?.message ?? String(error),
      });
      return undefined;
    });
  }

  close(): void {
    this.closed = true;
    // Logged, not swallowed. A close that fails leaves the native socket bound to the multicast
    // group, so the next start binds a second one; with nothing recorded, the only evidence is a
    // stream that behaves oddly some time later.
    void StreamUdp.close({ name: this.name }).catch((error: unknown) => {
      addLog("warn", "Stream receiver: closing the native UDP socket failed", {
        name: this.name,
        error: (error as Error)?.message ?? String(error),
      });
    });
    for (const listener of this.listeners) {
      void listener
        .then((handle) => handle?.remove())
        .catch((error: unknown) => {
          addLog("warn", "Stream receiver: removing a native listener failed", {
            name: this.name,
            error: (error as Error)?.message ?? String(error),
          });
        });
    }
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
 * Whether this platform can receive a stream at all. Native needs the StreamUdp plugin, which is
 * registered on Android only; web/Docker uses the server's UDP -> WebSocket bridge. iOS has
 * neither, so the UI that offers Live View has to ask this rather than assume "native means yes"
 * (HARD27-002).
 */
export const hasStreamTransport = (): boolean =>
  isNativePlatform() ? Capacitor.isPluginAvailable("StreamUdp") : typeof WebSocket !== "undefined";

/**
 * Resolve a receiver for the platform: native binds a UDP socket via the StreamUdp plugin;
 * web/Docker consumes the server's UDP -> WebSocket bridge (a caller may inject a
 * socketFactory for tests). Either falls back to an unsupported receiver on construction error.
 */
export const createStreamReceiver = (options: StreamReceiverOptions): StreamReceiver => {
  // The fallback is deliberate — a platform without a transport should degrade rather than throw
  // into the caller — but the REASON has to survive it. Without this, Live View reported "error"
  // with nothing anywhere saying which constructor failed or why, which is the whole diagnosis.
  const unsupported = (transport: string, error: unknown): StreamReceiver => {
    addLog("warn", "Stream receiver unavailable; falling back to the unsupported transport", {
      name: options.name,
      transport,
      error: (error as Error)?.message ?? String(error),
    });
    return new UnsupportedStreamReceiver();
  };
  if (isNativePlatform()) {
    // "Native" is not the capability — the StreamUdp plugin is. It is registered on Android only,
    // so on iOS this used to build a receiver whose every plugin call rejects: two unhandled
    // rejections plus a generic "could not start streaming" instead of a deliberate degradation.
    if (!Capacitor.isPluginAvailable("StreamUdp")) {
      return unsupported("native-udp", new Error("The StreamUdp plugin is not available on this platform"));
    }
    try {
      return new NativeUdpStreamReceiver(options);
    } catch (error) {
      return unsupported("native-udp", error);
    }
  }
  try {
    return new WebSocketStreamReceiver(options);
  } catch (error) {
    return unsupported("websocket-bridge", error);
  }
};
