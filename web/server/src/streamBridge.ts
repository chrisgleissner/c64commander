/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer A/V Mirror — the web/Docker UDP→WebSocket stream bridge.
 *
 * The C64 Ultimate streams raw VIC video / audio as UDP datagrams to a destination
 * host:port (see the c64stream sibling project). A browser cannot receive UDP, so on
 * the web/Docker build this bridge is that destination: it binds the two UDP ports and
 * forwards every datagram, unchanged, to any WebSocket client subscribed to the
 * matching stream (`/streams/video` or `/streams/audio`). The in-app
 * `WebSocketStreamReceiver` consumes it; the payload stays byte-identical so the app's
 * existing VIC/audio decoders assemble frames exactly as they would from the device.
 *
 * Deliberately dependency-free: a minimal RFC 6455 server (handshake + unmasked binary
 * frames out, close/ping handling in) over Node's own `http` upgrade + `dgram`, so the
 * web server keeps its lean, un-bundled footprint.
 */

import type http from "node:http";
import type { Duplex } from "node:stream";
import dgram from "node:dgram";
import crypto from "node:crypto";

export const DEFAULT_STREAM_VIDEO_PORT = 11000;
export const DEFAULT_STREAM_AUDIO_PORT = 11001;
// The device streams to multicast by default (unicast fails to ARP-resolve; see the app's
// MULTICAST_GROUP). The bridge joins these groups so it receives the datagrams.
export const DEFAULT_STREAM_VIDEO_GROUP = "239.0.1.64";
export const DEFAULT_STREAM_AUDIO_GROUP = "239.0.1.65";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

export type StreamName = "video" | "audio";

type BridgeLog = (
  level: "info" | "warn" | "error" | "debug",
  message: string,
  details?: Record<string, unknown>,
) => void;

export interface StreamBridgeOptions {
  videoPort?: number;
  audioPort?: number;
  /** Multicast groups the device streams to; the bridge joins them. Empty string = unicast only. */
  videoGroup?: string;
  audioGroup?: string;
  /** Host the UDP sockets bind to (the device streams here). Defaults to 0.0.0.0. */
  bindHost?: string;
  log?: BridgeLog;
  /** Drop realtime frames for a client once its send buffer exceeds this (default 4 MiB). */
  maxBufferedBytes?: number;
}

interface StreamChannel {
  name: StreamName;
  socket: dgram.Socket;
  clients: Set<Duplex>;
  port: number;
  group: string;
}

