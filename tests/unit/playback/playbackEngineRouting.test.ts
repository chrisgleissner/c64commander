/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  ENGINE_FALLBACK_MESSAGES,
  preRouteEngine,
  romFallbackDecision,
  shouldAttemptLocalEngine,
} from "@/lib/playback/playbackEngineRouting";

describe("playbackEngineRouting", () => {
  describe("preRouteEngine", () => {
    it("routes everything to the C64 when the engine is c64", () => {
      for (const category of ["sid", "mod", "prg", "crt", "disk"] as const) {
        expect(preRouteEngine({ category, engine: "c64", localSupported: true })).toEqual({
          route: "c64",
          notice: null,
        });
      }
    });

    it("plays a SID here when the device answering is the simulation, whatever the engine setting says", () => {
      // The simulated device has no SID chip, so a tune sent to it is a success toast and silence.
      expect(preRouteEngine({ category: "sid", engine: "c64", localSupported: true, simulatedDevice: true })).toEqual({
        route: "local",
        notice: "simulated-device-local-sid",
      });
    });

    it("leaves everything the local engine cannot play on the simulated device", () => {
      // Only SID can play on-device, and the simulated device does show a screen for a program or a
      // cartridge — so those still go to it rather than failing here.
      for (const category of ["mod", "prg", "crt", "disk"] as const) {
        expect(preRouteEngine({ category, engine: "c64", localSupported: true, simulatedDevice: true })).toEqual({
          route: "c64",
          notice: null,
        });
      }
    });

    it("does not claim the local engine on the simulated device when the platform cannot run it", () => {
      expect(preRouteEngine({ category: "sid", engine: "c64", localSupported: false, simulatedDevice: true })).toEqual({
        route: "c64",
        notice: null,
      });
    });

    it("plays a supported SID on the local engine", () => {
      expect(preRouteEngine({ category: "sid", engine: "local", localSupported: true })).toEqual({
        route: "local",
        notice: null,
      });
    });

    it("falls back non-SID categories to the C64 with a one-time notice", () => {
      for (const category of ["mod", "prg", "crt", "disk"] as const) {
        expect(preRouteEngine({ category, engine: "local", localSupported: true })).toEqual({
          route: "c64",
          notice: "non-sid-on-c64",
        });
      }
    });

    it("falls back to the C64 when Web Worker / Web Audio is unavailable", () => {
      expect(preRouteEngine({ category: "sid", engine: "local", localSupported: false })).toEqual({
        route: "c64",
        notice: "local-unavailable",
      });
    });
  });

  describe("shouldAttemptLocalEngine", () => {
    it("is true only for a supported SID with the local engine selected", () => {
      expect(shouldAttemptLocalEngine({ category: "sid", engine: "local", localSupported: true })).toBe(true);
      expect(shouldAttemptLocalEngine({ category: "sid", engine: "local", localSupported: false })).toBe(false);
      expect(shouldAttemptLocalEngine({ category: "sid", engine: "c64", localSupported: true })).toBe(false);
      expect(shouldAttemptLocalEngine({ category: "prg", engine: "local", localSupported: true })).toBe(false);
    });
  });

  describe("romFallbackDecision", () => {
    it("still plays an ordinary tune here without ROMs, on the lighter emulation", () => {
      // The accurate engine needs the kernal and basic images to run ANY tune, not only an RSID, and
      // nothing fetched them — so a fresh install that chose "listen on this device" got silence.
      // Measured on a Pixel 4: engine local, no stored ROMs, zero audio players, microphone at room
      // noise.
      //
      // Amended from an earlier fix that sent these to the C64 instead. Redirecting is defensible but
      // it is not what the listener asked for, and it is unnecessary: the lighter emulation carries
      // its own kernal-free playback. So the tune plays where it was asked to play, the substitution
      // is explained, and the images are fetched in the background for the next one.
      expect(romFallbackDecision(false, false)).toEqual({ route: "local", notice: "rom-lite-engine" });
    });

    it("plays an ordinary tune on the device once the ROMs are there", () => {
      expect(romFallbackDecision(false, true)).toEqual({ route: "local", notice: null });
    });

    it("still sends an RSID to the C64 even with the ROMs stored", () => {
      expect(romFallbackDecision(true, true)).toEqual({ route: "c64", notice: "rom-on-c64" });
    });

    it("keeps a ROM-independent SID on the local engine", () => {
      expect(romFallbackDecision(false)).toEqual({ route: "local", notice: null });
    });
    it("falls a ROM-dependent SID back to the C64 with a notice", () => {
      expect(romFallbackDecision(true)).toEqual({ route: "c64", notice: "rom-on-c64" });
    });
  });

  it("has a message for every fallback notice", () => {
    for (const notice of ["non-sid-on-c64", "rom-on-c64", "local-unavailable"] as const) {
      expect(ENGINE_FALLBACK_MESSAGES[notice]).toMatch(/C64/);
    }
  });
});
