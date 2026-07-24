/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  VIC_BYTES_PER_FRAME,
  VIC_PALETTE_RGB,
  buildPaletteLUT,
  clampFrameHeight,
  decodeVicFrameInto,
  decodeVicFrameToRGBA,
  isLittleEndian,
  paletteHex,
  sampleBorderColorIndex,
} from "@/lib/streams/vicDecode";
import { VIC_BYTES_PER_LINE, VIC_HEADER_BYTES, VicStreamAssembler, parseVicHeader } from "@/lib/streams/vicStream";
import { AudioBatcher, bytesToInt16LE, deinterleaveStereo, parseAudioPacket } from "@/lib/streams/audioStream";
import { AudioMirrorPlayer, nextStartTime } from "@/lib/streams/audioPlayer";

describe("vicDecode", () => {
  it("decodes a known frame to the expected RGBA (low nibble = left, high = right)", () => {
    const frame = new Uint8Array(VIC_BYTES_PER_FRAME);
    frame[0] = 0x21; // left = 1 (white), right = 2 (red)
    const rgba = decodeVicFrameToRGBA(frame);
    expect(Array.from(rgba.slice(0, 4))).toEqual([0xf7, 0xf7, 0xf7, 0xff]); // white (C64U default)
    expect(Array.from(rgba.slice(4, 8))).toEqual([0x8d, 0x2f, 0x34, 0xff]); // red
  });

  it("LUT decode reproduces the palette bytes for the current platform endianness", () => {
    const frame = new Uint8Array(VIC_BYTES_PER_FRAME);
    frame[0] = 0x30; // left = 0 (black), right = 3
    const lut = buildPaletteLUT();
    const px = new Uint32Array(4);
    decodeVicFrameInto(frame, px, lut);
    const bytes = new Uint8Array(px.buffer);
    // pixel 0 (black)
    expect(Array.from(bytes.slice(0, 4))).toEqual([0x00, 0x00, 0x00, 0xff]);
    // pixel 1 (palette 3)
    expect(Array.from(bytes.slice(4, 8))).toEqual([...VIC_PALETTE_RGB[3], 0xff]);
  });

  it("big-endian LUT lays out RRGGBBAA", () => {
    const lut = buildPaletteLUT(false);
    // palette 1 = white (F7F7F7) -> 0xf7f7f7ff
    expect(lut[1] >>> 0).toBe(0xf7f7f7ff);
    // palette 2 = 8D2F34 -> 0x8d2f34ff
    expect(lut[2] >>> 0).toBe(0x8d2f34ff);
  });

  it("paletteHex and isLittleEndian behave", () => {
    expect(paletteHex(1)).toBe("#f7f7f7");
    expect(paletteHex(2)).toBe("#8d2f34");
    expect(paletteHex(17)).toBe("#f7f7f7"); // wraps
    expect(typeof isLittleEndian()).toBe("boolean");
  });

  it("samples the border pixel colour index", () => {
    const frame = new Uint8Array(VIC_BYTES_PER_FRAME);
    const pixelIndex = 4 * 384 + 4;
    frame[pixelIndex >> 1] = 0x06; // low nibble = 6
    expect(sampleBorderColorIndex(frame)).toBe(6);
    expect(sampleBorderColorIndex(new Uint8Array(0))).toBe(0);
  });

  it("clamps a frame height into the [NTSC, PAL] range", () => {
    expect(clampFrameHeight(272)).toBe(272);
    expect(clampFrameHeight(240)).toBe(240);
    expect(clampFrameHeight(300)).toBe(272); // above PAL -> PAL
    expect(clampFrameHeight(100)).toBe(240); // below NTSC -> NTSC
  });
});

const buildVicPacket = (opts: {
  seq?: number;
  frame?: number;
  line: number;
  lastLine?: boolean;
  width?: number;
  linesPerPacket?: number;
  bpp?: number;
  payload: Uint8Array;
}) => {
  const packet = new Uint8Array(VIC_HEADER_BYTES + opts.payload.length);
  const view = new DataView(packet.buffer);
  view.setUint16(0, opts.seq ?? 0, true);
  view.setUint16(2, opts.frame ?? 0, true);
  view.setUint16(4, (opts.line & 0x7fff) | (opts.lastLine ? 0x8000 : 0), true);
  view.setUint16(6, opts.width ?? 384, true);
  packet[8] = opts.linesPerPacket ?? 4;
  packet[9] = opts.bpp ?? 4;
  view.setUint16(10, 0, true);
  packet.set(opts.payload, VIC_HEADER_BYTES);
  return packet;
};

