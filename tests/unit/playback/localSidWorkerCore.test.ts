/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { detectRomRequired, isWorkerGlobalScope, sidMagic, toLocalSidError } from "@/lib/playback/localSidWorkerCore";

/** Build SID bytes starting with the given 4-char magic. */
const withMagic = (magic: string, extra = 60): Uint8Array => {
  const bytes = new Uint8Array(4 + extra);
  for (let i = 0; i < 4; i += 1) bytes[i] = magic.charCodeAt(i);
  return bytes;
};

describe("localSidWorkerCore", () => {
  describe("sidMagic", () => {
    it("reads PSID/RSID magic", () => {
      expect(sidMagic(withMagic("PSID"))).toBe("PSID");
      expect(sidMagic(withMagic("RSID"))).toBe("RSID");
    });
    it("returns UNKNOWN for other or too-short data", () => {
      expect(sidMagic(withMagic("MP3\0"))).toBe("UNKNOWN");
      expect(sidMagic(new Uint8Array([0x50, 0x53]))).toBe("UNKNOWN");
    });
  });

  describe("detectRomRequired", () => {
    it("flags RSID as ROM-dependent (routed to Play on C64)", () => {
      expect(detectRomRequired(withMagic("RSID"))).toBe(true);
    });
    it("treats PSID as ROM-independent (plays on device)", () => {
      expect(detectRomRequired(withMagic("PSID"))).toBe(false);
    });
    it("does not flag unknown data (engine rejects it)", () => {
      expect(detectRomRequired(withMagic("junk"))).toBe(false);
    });
  });

  describe("isWorkerGlobalScope", () => {
    it("is false on the main thread / jsdom (no WorkerGlobalScope)", () => {
      // vitest runs in jsdom where there is no WorkerGlobalScope — the guard
      // must not throw and must report "not a worker".
      expect(isWorkerGlobalScope()).toBe(false);
    });
  });

  describe("toLocalSidError", () => {
    it("normalises an Error with a code, without an id", () => {
      expect(toLocalSidError(new Error("boom"), "render")).toEqual({
        type: "error",
        code: "render",
        message: "boom",
      });
    });
    it("includes the id when provided and stringifies non-errors", () => {
      expect(toLocalSidError("nope", "open", 7)).toEqual({
        type: "error",
        code: "open",
        id: 7,
        message: "nope",
      });
    });
  });
});
