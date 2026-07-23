/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Proves the A/V mirror web transport end to end WITHOUT hardware: fake VIC/audio UDP
 * datagrams (identical in shape to what the C64 Ultimate / c64stream emit) are sent to
 * the bridge's UDP ports, and we assert a real WebSocket client receives them
 * byte-for-byte — and that the bridged bytes drive the app's real VIC assembler to a
 * complete frame. This is the test the "make it actually work + prove it" ask requires.
 */

import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import dgram from "node:dgram";
import net from "node:net";
import crypto from "node:crypto";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import { createStreamBridge, encodeBinaryFrame, StreamBridge } from "../../../web/server/src/streamBridge";
import {
  VicStreamAssembler,
  VIC_HEADER_BYTES,
  VIC_BYTES_PER_LINE,
  VIC_LINES_PER_PACKET,
  VIC_BITS_PER_PIXEL,
} from "../../../src/lib/streams/vicStream";
import { VIC_PAL_HEIGHT, VIC_BYTES_PER_FRAME, VIC_FRAME_WIDTH } from "../../../src/lib/streams/vicDecode";

const VIC_PACKET_PAYLOAD = VIC_LINES_PER_PACKET * VIC_BYTES_PER_LINE; // 768
const PAL_PACKETS = VIC_PAL_HEIGHT / VIC_LINES_PER_PACKET; // 68

/** Build a valid VIC datagram (12-byte LE header + 4×192 payload) the assembler accepts. */
const makeVicPacket = ({
  seq,
  line,
  lastLine,
  fill,
}: {
  seq: number;
  line: number;
  lastLine: boolean;
  fill: number;
}): Buffer => {
  const pkt = Buffer.alloc(VIC_HEADER_BYTES + VIC_PACKET_PAYLOAD);
  pkt.writeUInt16LE(seq & 0xffff, 0); // seq
  pkt.writeUInt16LE(0, 2); // frame
  pkt.writeUInt16LE((line & 0x7fff) | (lastLine ? 0x8000 : 0), 4); // line + last-line flag
  pkt.writeUInt16LE(VIC_FRAME_WIDTH, 6); // width 384
  pkt[8] = VIC_LINES_PER_PACKET; // 4
  pkt[9] = VIC_BITS_PER_PIXEL; // 4
  pkt.writeUInt16LE(0, 10); // enc
  pkt.fill(fill, VIC_HEADER_BYTES); // payload
  return pkt;
};

/** A minimal audio datagram: 2-byte seq + 192 stereo frames (4 bytes each). */
const makeAudioPacket = (seq: number, fill: number): Buffer => {
  const pkt = Buffer.alloc(2 + 192 * 4);
  pkt.writeUInt16LE(seq & 0xffff, 0);
  pkt.fill(fill, 2);
  return pkt;
};

const waitFor = async (predicate: () => boolean, timeoutMs = 3000): Promise<void> => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
};

interface Harness {
  bridge: StreamBridge;
  server: http.Server;
  httpPort: number;
  udp: { video: number; audio: number };
  openClient: (name: "video" | "audio") => Promise<Client>;
  sendUdp: (port: number, packet: Buffer) => Promise<void>;
  close: () => Promise<void>;
}

interface Client {
  ws: WebSocket;
  messages: Uint8Array[];
  waitForMessages: (n: number) => Promise<void>;
}

