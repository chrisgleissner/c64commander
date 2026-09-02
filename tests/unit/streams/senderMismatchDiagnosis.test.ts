/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { VideoMirrorController } from "@/lib/streams/videoMirrorController";
import { AudioMirrorController } from "@/lib/streams/audioMirrorController";
import type { StreamConnectionState, StreamReceiver } from "@/lib/streams/streamReceiver";
import type { SenderFilterDiagnostics } from "@/lib/streams/senderMismatch";
import type { AudioMirrorPlayer } from "@/lib/streams/audioPlayer";

/**
 * A dual-homed Ultimate: the app talks REST to one of its addresses and the firmware streams from
 * the other, so the native filter refuses every packet that arrives. The socket is busy, no packet
 * is ever counted as an arrival, and the watchdog reports the stream as stopped — the one message
 * that sends the user to check the C64 and the cable.
 */
class FilteringReceiver implements StreamReceiver {
  datagram: ((data: Uint8Array, arrivalMs: number) => void) | null = null;
  stateCb: ((s: StreamConnectionState) => void) | null = null;
  readonly destination = "239.0.1.64:11000";
  closed = false;
  adopted: string | null = null;
  diagnostics: SenderFilterDiagnostics | null = {
    rejectedPackets: 27_400,
    lastRejectedSource: "192.168.1.148",
    expectedSource: "192.168.1.9",
  };
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
  async readDiagnostics() {
    return this.diagnostics;
  }
  async setExpectedSource(host: string | null) {
    this.adopted = host;
    this.diagnostics = { rejectedPackets: 0, expectedSource: host ?? undefined };
  }
}

/** Run the watchdog past its 8 s silence budget, letting the diagnosis promise settle. */
const goSilent = async (clock: { value: number }) => {
  for (let i = 0; i < 10; i += 1) {
    clock.value += 1000;
    await vi.advanceTimersByTimeAsync(1000);
  }
  await vi.advanceTimersByTimeAsync(0);
};

describe("a Live View stream that is arriving from an address the filter refuses", () => {
  it("tells the video user which address the packets came from, not that the stream stopped", async () => {
    vi.useFakeTimers();
    try {
      const clock = { value: 0 };
      const receiver = new FilteringReceiver();
      const controller = new VideoMirrorController({
        createReceiver: () => receiver,
        startStream: vi.fn(async () => ({ errors: [] })),
        stopStream: vi.fn(async () => ({ errors: [] })),
        onChange: vi.fn(),
        expectedSenderHost: () => "192.168.1.9",
        now: () => clock.value,
      });
      await controller.start();
      receiver.emitState("open");
      expect(controller.getSnapshot().state).toBe("live");

      await goSilent(clock);

      expect(controller.getSnapshot().state).toBe("error");
      expect(controller.getSnapshot().error).toBe(
        "Video packets are arriving from 192.168.1.148 and being dropped — the app is only accepting packets from 192.168.1.9.",
      );
      expect(controller.getSnapshot().senderMismatch).toEqual({
        source: "192.168.1.148",
        expected: "192.168.1.9",
        rejectedPackets: 27_400,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the plain message when the filter refused nothing, so a dead stream still reads as one", async () => {
    vi.useFakeTimers();
    try {
      const clock = { value: 0 };
      const receiver = new FilteringReceiver();
      receiver.diagnostics = { rejectedPackets: 0, expectedSource: "192.168.1.9" };
      const controller = new VideoMirrorController({
        createReceiver: () => receiver,
        startStream: vi.fn(async () => ({ errors: [] })),
        stopStream: vi.fn(async () => ({ errors: [] })),
        onChange: vi.fn(),
        expectedSenderHost: () => "192.168.1.9",
        now: () => clock.value,
      });
      await controller.start();
      receiver.emitState("open");
      await goSilent(clock);

      expect(controller.getSnapshot().error).toBe("The video stream stopped arriving.");
      expect(controller.getSnapshot().senderMismatch).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("adopts the sender on the socket that is already bound and goes live again", async () => {
    vi.useFakeTimers();
    try {
      const clock = { value: 0 };
      const receiver = new FilteringReceiver();
      const startStream = vi.fn(async () => ({ errors: [] }));
      const controller = new VideoMirrorController({
        createReceiver: () => receiver,
        startStream,
        stopStream: vi.fn(async () => ({ errors: [] })),
        onChange: vi.fn(),
        expectedSenderHost: () => "192.168.1.9",
        now: () => clock.value,
      });
      await controller.start();
      receiver.emitState("open");
      await goSilent(clock);
      const mismatch = controller.getSnapshot().senderMismatch;
      expect(mismatch).not.toBeNull();

      await controller.adoptSender(mismatch!.source);

      expect(receiver.adopted).toBe("192.168.1.148");
      expect(receiver.closed).toBe(false);
      // The device was told to stream once, at start. Recovery retargets the filter rather than
      // restarting the one part of the path that is demonstrably working.
      expect(startStream).toHaveBeenCalledTimes(1);
      expect(controller.getSnapshot().state).toBe("live");
      expect(controller.getSnapshot().error).toBeNull();
      expect(controller.getSnapshot().senderMismatch).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("diagnoses the audio stream the same way", async () => {
    vi.useFakeTimers();
    try {
      const clock = { value: 0 };
      const receiver = new FilteringReceiver();
      vi.spyOn(performance, "now").mockImplementation(() => clock.value);
      const controller = new AudioMirrorController({
        createReceiver: () => receiver,
        createPlayer: () =>
          ({
            start: vi.fn(async () => true),
            playChunk: vi.fn(),
            stop: vi.fn(async () => {}),
            scheduledChunks: 0,
          }) as unknown as AudioMirrorPlayer,
        startStream: vi.fn(async () => ({ errors: [] })),
        stopStream: vi.fn(async () => ({ errors: [] })),
        onChange: vi.fn(),
        expectedSenderHost: () => "192.168.1.9",
      });
      await controller.start();
      receiver.emitState("open");
      expect(controller.getSnapshot().state).toBe("live");

      await goSilent(clock);

      expect(controller.getSnapshot().error).toBe(
        "Audio packets are arriving from 192.168.1.148 and being dropped — the app is only accepting packets from 192.168.1.9.",
      );
      expect(controller.getSnapshot().senderMismatch?.source).toBe("192.168.1.148");

      await controller.adoptSender("192.168.1.148");
      expect(receiver.adopted).toBe("192.168.1.148");
      expect(controller.getSnapshot().state).toBe("live");
    } finally {
      vi.restoreAllMocks();
      vi.useRealTimers();
    }
  });
});