describe("vicStream", () => {
  it("parses a header including the last-line flag", () => {
    const packet = buildVicPacket({ seq: 5, line: 10, lastLine: true, payload: new Uint8Array(VIC_BYTES_PER_LINE) });
    const header = parseVicHeader(packet);
    expect(header).toMatchObject({ seq: 5, line: 10, lastLine: true, width: 384, linesPerPacket: 4, bpp: 4 });
  });

  it("returns null for a short datagram", () => {
    expect(parseVicHeader(new Uint8Array(4))).toBeNull();
  });

  it("assembles a frame and emits it on the last-line flag", () => {
    const assembler = new VicStreamAssembler();
    const line0 = new Uint8Array(VIC_BYTES_PER_LINE).fill(0x11);
    const line1 = new Uint8Array(VIC_BYTES_PER_LINE).fill(0x22);
    expect(assembler.ingest(buildVicPacket({ seq: 0, line: 0, payload: line0 }))).toBeNull();
    const frame = assembler.ingest(buildVicPacket({ seq: 1, line: 1, lastLine: true, payload: line1 }));
    expect(frame).not.toBeNull();
    expect(frame!.length).toBe(VIC_BYTES_PER_FRAME);
    expect(frame![0]).toBe(0x11);
    expect(frame![VIC_BYTES_PER_LINE]).toBe(0x22);
    expect(assembler.stats.frames).toBe(1);
  });

  it("ignores malformed packets (wrong width / zero lines) but still completes on last-line", () => {
    const assembler = new VicStreamAssembler();
    expect(
      assembler.ingest(buildVicPacket({ line: 0, width: 320, payload: new Uint8Array(VIC_BYTES_PER_LINE) })),
    ).toBeNull();
    expect(
      assembler.ingest(buildVicPacket({ line: 0, linesPerPacket: 0, payload: new Uint8Array(VIC_BYTES_PER_LINE) })),
    ).toBeNull();
    const frame = assembler.ingest(
      buildVicPacket({ line: 0, width: 320, lastLine: true, payload: new Uint8Array(VIC_BYTES_PER_LINE) }),
    );
    expect(frame).not.toBeNull();
    expect(assembler.stats.ignored).toBe(3);
  });

  it("ignores packets whose bits-per-pixel is not 4 (c64stream validation)", () => {
    const assembler = new VicStreamAssembler();
    expect(
      assembler.ingest(buildVicPacket({ line: 0, bpp: 8, payload: new Uint8Array(VIC_BYTES_PER_LINE) })),
    ).toBeNull();
    expect(assembler.stats.ignored).toBe(1);
  });

  it("reports the detected PAL vs NTSC frame height from the last packet", () => {
    const pal = new VicStreamAssembler();
    // last packet at line 268 -> 268 + 4 = 272 (PAL)
    pal.ingest(buildVicPacket({ line: 268, lastLine: true, payload: new Uint8Array(VIC_BYTES_PER_LINE) }));
    expect(pal.frameHeight).toBe(272);

    const ntsc = new VicStreamAssembler();
    // last packet at line 236 -> 236 + 4 = 240 (NTSC)
    ntsc.ingest(buildVicPacket({ line: 236, lastLine: true, payload: new Uint8Array(VIC_BYTES_PER_LINE) }));
    expect(ntsc.frameHeight).toBe(240);
    ntsc.reset();
    expect(ntsc.frameHeight).toBe(272);
  });

  it("counts dropped packets from seq gaps and resets", () => {
    const assembler = new VicStreamAssembler();
    assembler.ingest(buildVicPacket({ seq: 0, line: 0, payload: new Uint8Array(VIC_BYTES_PER_LINE) }));
    assembler.ingest(buildVicPacket({ seq: 3, line: 1, payload: new Uint8Array(VIC_BYTES_PER_LINE) }));
    expect(assembler.stats.droppedPackets).toBe(2);
    assembler.reset();
    expect(assembler.stats.droppedPackets).toBe(0);
  });

  it("clamps an out-of-range line write without throwing", () => {
    const assembler = new VicStreamAssembler();
    const frame = assembler.ingest(
      buildVicPacket({ line: 5000, lastLine: true, payload: new Uint8Array(VIC_BYTES_PER_LINE).fill(0xff) }),
    );
    expect(frame).not.toBeNull();
  });
});

const buildAudioPacket = (seq: number, samples: number[]) => {
  const packet = new Uint8Array(2 + samples.length * 2);
  packet[0] = seq & 0xff;
  packet[1] = (seq >> 8) & 0xff;
  const view = new DataView(packet.buffer);
  samples.forEach((s, i) => view.setInt16(2 + i * 2, s, true));
  return packet;
};

