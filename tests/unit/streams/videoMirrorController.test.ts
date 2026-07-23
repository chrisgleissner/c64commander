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
import { VIC_FRAME_WIDTH } from "@/lib/streams/vicDecode";

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
