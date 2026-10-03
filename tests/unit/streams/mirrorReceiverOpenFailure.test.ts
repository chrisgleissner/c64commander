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
import type { StreamReceiver } from "@/lib/streams/streamReceiver";

const receiverThatCannotBind = (): StreamReceiver => ({
  destination: "239.0.1.64:11000",
  onDatagram: vi.fn(),
  onStateChange: vi.fn(),
  ready: vi.fn(async () => {
    throw new Error("bind failed: EADDRINUSE");
  }),
  close: vi.fn(),
});

describe("a Live View receive socket the app cannot open", () => {
  it("reports the app's own socket failure for video instead of blaming the device", async () => {
    const startStream = vi.fn(async () => ({}));
    const controller = new VideoMirrorController({
      createReceiver: receiverThatCannotBind,
      startStream,
      stopStream: vi.fn(async () => ({})),
      onChange: vi.fn(),
    });

    await controller.start();

    const { state, error } = controller.getSnapshot();
    expect(state).toBe("error");
    expect(error).not.toMatch(/tell the device/);
    expect(error).toContain("bind failed: EADDRINUSE");
    expect(startStream).not.toHaveBeenCalled();
  });

  it("reports the app's own socket failure for audio instead of blaming the device", async () => {
    const startStream = vi.fn(async () => ({}));
    const controller = new AudioMirrorController({
      createReceiver: receiverThatCannotBind,
      createPlayer: () =>
        ({ start: vi.fn(async () => true), playChunk: vi.fn(), stop: vi.fn(async () => {}) }) as never,
      startStream,
      stopStream: vi.fn(async () => ({})),
      onChange: vi.fn(),
      networkBufferMs: 0,
    });

    await controller.start();

    const { state, error } = controller.getSnapshot();
    expect(state).toBe("error");
    expect(error).not.toMatch(/tell the device/);
    expect(error).toContain("bind failed: EADDRINUSE");
    expect(startStream).not.toHaveBeenCalled();
  });
});
