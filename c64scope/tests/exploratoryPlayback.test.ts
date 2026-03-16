/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { describe, expect, it } from "vitest";
import { expectedMuteToggleLabel, requireAudioFeatures } from "../src/validation/cases/exploratoryPlayback.js";

describe("exploratory playback audio analysis guard", () => {
  it("rejects non-audio analysis payloads before latency calculations", () => {
    expect(() => requireAudioFeatures({ stats: {} }, "mute transition")).toThrow(
      /Expected audio analysis with envelope data for mute transition/,
    );
  });

  it("rejects incomplete audio analysis payloads after the envelope check", () => {
    expect(() => requireAudioFeatures({ envelope: [], stats: {} }, "unmute transition")).toThrow(
      /Expected complete audio analysis payload for unmute transition/,
    );
  });

  it("accepts audio analysis payloads with the expected shape", () => {
    const analysis = requireAudioFeatures(
      {
        sampleRateHz: 48000,
        rms: 0.25,
        peakAbs: 0.5,
        dominantFrequencyHz: 440,
        samplePairs: 2048,
        envelope: [
          {
            receivedAtMs: 0,
            packetDurationMs: 10,
            rms: 0.25,
            peakAbs: 0.5,
            samplePairs: 512,
          },
        ],
        stats: {
          packetCount: 1,
          sequenceStart: 1,
          sequenceEnd: 1,
          expectedPackets: 1,
          droppedPackets: 0,
          outOfOrderPackets: 0,
        },
      },
      "mute transition",
    );

    expect(analysis.sampleRateHz).toBe(48000);
    expect(analysis.envelope).toHaveLength(1);
  });

  it("requires the mute phase to target the mute label only", () => {
    expect(expectedMuteToggleLabel("mute")).toBe("Mute");
  });

  it("requires the unmute phase to target the unmute label only", () => {
    expect(expectedMuteToggleLabel("unmute")).toBe("Unmute");
  });
});
