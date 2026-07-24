/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { VideoMirrorController, type VideoMirrorSnapshot } from "@/lib/streams/videoMirrorController";
import type { StreamReceiver, StreamConnectionState } from "@/lib/streams/streamReceiver";
import { VIC_HEADER_BYTES, VIC_BYTES_PER_LINE, VIC_LAST_LINE_FLAG } from "@/lib/streams/vicStream";
import { VIC_FRAME_WIDTH, VIC_PAL_HEIGHT } from "@/lib/streams/vicDecode";
import { buildTestPatternStream } from "@/lib/streams/vicTestPattern";

class FakeReceiver implements StreamReceiver {
  datagram: ((data: Uint8Array, arrivalMs: number) => void) | null = null;
  stateCb: ((s: StreamConnectionState) => void) | null = null;
  readonly destination = "10.0.0.5:11000";
  closed = false;
  private clock = 0;
  onDatagram(handler: (data: Uint8Array, arrivalMs: number) => void) {
    this.datagram = handler;
  }
  onStateChange(handler: (s: StreamConnectionState) => void) {
    this.stateCb = handler;
  }
  close() {
    this.closed = true;
  }
  emitState(s: StreamConnectionState) {
    this.stateCb?.(s);
  }
  emit(bytes: Uint8Array, arrivalMs: number = (this.clock += 1)) {
    this.datagram?.(bytes, arrivalMs);
  }
}

/**
 * Build a valid single-line VIC packet: 12-byte LE header + 192-byte payload.
 * `line` is masked to 15 bits; `lastLine` sets 0x8000 so the assembler completes
 * the frame on ingest.
 */
const videoPacket = (opts: { seq: number; frame?: number; line?: number; lastLine?: boolean }) => {
  const { seq, frame = 0, line = 0, lastLine = false } = opts;
  const packet = new Uint8Array(VIC_HEADER_BYTES + VIC_BYTES_PER_LINE);
  const view = new DataView(packet.buffer);
  view.setUint16(0, seq & 0xffff, true); // seq
  view.setUint16(2, frame & 0xffff, true); // frame
  view.setUint16(4, (line & 0x7fff) | (lastLine ? VIC_LAST_LINE_FLAG : 0), true); // lineRaw
  view.setUint16(6, VIC_FRAME_WIDTH, true); // width = 384
  packet[8] = 4; // linesPerPacket
  packet[9] = 4; // bpp
  view.setUint16(10, 0, true); // enc
  // payload left as zeroes (a valid all-black line)
  return packet;
};

/** Emit a full one-packet frame (line 0, last-line flag set). */
const completeFrame = (receiver: FakeReceiver, seq: number, frame = 0) => {
  receiver.emit(videoPacket({ seq, frame, line: 0, lastLine: true }));
};

