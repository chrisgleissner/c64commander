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