const startHarness = async (): Promise<Harness> => {
  const bridge = createStreamBridge({ videoPort: 0, audioPort: 0 });
  await bridge.start();

  const server = http.createServer((_req, res) => res.end());
  server.on("upgrade", (req, socket) => {
    const pathname = new URL(req.url ?? "/", "http://localhost").pathname;
    if (!bridge.handleUpgrade(req, socket, pathname)) socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const httpPort = (server.address() as AddressInfo).port;

  const udpSenders: dgram.Socket[] = [];
  const clients: Client[] = [];

  const openClient = async (name: "video" | "audio"): Promise<Client> => {
    const ws = new WebSocket(`ws://127.0.0.1:${httpPort}/streams/${name}`);
    ws.binaryType = "arraybuffer";
    const messages: Uint8Array[] = [];
    ws.onmessage = (event) => messages.push(new Uint8Array(event.data as ArrayBuffer));
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
    });
    // Wait until the bridge has actually registered this client before any UDP is sent.
    await waitFor(() => bridge.clientCount(name) >= clients.filter((c) => c.ws.url.endsWith(name)).length + 1);
    const client: Client = {
      ws,
      messages,
      waitForMessages: (n) => waitFor(() => messages.length >= n),
    };
    clients.push(client);
    return client;
  };

  const sendUdp = (port: number, packet: Buffer): Promise<void> =>
    new Promise((resolve, reject) => {
      const sender = dgram.createSocket("udp4");
      udpSenders.push(sender);
      sender.send(packet, port, "127.0.0.1", (err) => (err ? reject(err) : resolve()));
    });

  return {
    bridge,
    server,
    httpPort,
    udp: bridge.boundPorts(),
    openClient,
    sendUdp,
    close: async () => {
      for (const c of clients) c.ws.close();
      for (const s of udpSenders) s.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await bridge.close();
    },
  };
};

describe("A/V mirror stream bridge (UDP → WebSocket)", () => {
  let harness: Harness | null = null;
  afterEach(async () => {
    await harness?.close();
    harness = null;
  });

  it("relays a fake VIC datagram to a WebSocket client byte-for-byte", async () => {
    harness = await startHarness();
    const client = await harness.openClient("video");

    const packet = makeVicPacket({ seq: 0, line: 0, lastLine: false, fill: 0x5a });
    await harness.sendUdp(harness.udp.video, packet);

    await client.waitForMessages(1);
    expect(client.messages).toHaveLength(1);
    expect(Buffer.from(client.messages[0])).toEqual(packet);
  });

  it("delivers a full stream of fake packets that the real VIC assembler completes into a frame", async () => {
    harness = await startHarness();
    const client = await harness.openClient("video");

    // One PAL frame: lines 0,4,…,268; the last line carries the completion flag.
    for (let i = 0; i < PAL_PACKETS; i++) {
      const line = i * VIC_LINES_PER_PACKET;
      await harness.sendUdp(
        harness.udp.video,
        makeVicPacket({ seq: i, line, lastLine: i === PAL_PACKETS - 1, fill: (i % 15) + 1 }),
      );
    }
    await client.waitForMessages(PAL_PACKETS);

    // Feed the bridged bytes into the app's real assembler (sorted by line so the test is
    // robust to any UDP reordering); the last packet must yield a complete frame.
    const assembler = new VicStreamAssembler();
    const lineOf = (m: Uint8Array) => (m[4] | (m[5] << 8)) & 0x7fff;
    const sorted = [...client.messages].sort((a, b) => lineOf(a) - lineOf(b));
    let frame: Uint8Array | null = null;
    for (const msg of sorted) frame = assembler.ingest(msg) ?? frame;

    expect(frame).not.toBeNull();
    expect(frame!.length).toBe(VIC_BYTES_PER_FRAME);
    expect(assembler.frameHeight).toBe(VIC_PAL_HEIGHT);
    expect(assembler.stats.frames).toBe(1);
    // Spot-check content: line 0's first payload byte was fill=1, written at offset 0.
    expect(frame![0]).toBe(1);
  });

  it("relays a fake audio datagram on the audio channel and keeps streams isolated", async () => {
    harness = await startHarness();
    const audio = await harness.openClient("audio");
    const video = await harness.openClient("video");

    const audioPacket = makeAudioPacket(7, 0x11);
    await harness.sendUdp(harness.udp.audio, audioPacket);
    await audio.waitForMessages(1);
    expect(Buffer.from(audio.messages[0])).toEqual(audioPacket);

    // A video datagram must never surface on the audio client.
    await harness.sendUdp(harness.udp.video, makeVicPacket({ seq: 0, line: 0, lastLine: true, fill: 3 }));
    await video.waitForMessages(1);
    expect(audio.messages).toHaveLength(1); // still just the one audio packet
  });

  it("broadcasts one datagram to every client on the same stream", async () => {
    harness = await startHarness();
    const a = await harness.openClient("video");
    const b = await harness.openClient("video");
    expect(harness.bridge.clientCount("video")).toBe(2);

    await harness.sendUdp(harness.udp.video, makeVicPacket({ seq: 0, line: 0, lastLine: true, fill: 9 }));
    await a.waitForMessages(1);
    await b.waitForMessages(1);
    expect(a.messages[0][0]).toBe(b.messages[0][0]);
  });

  it("drops a client from the count once its socket closes", async () => {
    harness = await startHarness();
    const client = await harness.openClient("video");
    expect(harness.bridge.clientCount("video")).toBe(1);
    client.ws.close();
    await waitFor(() => harness!.bridge.clientCount("video") === 0);
    expect(harness.bridge.clientCount("video")).toBe(0);
  });

  it("rejects a non-stream upgrade path so the caller can handle it", () => {
    const bridge = createStreamBridge();
    expect(StreamBridge.pathFor("/streams/video")).toBe("video");
    expect(StreamBridge.pathFor("/streams/audio")).toBe("audio");
    expect(StreamBridge.pathFor("/something-else")).toBeNull();
  });

  it("answers a client Ping with a Pong and a client Close with a Close (RFC 6455 control frames)", async () => {
    harness = await startHarness();

    // A minimal raw-socket WebSocket client so we can send masked control frames the
    // browser WebSocket API does not expose.
    const socket = net.connect(harness.httpPort, "127.0.0.1");
    const opcodes: number[] = [];
    await new Promise<void>((resolve, reject) => {
      let handshakeDone = false;
      socket.on("error", reject);
      socket.on("data", (chunk: Buffer) => {
        let data = chunk;
        if (!handshakeDone) {
          const text = chunk.toString("latin1");
          expect(text).toContain("101");
          handshakeDone = true;
          const bodyStart = chunk.indexOf("\r\n\r\n");
          data = chunk.subarray(bodyStart + 4);
        }
        for (let i = 0; i + 1 < data.length;) {
          opcodes.push(data[i] & 0x0f);
          i += 2 + (data[i + 1] & 0x7f); // control frames here are always 0-length + unmasked
        }
      });
      const key = crypto.randomBytes(16).toString("base64");
      socket.write(
        `GET /streams/video HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\n` +
          `Connection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`,
      );
      setTimeout(resolve, 50); // allow the 101 to arrive
    });

    const maskedFrame = (opcode: number): Buffer => {
      const mask = crypto.randomBytes(4);
      return Buffer.concat([Buffer.from([0x80 | opcode, 0x80]), mask]); // FIN, opcode, masked, len 0
    };
    socket.write(maskedFrame(0x9)); // Ping
    await waitFor(() => opcodes.includes(0xa)); // Pong
    socket.write(maskedFrame(0x8)); // Close
    await waitFor(() => opcodes.includes(0x8)); // Close echoed
    await waitFor(() => harness!.bridge.clientCount("video") === 0);
    socket.destroy();
  });
});