describe("VideoMirrorController", () => {
  it("connects, goes live, renders a completed frame and reports destination to the device", async () => {
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const startStream = vi.fn(async () => ({ errors: [] }));
    const snapshots: VideoMirrorSnapshot[] = [];
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      startStream,
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: (s) => snapshots.push(s),
    });

    await controller.start();
    expect(startStream).toHaveBeenCalledWith("video", "10.0.0.5:11000");
    receiver.emitState("open");
    expect(controller.getSnapshot().state).toBe("live");

    completeFrame(receiver, 0);
    expect(renderFrame).toHaveBeenCalledTimes(1);
    // The frame handed to the sink is a full 52224-byte VIC frame.
    expect(renderFrame.mock.calls[0][0].length).toBe((VIC_FRAME_WIDTH * 272) / 2);
    expect(controller.getSnapshot().state).toBe("live");
  });

  it("stamps a frame with the EARLIEST arrival of its packets, despite reordering", async () => {
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");

    // Frame 5 arrives reordered: a later line first, then line 0 EARLIER, then the last-line packet.
    receiver.emit(videoPacket({ seq: 1, frame: 5, line: 8 }), 100);
    receiver.emit(videoPacket({ seq: 2, frame: 5, line: 0 }), 90);
    receiver.emit(videoPacket({ seq: 3, frame: 5, line: 268, lastLine: true }), 110);

    expect(renderFrame).toHaveBeenCalledTimes(1);
    // The frame's wire timestamp is the earliest arrival (90), not first-seen (100) or last (110).
    expect(renderFrame.mock.calls[0][2]).toBe(90);
  });

  it("does not skew a frame's timestamp when the previous frame's last-line packet is lost", async () => {
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");

    // Frame 0 never completes (its last-line packet is lost) — only a mid packet arrives at t=0.
    receiver.emit(videoPacket({ seq: 1, frame: 0, line: 0 }), 0);
    // Frame 1 completes; its stamp must be frame 1's own arrival (20), NOT frame 0's leftover start.
    receiver.emit(videoPacket({ seq: 2, frame: 1, line: 0, lastLine: true }), 20);

    expect(renderFrame).toHaveBeenCalledTimes(1);
    expect(renderFrame.mock.calls[0][2]).toBe(20);
  });

  it("counts frames rendered in the last ~1s as fps", async () => {
    const receiver = new FakeReceiver();
    let clock = 1_000_000;
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
      now: () => clock,
    });

    await controller.start();
    receiver.emitState("open");

    // Three frames within the same 1s window -> fps 3.
    completeFrame(receiver, 0);
    clock += 100;
    completeFrame(receiver, 1);
    clock += 100;
    completeFrame(receiver, 2);
    expect(controller.getSnapshot().fps).toBe(3);

    // Advance past the window; the older frames age out.
    clock += 2000;
    completeFrame(receiver, 3);
    expect(controller.getSnapshot().fps).toBe(1);
  });

  it("frame-throttle renders only every Nth assembled frame", async () => {
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      frameThrottle: 2,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });

    await controller.start();
    receiver.emitState("open");

    for (let i = 0; i < 4; i += 1) completeFrame(receiver, i, i);
    // 4 assembled frames, every 2nd rendered -> 2 renders.
    expect(renderFrame).toHaveBeenCalledTimes(2);
  });

  it("keeps updating dropped-packet health even for throttled (skipped) frames", async () => {
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      frameThrottle: 4,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");

    // seq jumps from 0 to 5 -> assembler records dropped packets.
    completeFrame(receiver, 0, 0);
    completeFrame(receiver, 5, 1);
    expect(controller.getSnapshot().droppedPackets).toBeGreaterThan(0);
  });

  it("stops the device stream, closes the receiver and resets on stop", async () => {
    const receiver = new FakeReceiver();
    const stopStream = vi.fn(async () => ({ errors: [] }));
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream,
      onChange: vi.fn(),
    });
    await controller.start();
    await controller.stop();
    expect(stopStream).toHaveBeenCalledWith("video");
    expect(receiver.closed).toBe(true);
    expect(controller.getSnapshot().state).toBe("off");
    expect(controller.getSnapshot().fps).toBe(0);
  });

  it("enters error state when the device refuses to start streaming", async () => {
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => {
        throw new Error("stream busy");
      }),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    expect(controller.getSnapshot().state).toBe("error");
    expect(controller.getSnapshot().error).toMatch(/start streaming video/i);
  });

  it("reflects a receiver error while live", async () => {
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    receiver.emitState("error");
    expect(controller.getSnapshot().state).toBe("error");
  });

  it("goes back to off when the receiver closes while running", async () => {
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    receiver.emitState("closed");
    expect(controller.getSnapshot().state).toBe("off");
  });

  it("is idempotent: start() while connecting/live does not create a second receiver", async () => {
    let created = 0;
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => {
        created += 1;
        return receiver;
      },
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    await controller.start();
    expect(created).toBe(1);
  });

  it("swallows a stopStream rejection during stop", async () => {
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => {
        throw new Error("device gone");
      }),
      onChange: vi.fn(),
    });
    await controller.start();
    await expect(controller.stop()).resolves.toBeUndefined();
    expect(controller.getSnapshot().state).toBe("off");
  });

  it("renders via the native onFrame fast path when the receiver assembles frames", async () => {
    // A receiver that delivers whole frames (the native Android plugin's assemble mode): the
    // controller must render them directly, passing through height, frame-start time and drops —
    // without any JS-side assembly.
    type FrameHandler = (f: Uint8Array, h: number, t: number, dropped: number, lost: number, present: boolean) => void;
    class FrameReceiver implements StreamReceiver {
      frame: FrameHandler | null = null;
      datagram: ((d: Uint8Array, t: number) => void) | null = null;
      stateCb: ((s: StreamConnectionState) => void) | null = null;
      readonly destination = "10.0.0.9:11000";
      closed = false;
      nativeFraction: number | null = null;
      onDatagram(handler: (d: Uint8Array, t: number) => void) {
        this.datagram = handler;
      }
      onFrame(handler: FrameHandler) {
        this.frame = handler;
      }
      setNativeCadence(fraction: number) {
        this.nativeFraction = fraction;
      }
      onStateChange(handler: (s: StreamConnectionState) => void) {
        this.stateCb = handler;
      }
      close() {
        this.closed = true;
      }
    }

    const receiver = new FrameReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.stateCb?.("open");

    const frame = new Uint8Array((VIC_FRAME_WIDTH * 272) / 2);
    receiver.frame?.(frame, 240, 7777, 5, 2, true);

    expect(renderFrame).toHaveBeenCalledTimes(1);
    expect(renderFrame.mock.calls[0][1]).toBe(240); // height passed through
    expect(renderFrame.mock.calls[0][2]).toBe(7777); // frame-start wire time passed through
    expect(controller.getSnapshot().droppedPackets).toBe(5);
    expect(controller.getSnapshot().framesLost).toBe(2); // native frame-loss count passed through
    expect(controller.getSnapshot().standard).toBe("NTSC"); // height 240 classifies NTSC
    // The per-packet path is not used in assemble mode.
    expect(receiver.datagram).not.toBeNull(); // controller registered it, but it never fires here
  });

  it("surfaces zero frame loss for a clean synthetic stream and the exact count when frames are dropped", async () => {
    // Clean stream: every frame arrives → framesLost stays 0, fps counts every frame.
    const clean = buildTestPatternStream(120, { height: VIC_PAL_HEIGHT });
    const cleanReceiver = new FakeReceiver();
    const cleanController = new VideoMirrorController({
      createReceiver: () => cleanReceiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await cleanController.start();
    cleanReceiver.emitState("open");
    for (const packet of clean.packets) cleanReceiver.emit(packet);
    expect(cleanController.getSnapshot().framesLost).toBe(0);

    // Damaged stream: drop two frames' last-line packets → controller reports exactly 2 lost.
    const damaged = buildTestPatternStream(120, { height: VIC_PAL_HEIGHT });
    const perFrame = damaged.packets.length / 120;
    const drop = new Set([40 * perFrame + (perFrame - 1), 80 * perFrame + (perFrame - 1)]);
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    damaged.packets.forEach((packet, idx) => {
      if (!drop.has(idx)) receiver.emit(packet);
    });
    expect(controller.getSnapshot().framesLost).toBe(2);
  });

  it("coalesces per-frame health broadcasts to ~10Hz, but emits state changes immediately", async () => {
    let clock = 0;
    const receiver = new FakeReceiver();
    const onChange = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      now: () => clock,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange,
    });
    await controller.start();
    receiver.emitState("open");
    onChange.mockClear();

    // Five frames within the same 100 ms window → only one broadcast (health is coalesced) …
    clock = 1000;
    for (let i = 0; i < 5; i += 1) completeFrame(receiver, i, i);
    expect(onChange).toHaveBeenCalledTimes(1);
    // … but getSnapshot() stays fully current every frame.
    expect(controller.getSnapshot().presented).toBe(5);

    // Past the interval → the next frame broadcasts.
    clock = 1120;
    completeFrame(receiver, 5, 5);
    expect(onChange).toHaveBeenCalledTimes(2);

    // A state change bypasses the throttle entirely.
    onChange.mockClear();
    await controller.stop();
    expect(onChange).toHaveBeenCalled();
    expect(controller.getSnapshot().state).toBe("off");
  });

  it("ignores datagrams that do not complete a frame", async () => {
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    // A non-last-line packet: assembler returns null, no render.
    receiver.emit(videoPacket({ seq: 0, line: 0, lastLine: false }));
    expect(renderFrame).not.toHaveBeenCalled();
  });
});

