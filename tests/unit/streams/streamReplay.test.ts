/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { VideoMirrorController } from "@/lib/streams/videoMirrorController";
import type { StreamConnectionState, StreamReceiver } from "@/lib/streams/streamReceiver";
import { VIC_HEADER_BYTES, VIC_BYTES_PER_LINE, VIC_LAST_LINE_FLAG } from "@/lib/streams/vicStream";
import { VIC_FRAME_WIDTH } from "@/lib/streams/vicDecode";

/**
 * Recorded-stream replay (spec §14.2). Deterministic generated traces for each impairment profile,
 * each replayed through the real video pipeline with a COMMITTED expected result (slot outcomes +
 * counters). Runs on every build. Traces are reproducible from their construction (the "version").
 */

const LINES = [0, 4, 8]; // 3 packets/frame; the last (line 8) carries the last-line flag
const FRAMES = 30;

interface Packet {
  seq: number;
  frame: number;
  line: number;
  lastLine: boolean;
  malformed?: boolean;
}

/** A clean base trace: FRAMES frames × 3 line-packets, globally-increasing seq. */
const cleanTrace = (): Packet[] => {
  const out: Packet[] = [];
  let seq = 0;
  for (let f = 0; f < FRAMES; f++) {
    LINES.forEach((line, i) => {
      out.push({ seq: seq++, frame: f, line, lastLine: i === LINES.length - 1 });
    });
  }
  return out;
};

const toBytes = (p: Packet): Uint8Array => {
  const bytes = new Uint8Array(VIC_HEADER_BYTES + VIC_BYTES_PER_LINE);
  const v = new DataView(bytes.buffer);
  v.setUint16(0, p.seq & 0xffff, true);
  v.setUint16(2, p.frame & 0xffff, true);
  v.setUint16(4, (p.line & 0x7fff) | (p.lastLine ? VIC_LAST_LINE_FLAG : 0), true);
  // A malformed packet declares the wrong width so the assembler rejects it (§2 case 4).
  v.setUint16(6, p.malformed ? 999 : VIC_FRAME_WIDTH, true);
  bytes[8] = 4;
  bytes[9] = 4;
  return bytes;
};

class FakeReceiver implements StreamReceiver {
  datagram: ((d: Uint8Array, t: number) => void) | null = null;
  stateCb: ((s: StreamConnectionState) => void) | null = null;
  readonly destination = "10.0.0.5:11000";
  onDatagram(h: (d: Uint8Array, t: number) => void) {
    this.datagram = h;
  }
  onStateChange(h: (s: StreamConnectionState) => void) {
    this.stateCb = h;
  }
  close() {}
}

interface ReplayResult {
  presented: number;
  completeFrames: number;
  partialConcealed: number;
  repeatedFrames: number;
  framesLost: number;
  droppedPackets: number;
  decimated: number;
}

const replay = async (trace: Packet[]): Promise<ReplayResult> => {
  const receiver = new FakeReceiver();
  const controller = new VideoMirrorController({
    createReceiver: () => receiver,
    renderFrame: vi.fn(),
    startStream: vi.fn(async () => ({ errors: [] })),
    stopStream: vi.fn(async () => ({ errors: [] })),
    onChange: vi.fn(),
  });
  await controller.start();
  receiver.stateCb?.("open");
  let t = 0;
  for (const p of trace) receiver.datagram?.(toBytes(p), (t += 1));
  const s = controller.getSnapshot();
  return {
    presented: s.presented,
    completeFrames: s.completeFrames,
    partialConcealed: s.partialConcealed,
    repeatedFrames: s.repeatedFrames,
    framesLost: s.framesLost,
    droppedPackets: s.droppedPackets,
    decimated: s.decimated,
  };
};