/** Encode a server→client binary WebSocket frame (unmasked, single FIN frame). */
export const encodeBinaryFrame = (payload: Buffer): Buffer => {
  const len = payload.length;
  let header: Buffer;
  if (len < 126) {
    header = Buffer.from([0x82, len]);
  } else if (len < 0x10000) {
    header = Buffer.alloc(4);
    header[0] = 0x82;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x82;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
};

const controlFrame = (opcode: number): Buffer => Buffer.from([0x80 | opcode, 0x00]);

const websocketAccept = (key: string): string =>
  crypto
    .createHash("sha1")
    .update(key + WS_GUID)
    .digest("base64");

export class StreamBridge {
  private readonly bindHost: string;
  private readonly maxBufferedBytes: number;
  private readonly log: BridgeLog;
  private readonly channels: Record<StreamName, StreamChannel>;
  private started = false;

  constructor(options: StreamBridgeOptions = {}) {
    this.bindHost = options.bindHost ?? "0.0.0.0";
    this.maxBufferedBytes = options.maxBufferedBytes ?? 4 * 1024 * 1024;
    this.log = options.log ?? (() => {});
    this.channels = {
      video: this.makeChannel(
        "video",
        options.videoPort ?? DEFAULT_STREAM_VIDEO_PORT,
        options.videoGroup ?? DEFAULT_STREAM_VIDEO_GROUP,
      ),
      audio: this.makeChannel(
        "audio",
        options.audioPort ?? DEFAULT_STREAM_AUDIO_PORT,
        options.audioGroup ?? DEFAULT_STREAM_AUDIO_GROUP,
      ),
    };
  }

  private makeChannel(name: StreamName, port: number, group: string): StreamChannel {
    const socket = dgram.createSocket({ type: "udp4", reuseAddr: true });
    const channel: StreamChannel = { name, socket, clients: new Set(), port, group };
    socket.on("message", (msg: Buffer) => this.broadcast(channel, msg));
    socket.on("error", (error) => this.log("warn", `Stream bridge ${name} UDP error`, { error: String(error) }));
    return channel;
  }

  /** Bind both UDP sockets. Resolves once listening (ports are known via boundPorts). */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await Promise.all(
      Object.values(this.channels).map(
        (channel) =>
          new Promise<void>((resolve, reject) => {
            channel.socket.once("error", reject);
            channel.socket.bind(channel.port, this.bindHost, () => {
              channel.socket.off("error", reject);
              channel.port = channel.socket.address().port;
              if (channel.group) {
                try {
                  channel.socket.addMembership(channel.group);
                } catch (error) {
                  this.log("warn", `Stream bridge ${channel.name} multicast join failed`, { error: String(error) });
                }
              }
              resolve();
            });
          }),
      ),
    );
    this.log("info", "A/V mirror stream bridge listening", this.boundPorts() as unknown as Record<string, unknown>);
  }

  boundPorts(): { video: number; audio: number } {
    return { video: this.channels.video.port, audio: this.channels.audio.port };
  }

  clientCount(name: StreamName): number {
    return this.channels[name].clients.size;
  }

  /** WebSocket paths this bridge owns. */
  static pathFor(pathname: string): StreamName | null {
    if (pathname === "/streams/video") return "video";
    if (pathname === "/streams/audio") return "audio";
    return null;
  }

  /**
   * Complete a WebSocket upgrade for `/streams/{video,audio}`. Returns true when the
   * request was handled (handshake done or rejected); false when the path is not a
   * stream path so the caller can fall through to its own upgrade handling.
   */
  handleUpgrade(req: http.IncomingMessage, socket: Duplex, pathname: string): boolean {
    const name = StreamBridge.pathFor(pathname);
    if (!name) return false;

    const key = req.headers["sec-websocket-key"];
    const upgrade = String(req.headers["upgrade"] ?? "").toLowerCase();
    if (typeof key !== "string" || upgrade !== "websocket") {
      socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
      return true;
    }

    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${websocketAccept(key)}\r\n\r\n`,
    );
    (socket as unknown as { setNoDelay?: (value: boolean) => void }).setNoDelay?.(true);

    const channel = this.channels[name];
    channel.clients.add(socket);
    this.log("debug", `A/V mirror ${name} client connected`, { clients: channel.clients.size });

    const drop = () => {
      if (channel.clients.delete(socket)) {
        this.log("debug", `A/V mirror ${name} client disconnected`, { clients: channel.clients.size });
      }
      socket.destroy();
    };

    this.readClientFrames(socket, drop);
    socket.on("close", () => channel.clients.delete(socket));
    socket.on("error", drop);
    return true;
  }

  /**
   * Minimal inbound frame reader: the browser never sends stream data, so we only
   * honour Close (reply Close, drop) and Ping (reply Pong); other frames are ignored.
   */
  private readClientFrames(socket: Duplex, drop: () => void): void {
    let buffer: Buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = buffer.length ? Buffer.concat([buffer, chunk]) : chunk;
      for (;;) {
        if (buffer.length < 2) return;
        const opcode = buffer[0] & 0x0f;
        const masked = (buffer[1] & 0x80) !== 0;
        let len = buffer[1] & 0x7f;
        let offset = 2;
        if (len === 126) {
          if (buffer.length < 4) return;
          len = buffer.readUInt16BE(2);
          offset = 4;
        } else if (len === 127) {
          if (buffer.length < 10) return;
          len = Number(buffer.readBigUInt64BE(2));
          offset = 10;
        }
        if (masked) offset += 4;
        if (buffer.length < offset + len) return; // wait for the rest
        buffer = buffer.subarray(offset + len);

        if (opcode === OPCODE_CLOSE) {
          socket.write(controlFrame(OPCODE_CLOSE));
          drop();
          return;
        }
        if (opcode === OPCODE_PING) socket.write(controlFrame(OPCODE_PONG));
      }
    });
  }

  private broadcast(channel: StreamChannel, payload: Buffer): void {
    if (channel.clients.size === 0) return;
    const frame = encodeBinaryFrame(payload);
    for (const socket of channel.clients) {
      // Realtime: if a slow client backs up, drop this frame rather than buffer without bound.
      if (socket.writableLength > this.maxBufferedBytes) continue;
      socket.write(frame);
    }
  }

  async close(): Promise<void> {
    for (const channel of Object.values(this.channels)) {
      for (const socket of channel.clients) socket.destroy();
      channel.clients.clear();
      await new Promise<void>((resolve) => channel.socket.close(() => resolve()));
    }
  }
}

export const createStreamBridge = (options?: StreamBridgeOptions): StreamBridge => new StreamBridge(options);