describe("VideoMirrorController — coalescing present queue (drop-late / present-newest, §7.6)", () => {
  /** A manual present pump: the controller enqueues; the test decides when a present tick runs. */
  const manualPump = () => {
    const queued: Array<() => void> = [];
    return {
      schedule: (present: () => void) => queued.push(present),
      /** Run every scheduled present tick (there is at most one pending at a time). */
      flush: () => {
        while (queued.length) queued.shift()!();
      },
      pending: () => queued.length,
    };
  };

  it("presents only the NEWEST frame of a burst, counting the superseded ones as backlog replacements", async () => {
    const pump = manualPump();
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      schedulePresent: pump.schedule,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");

    // Three frames complete before the present tick runs (a renderer backlog).
    completeFrame(receiver, 0, 0);
    completeFrame(receiver, 1, 1);
    completeFrame(receiver, 2, 2);
    expect(renderFrame).not.toHaveBeenCalled(); // nothing presented until the pump runs
    expect(pump.pending()).toBe(1); // exactly one present tick scheduled for the whole burst

    pump.flush();
    expect(renderFrame).toHaveBeenCalledTimes(1); // only the newest survives
    const snap = controller.getSnapshot();
    expect(snap.presented).toBe(1);
    expect(snap.backlogReplacements).toBe(2); // the two older frames were superseded, never rendered
    // Frames superseded before presentation are NOT lost on the wire and NOT decimation.
    expect(snap.framesLost).toBe(0);
    expect(snap.decimated).toBe(0);
  });

  it("does not fabricate backlog replacements when each frame is presented before the next completes", async () => {
    const pump = manualPump();
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      schedulePresent: pump.schedule,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");

    for (let i = 0; i < 3; i += 1) {
      completeFrame(receiver, i, i);
      pump.flush(); // present each before the next arrives (no backlog)
    }
    expect(renderFrame).toHaveBeenCalledTimes(3);
    expect(controller.getSnapshot().presented).toBe(3);
    expect(controller.getSnapshot().backlogReplacements).toBe(0);
  });

  it("reports the cadence divisor as decimation, distinct from backlog replacement and wire loss", async () => {
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      frameThrottle: 2, // present every 2nd source frame
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");

    for (let i = 0; i < 4; i += 1) completeFrame(receiver, i, i);
    const snap = controller.getSnapshot();
    expect(snap.presented).toBe(2); // 2nd and 4th
    expect(snap.decimated).toBe(2); // 1st and 3rd — intentional, NOT a defect
    expect(snap.backlogReplacements).toBe(0);
    expect(snap.framesLost).toBe(0);
  });

  it("setFrameThrottle changes the live cadence divisor (governor hook)", async () => {
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    expect(controller.frameThrottle).toBe(1);
    completeFrame(receiver, 0, 0); // presented
    controller.setFrameThrottle(4);
    expect(controller.frameThrottle).toBe(4);
    // frameTick continues from 1; next 3 frames (ticks 2,3,4) → only tick 4 presents.
    for (let i = 1; i <= 4; i += 1) completeFrame(receiver, i, i);
    expect(renderFrame).toHaveBeenCalledTimes(2);
  });

  it("tracks present-queue residence on the injected clock (feeds the governor / §6 telemetry)", async () => {
    const pump = manualPump();
    let clock = 0;
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      schedulePresent: pump.schedule,
      now: () => clock,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");

    completeFrame(receiver, 0, 0); // readyMs = 0
    clock = 40; // 40 ms elapse before the present tick runs
    pump.flush();
    expect(controller.getSnapshot().renderResidenceMs).toBe(40);
    expect(controller.getSnapshot().maxResidenceMs).toBe(40);
  });
});