/** Deterministic impairment profiles applied to the clean base trace. */
const profiles: Record<string, () => Packet[]> = {
  clean: () => cleanTrace(),
  // Drop the last-line packet of frame 15 → that whole frame never completes (§2 case 1).
  isolatedFrameLoss: () => cleanTrace().filter((p) => !(p.frame === 15 && p.lastLine)),
  // Drop every packet of frames 10,11,12 → a 3-frame burst loss.
  burstFrameLoss: () => cleanTrace().filter((p) => p.frame < 10 || p.frame > 12),
  // Drop a MID packet (line 4) of frame 15 → the frame still completes but with a seq gap → partial.
  partialFrame: () => cleanTrace().filter((p) => !(p.frame === 15 && p.line === 4)),
  // Reorder: swap the first two packets of frame 15 — the assembler is reorder-tolerant → complete.
  reorder: () => {
    const t = cleanTrace();
    const i = t.findIndex((p) => p.frame === 15 && p.line === 0);
    [t[i], t[i + 1]] = [t[i + 1], t[i]];
    return t;
  },
  // Duplicate a MID packet of frame 15 (same seq) → the assembler re-writes the same lines and the
  // frame still completes exactly once (§2 case 6). (A duplicated LAST-LINE packet legitimately
  // completes the frame twice — a harmless temporal repeat — so this profile targets a mid packet.)
  duplicate: () => {
    const t = cleanTrace();
    const i = t.findIndex((p) => p.frame === 15 && p.line === 4);
    t.splice(i + 1, 0, { ...t[i] });
    return t;
  },
  // A malformed packet injected mid-stream → ignored, the stream is otherwise intact.
  malformed: () => {
    const t = cleanTrace();
    const i = t.findIndex((p) => p.frame === 15 && p.line === 0);
    t.splice(i, 0, { seq: t[i].seq, frame: 15, line: 0, lastLine: false, malformed: true });
    return t;
  },
};

/**
 * Committed expected results per profile (§14.2). Note the pipeline's real behaviour: the frame
 * that arrives just AFTER a loss is classified `partial`, because the lost packet(s) register as a
 * sequence gap on that frame. And an intra-frame reorder still assembles correctly (lines are
 * written by offset) but the out-of-order seq marks that frame partial too.
 */
const expected: Record<string, Partial<ReplayResult>> = {
  clean: { completeFrames: 30, partialConcealed: 0, repeatedFrames: 0, framesLost: 0, presented: 30 },
  isolatedFrameLoss: { completeFrames: 28, partialConcealed: 1, repeatedFrames: 1, framesLost: 1, presented: 29 },
  burstFrameLoss: { completeFrames: 26, partialConcealed: 1, repeatedFrames: 3, framesLost: 3, presented: 27 },
  partialFrame: { completeFrames: 29, partialConcealed: 1, repeatedFrames: 0, framesLost: 0, presented: 30 },
  reorder: { completeFrames: 29, partialConcealed: 1, repeatedFrames: 0, framesLost: 0, presented: 30 },
  duplicate: { completeFrames: 30, partialConcealed: 0, repeatedFrames: 0, framesLost: 0, presented: 30 },
  malformed: { completeFrames: 30, partialConcealed: 0, repeatedFrames: 0, framesLost: 0, presented: 30 },
};

describe("stream replay — impairment profiles → committed slot outcomes (§14.2)", () => {
  for (const [name, build] of Object.entries(profiles)) {
    it(`${name}: replays to the committed expected result`, async () => {
      const result = await replay(build());
      expect(result).toMatchObject(expected[name]);
      // Slot invariant holds for every profile: every source slot has one outcome, no unexplained gaps.
      expect(result.presented + result.decimated).toBe(result.completeFrames + result.partialConcealed);
    });
  }

  it("partialFrame records the dropped packet (region concealed from the previous frame)", async () => {
    const result = await replay(profiles.partialFrame());
    expect(result.droppedPackets).toBeGreaterThan(0);
    expect(result.partialConcealed).toBe(1);
  });
});
