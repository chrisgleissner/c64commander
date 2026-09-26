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
import { describeStreamStartFailure } from "@/lib/streams/streamStartFailure";
import type { StreamReceiver } from "@/lib/streams/streamReceiver";

const ETHERNET_MESSAGE = "The device's Ethernet port is not connected, and Live View streams leave only through it.";

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { c64uHttpStatus: status });

const receiver = (): StreamReceiver => ({
  destination: "239.0.1.65:11001",
  onDatagram: vi.fn(),
  onStateChange: vi.fn(),
  close: vi.fn(),
});

describe("describeStreamStartFailure", () => {
  it("says the Ethernet port is not connected when the device reports no operational network interface", () => {
    expect(describeStreamStartFailure(httpError(500), "audio")).toBe(ETHERNET_MESSAGE);
  });

  it("keeps the general message for any other refusal", () => {
    expect(describeStreamStartFailure(httpError(404), "video")).toBe(
      "Could not tell the device to start streaming video.",
    );
    expect(describeStreamStartFailure(new Error("timeout"), "audio")).toBe(
      "Could not tell the device to start streaming audio.",
    );
    expect(describeStreamStartFailure(null, "audio")).toBe("Could not tell the device to start streaming audio.");
  });
});

describe("a stream start refused because the device has no Ethernet link", () => {
  it("is explained on the audio mirror", async () => {
    const controller = new AudioMirrorController({
      createReceiver: receiver,
      createPlayer: () =>
        ({ start: vi.fn(async () => true), playChunk: vi.fn(), stop: vi.fn(async () => {}) }) as never,
      startStream: vi.fn(async () => {
        throw httpError(500);
      }),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ state: "error", error: ETHERNET_MESSAGE });
  });

  it("is explained on the video mirror", async () => {
    const controller = new VideoMirrorController({
      createReceiver: receiver,
      renderFrame: vi.fn(),
      startStream: vi.fn(async () => {
        throw httpError(500);
      }),
      stopStream: vi.fn(async () => ({ errors: [] })),
      onChange: vi.fn(),
    });

    await controller.start();

    expect(controller.getSnapshot()).toMatchObject({ state: "error", error: ETHERNET_MESSAGE });
  });
});
