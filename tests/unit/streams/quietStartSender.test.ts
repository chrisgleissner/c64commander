/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { AudioMirrorController } from "@/lib/streams/audioMirrorController";
import { VideoMirrorController } from "@/lib/streams/videoMirrorController";
import type { SenderFilterDiagnostics } from "@/lib/streams/senderMismatch";
import type { StreamConnectionState, StreamReceiver } from "@/lib/streams/streamReceiver";

/**
 * A device selected by its Wi-Fi address streams from its Ethernet address, so the sender filter
 * refuses everything from the first packet. The mirror must say so within a couple of seconds,
 * not after the eight-second silence timeout, so the session can accept the address sooner.
 */

const refusingReceiver = (diagnostics: SenderFilterDiagnostics) => {
  let onState: ((state: StreamConnectionState) => void) | null = null;
  const receiver: StreamReceiver & { open: () => void } = {
    destination: "239.0.1.64:11000",
    onDatagram: vi.fn(),
    onStateChange: (handler) => {
      onState = handler;
    },
    readDiagnostics: vi.fn(async () => diagnostics),
    close: vi.fn(),
    open: () => onState?.("open"),
  };
  return receiver;
};

const refused: SenderFilterDiagnostics = {
  rejectedPackets: 480,
  lastRejectedSource: "192.0.2.47",
  expectedSource: "192.0.2.46",
};

describe("a new stream whose packets the sender filter refuses", () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    clock = 0;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  const advance = async (ms: number) => {
    for (let elapsed = 0; elapsed < ms; elapsed += 1000) {
      clock += 1000;
      await vi.advanceTimersByTimeAsync(1000);
    }
  };

  it("reports the refused sender on the video mirror two seconds in, without an error", async () => {
    const receiver = refusingReceiver(refused);
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      expectedSenderHost: () => "192.0.2.46",
      onChange: vi.fn(),
      now: () => clock,
    });
    await controller.start();
    receiver.open();

    await advance(2000);

    expect(controller.getSnapshot()).toMatchObject({
      state: "live",
      error: null,
      senderMismatch: { source: "192.0.2.47", expected: "192.0.2.46", rejectedPackets: 480 },
    });
  });

  it("reports the refused sender on the audio mirror two seconds in, without an error", async () => {
    const receiver = refusingReceiver(refused);
    const controller = new AudioMirrorController({
      createReceiver: () => receiver,
      createPlayer: () =>
        ({ start: vi.fn(async () => true), playChunk: vi.fn(), stop: vi.fn(async () => {}) }) as never,
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      expectedSenderHost: () => "192.0.2.46",
      onChange: vi.fn(),
      networkBufferMs: 0,
    });
    await controller.start();
    receiver.open();

    await advance(2000);

    expect(controller.getSnapshot()).toMatchObject({
      state: "live",
      error: null,
      senderMismatch: { source: "192.0.2.47", expected: "192.0.2.46" },
    });
  });

  it("reports nothing when the filter has refused nothing", async () => {
    const receiver = refusingReceiver({ rejectedPackets: 0 });
    const controller = new VideoMirrorController({
      createReceiver: () => receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => ({ errors: [] })),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
      now: () => clock,
    });
    await controller.start();
    receiver.open();

    await advance(2000);

    expect(controller.getSnapshot()).toMatchObject({ state: "live", senderMismatch: null });
  });
});
