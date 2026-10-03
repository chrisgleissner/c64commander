/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { AudioMirrorController } from "@/lib/streams/audioMirrorController";
import { VideoMirrorController } from "@/lib/streams/videoMirrorController";
import type { StreamConnectionState, StreamReceiver } from "@/lib/streams/streamReceiver";

const fakeReceiver = () => {
  let onState: ((state: StreamConnectionState) => void) | null = null;
  const receiver: StreamReceiver & { emit: (state: StreamConnectionState) => void; close: ReturnType<typeof vi.fn> } = {
    destination: "239.0.1.65:11001",
    onDatagram: vi.fn(),
    onStateChange: (handler) => {
      onState = handler;
    },
    close: vi.fn(() => onState?.("closed")),
    emit: (state) => onState?.(state),
  };
  return receiver;
};

describe("restarting a mirror that is in the error state", () => {
  it("closes the video receiver of the failed session before binding a new one", async () => {
    const receivers: ReturnType<typeof fakeReceiver>[] = [];
    const controller = new VideoMirrorController({
      createReceiver: () => {
        const receiver = fakeReceiver();
        receivers.push(receiver);
        return receiver;
      },
      startStream: vi.fn(async () => ({})),
      stopStream: vi.fn(async () => ({})),
      onChange: vi.fn(),
    });

    await controller.start();
    receivers[0].emit("open");
    receivers[0].emit("error");
    expect(controller.getSnapshot().state).toBe("error");

    await controller.start();

    expect(receivers).toHaveLength(2);
    expect(receivers[0].close).toHaveBeenCalled();
    expect(receivers[1].close).not.toHaveBeenCalled();
    expect(controller.getSnapshot().state).toBe("connecting");
    receivers[1].emit("open");
    expect(controller.getSnapshot().state).toBe("live");
  });

  it("closes the audio receiver and native sink of the failed session before opening new ones", async () => {
    const receivers: ReturnType<typeof fakeReceiver>[] = [];
    const sinks: { close: ReturnType<typeof vi.fn> }[] = [];
    const controller = new AudioMirrorController({
      createReceiver: () => {
        const receiver = fakeReceiver();
        receivers.push(receiver);
        return receiver;
      },
      createNativeSink: () => {
        const sink = {
          open: vi.fn(async () => true),
          close: vi.fn(async () => {}),
          getStats: () => ({ bufferedMs: 0, underruns: 0 }),
          senders: [],
          bufferCapacityMs: 40,
        };
        sinks.push(sink);
        return sink as never;
      },
      startStream: vi.fn(async () => ({})),
      stopStream: vi.fn(async () => ({})),
      onChange: vi.fn(),
    });

    await controller.start();
    receivers[0].emit("open");
    receivers[0].emit("error");
    expect(controller.getSnapshot().state).toBe("error");

    await controller.start();

    expect(receivers).toHaveLength(2);
    expect(receivers[0].close).toHaveBeenCalled();
    expect(sinks[0].close).toHaveBeenCalled();
    expect(sinks[1].close).not.toHaveBeenCalled();
    expect(controller.getSnapshot().state).toBe("connecting");
    receivers[1].emit("open");
    expect(controller.getSnapshot().state).toBe("live");
  });
});