describe("encodeBinaryFrame", () => {
  const decode = (frame: Buffer) => {
    expect(frame[0]).toBe(0x82); // FIN + binary opcode
    const len7 = frame[1] & 0x7f;
    expect(frame[1] & 0x80).toBe(0); // server frames are unmasked
    if (len7 < 126) return frame.subarray(2, 2 + len7);
    if (len7 === 126) return frame.subarray(4, 4 + frame.readUInt16BE(2));
    return frame.subarray(10, 10 + Number(frame.readBigUInt64BE(2)));
  };

  it("encodes a small payload with a 2-byte header", () => {
    const payload = Buffer.from([1, 2, 3, 4]);
    const frame = encodeBinaryFrame(payload);
    expect(frame[1]).toBe(4);
    expect(decode(frame)).toEqual(payload);
  });

  it("encodes a medium payload with a 16-bit extended length", () => {
    const payload = Buffer.alloc(1000, 7);
    const frame = encodeBinaryFrame(payload);
    expect(frame[1]).toBe(126);
    expect(frame.readUInt16BE(2)).toBe(1000);
    expect(decode(frame)).toEqual(payload);
  });

  it("encodes a large payload with a 64-bit extended length", () => {
    const payload = Buffer.alloc(70000, 3);
    const frame = encodeBinaryFrame(payload);
    expect(frame[1]).toBe(127);
    expect(Number(frame.readBigUInt64BE(2))).toBe(70000);
    expect(decode(frame).length).toBe(70000);
  });
});