describe("VideoMirrorController — presentation-slot accounting / concealment (§9)", () => {
  /** Build a two-packet frame (line 0 + last-line) whose seq numbers the caller controls. */
  const frameOf = (receiver: FakeReceiver, seq0: number, frameNum: number) => {
    receiver.emit(videoPacket({ seq: seq0, frame: frameNum, line: 0, lastLine: false }));
    receiver.emit(videoPacket({ seq: seq0 + 1, frame: frameNum, line: 268, lastLine: true }));
  };

  it("classifies clean frames as complete, with no repeats or partials and no unexplained gaps", async () => {
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    let seq = 0;
    for (let f = 0; f < 10; f += 1) {
      frameOf(receiver, seq, f);
      seq += 2;
    }
    const s = controller.getSnapshot();
    expect(s.completeFrames).toBe(10);
    expect(s.partialConcealed).toBe(0);
    expect(s.repeatedFrames).toBe(0);
    // Every completed source frame was presented (no decimation, no backlog) — no unexplained gaps.
    expect(s.presented + s.decimated + s.backlogReplacements).toBe(s.completeFrames + s.partialConcealed);
  });

  it("counts a whole-frame loss as a repeated slot (previous frame held on the canvas)", async () => {
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    // Frames 0,1, then SKIP frame 2 (its last-line lost), then 3 → frame-number gap 1→3 = 1 lost slot.
    frameOf(receiver, 0, 0);
    frameOf(receiver, 2, 1);
    frameOf(receiver, 6, 3); // seq jumps too (frame 2's packets never arrived)
    const s = controller.getSnapshot();
    expect(s.repeatedFrames).toBe(1); // the missing frame 2 slot = one repeat of the previous frame
    expect(s.framesLost).toBe(1);
    // Slot invariant still holds: completed frames are all classified + presented.
    expect(s.presented + s.decimated + s.backlogReplacements).toBe(s.completeFrames + s.partialConcealed);
  });

  it("classifies a frame with missing line packets as partially concealed", async () => {
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    frameOf(receiver, 0, 0); // complete
    // Frame 1: a mid-line packet is missing (seq gap within the frame) → dropped++ → partial-concealed.
    receiver.emit(videoPacket({ seq: 2, frame: 1, line: 0, lastLine: false }));
    receiver.emit(videoPacket({ seq: 5, frame: 1, line: 268, lastLine: true })); // seq 3,4 dropped
    const s = controller.getSnapshot();
    expect(s.droppedPackets).toBeGreaterThan(0);
    expect(s.partialConcealed).toBe(1);
    expect(s.completeFrames).toBe(1); // only frame 0 was clean
  });
});