describe("audioStream", () => {
  it("parses a packet, stripping seq and trimming to whole stereo frames", () => {
    const packet = buildAudioPacket(7, [100, -100, 200, -200]);
    const parsed = parseAudioPacket(packet);
    expect(parsed?.seq).toBe(7);
    expect(parsed?.body.length).toBe(8);
  });

  it("returns null for a too-short packet", () => {
    expect(parseAudioPacket(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it("bytesToInt16LE and deinterleaveStereo round-trip", () => {
    const packet = buildAudioPacket(0, [16384, -16384, 32767, -32768]);
    const parsed = parseAudioPacket(packet)!;
    const int16 = bytesToInt16LE(parsed.body);
    expect(Array.from(int16)).toEqual([16384, -16384, 32767, -32768]);
    const { left, right, frames } = deinterleaveStereo(int16);
    expect(frames).toBe(2);
    expect(left[0]).toBeCloseTo(0.5, 3);
    expect(right[0]).toBeCloseTo(-0.5, 3);
    expect(left[1]).toBeCloseTo(32767 / 32768, 4);
    expect(right[1]).toBeCloseTo(-1, 4);
  });

  it("batches packets and flushes every N", () => {
    const batcher = new AudioBatcher(3);
    expect(batcher.push(buildAudioPacket(0, [1, 2]))).toBeNull();
    expect(batcher.push(buildAudioPacket(1, [3, 4]))).toBeNull();
    const batch = batcher.push(buildAudioPacket(2, [5, 6]));
    expect(batch).not.toBeNull();
    expect(Array.from(batch!)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(batcher.stats.batches).toBe(1);
  });

  it("tracks dropped packets and can flush a partial batch", () => {
    const batcher = new AudioBatcher(8);
    batcher.push(buildAudioPacket(0, [1, 2]));
    batcher.push(buildAudioPacket(4, [3, 4]));
    expect(batcher.stats.droppedPackets).toBe(3);
    const partial = batcher.flush();
    expect(Array.from(partial!)).toEqual([1, 2, 3, 4]);
    expect(batcher.flush()).toBeNull();
  });

  it("ignores unparseable packets and resets stats", () => {
    const batcher = new AudioBatcher(4);
    expect(batcher.push(new Uint8Array([1]))).toBeNull();
    expect(batcher.stats.ignored).toBe(1);
    batcher.reset();
    expect(batcher.stats.ignored).toBe(0);
  });
});

describe("audioPlayer", () => {
  it("nextStartTime never goes backwards or overlaps", () => {
    expect(nextStartTime(0, 0, 0.08)).toBeCloseTo(0.08, 5);
    expect(nextStartTime(1, 5, 0.08)).toBe(5); // previous end wins
    expect(nextStartTime(10, 5, 0.08)).toBeCloseTo(10.08, 5); // lead-in wins
  });

  it("schedules chunks back-to-back through an injected context", async () => {
    const started: number[] = [];
    let now = 0;
    const buffers: Array<{ ch: Float32Array[] }> = [];
    const fakeCtx = {
      get currentTime() {
        return now;
      },
      destination: {} as AudioNode,
      createBuffer: (_c: number, length: number) => {
        const ch = [new Float32Array(length), new Float32Array(length)];
        const buf = { getChannelData: (i: number) => ch[i] } as unknown as AudioBuffer;
        buffers.push({ ch });
        return buf;
      },
      createBufferSource: () =>
        ({
          buffer: null,
          connect: () => {},
          start: (t: number) => started.push(t),
        }) as unknown as AudioBufferSourceNode,
      resume: async () => {},
    };
    const player = new AudioMirrorPlayer(() => fakeCtx, 0.08, 48000);
    expect(await player.start()).toBe(true);

    // 48000 frames = 1 second of stereo -> interleaved length 96000
    const chunk = new Int16Array(96000);
    player.playChunk(chunk);
    now = 0.5;
    player.playChunk(chunk);

    expect(player.scheduledChunks).toBe(2);
    expect(started[0]).toBeCloseTo(0.08, 5);
    // second chunk starts at previous end (0.08 + 1.0), not now+leadIn
    expect(started[1]).toBeCloseTo(1.08, 5);
  });

  it("start returns false when WebAudio is unavailable, and playChunk no-ops before start", () => {
    const player = new AudioMirrorPlayer(() => {
      throw new Error("no audio");
    });
    player.playChunk(new Int16Array(4)); // no throw
    return expect(player.start()).resolves.toBe(false);
  });
});