describe("VideoMirrorController — continuous fractional cadence (§11 governor)", () => {
  /** Present `frames` source frames at `keepFraction` and return how many were rendered. */
  const presentedAt = async (keepFraction: number, frames: number): Promise<number> => {
    const receiver = new FakeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.emitState("open");
    controller.setKeepFraction(keepFraction);
    for (let i = 0; i < frames; i += 1) completeFrame(receiver, i, i);
    return renderFrame.mock.calls.length;
  };

  it("presents the exact target percentage of source frames over a long run", async () => {
    expect(await presentedAt(1, 100)).toBe(100); // 100%
    expect(await presentedAt(0.5, 100)).toBe(50); // 50%
    expect(await presentedAt(0.25, 100)).toBe(25); // 25%
    expect(await presentedAt(0.75, 100)).toBe(75); // 75% — impossible with integer divisors
    expect(await presentedAt(0.6, 100)).toBe(60); // 60%
    expect(await presentedAt(0.73, 100)).toBe(73); // arbitrary 73%
  });

  it("is float-safe: 0.1 lands exactly one frame in ten (no epsilon drift)", async () => {
    expect(await presentedAt(0.1, 100)).toBe(10);
  });

  it("clamps out-of-range fractions into (0,1]", async () => {
    expect(await presentedAt(2, 50)).toBe(50); // >1 → 1 (present all)
    expect(await presentedAt(0, 50)).toBe(0); // 0 → 0.01 floor (~1%); 50×0.01 < 1 → none in 50 frames
    expect(await presentedAt(0, 100)).toBe(1); // …but the 1% floor lands exactly one in 100 (never fully stalls)
  });

  it("routes cadence to the native transport when supported; JS then presents every received frame", async () => {
    // A transport that decimates natively (the Android plugin): setKeepFraction is pushed to it, and
    // the controller stops decimating in JS (keepFraction 1). Skipped frames arrive as present=false
    // with an empty payload (their base64 was elided) and are counted, not rendered.
    type FrameHandler = (f: Uint8Array, h: number, t: number, d: number, l: number, present: boolean) => void;
    class NativeReceiver implements StreamReceiver {
      frame: FrameHandler | null = null;
      stateCb: ((s: StreamConnectionState) => void) | null = null;
      readonly destination = "10.0.0.9:11000";
      nativeFraction = 1;
      onDatagram() {}
      onFrame(handler: FrameHandler) {
        this.frame = handler;
      }
      setNativeCadence(fraction: number) {
        this.nativeFraction = fraction;
      }
      onStateChange(handler: (s: StreamConnectionState) => void) {
        this.stateCb = handler;
      }
      close() {}
    }

    const receiver = new NativeReceiver();
    const renderFrame = vi.fn();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    receiver.stateCb?.("open");

    controller.setKeepFraction(0.5);
    expect(receiver.nativeFraction).toBe(0.5); // pushed to the native transport
    expect(controller.keepFractionValue).toBe(1); // JS presents everything it receives

    const full = new Uint8Array((VIC_FRAME_WIDTH * 272) / 2);
    const empty = new Uint8Array(0);
    receiver.frame?.(empty, 272, 0, 0, 0, false); // native-decimated
    receiver.frame?.(full, 272, 0, 0, 0, true);
    receiver.frame?.(empty, 272, 0, 0, 0, false);
    receiver.frame?.(full, 272, 0, 0, 0, true);

    expect(renderFrame).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().presented).toBe(2);
    expect(controller.getSnapshot().decimated).toBe(2); // the two native-skipped frames still counted
  });

  it("setKeepFraction and setFrameThrottle are interchangeable views of the same cadence", async () => {
    // frameThrottle N ⇔ keepFraction 1/N, and the divisor getter round-trips.
    const receiver = new FakeReceiver();
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });
    await controller.start();
    controller.setKeepFraction(0.25);
    expect(controller.frameThrottle).toBe(4);
    controller.setFrameThrottle(2);
    expect(controller.keepFractionValue).toBe(0.5);
  });
});
