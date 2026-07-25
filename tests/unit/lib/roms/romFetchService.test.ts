import { beforeEach, describe, expect, it, vi } from "vitest";

import type { C64API } from "@/lib/c64api";
import { C64_ROM_BYTES } from "@/lib/roms/c64SystemRoms";
import { fetchSystemRomsFromDevice } from "@/lib/roms/romFetchService";
import { loadStoredRoms } from "@/lib/roms/romStore";

// Mock only what this suite needs, matching the real module's export shape.
// A previous version mocked a `logger` object that logging.ts does not export;
// vitest happily resolved it while the production build failed to link.
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

/** Synthesised, never a real ROM dump — those are not distributed with this app. */
function noisyImage(seed: number): Uint8Array {
  const bytes = new Uint8Array(C64_ROM_BYTES);
  let state = seed >>> 0;
  for (let i = 0; i < bytes.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    bytes[i] = (state >>> 24) & 0xff;
  }
  return bytes;
}

function kernal(): Uint8Array {
  const bytes = noisyImage(0x1234);
  bytes[0xff80 - 0xe000] = 0x03;
  bytes[0xfffc - 0xe000] = 0xe2;
  bytes[0xfffc - 0xe000 + 1] = 0xfc;
  return bytes;
}

function basic(): Uint8Array {
  const bytes = noisyImage(0x5678);
  "CBMBASIC".split("").forEach((char, index) => {
    bytes[4 + index] = char.charCodeAt(0);
  });
  return bytes;
}

function fakeApi(responses: Partial<Record<string, Uint8Array | Error>>): C64API {
  return {
    readMemory: vi.fn(async (address: string) => {
      const response = responses[address];
      if (response instanceof Error) throw response;
      if (!response) throw new Error(`unexpected read of ${address}`);
      return response;
    }),
  } as unknown as C64API;
}

describe("fetchSystemRomsFromDevice", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("reads KERNAL from $E000 and BASIC from $A000 and stores both", async () => {
    const api = fakeApi({ e000: kernal(), a000: basic() });

    const result = await fetchSystemRomsFromDevice(api, "c64u.local");

    expect(result.ok).toBe(true);
    // Assert the exact options, not expect.anything(): an earlier version passed a
    // free-text description as __c64uIntent, which is a typed enum
    // ("user" | "system" | "background"). expect.anything() accepted it and the
    // real device call then threw inside the interaction scheduler.
    expect(api.readMemory).toHaveBeenCalledWith("e000", 8192, { __c64uIntent: "user" });
    expect(api.readMemory).toHaveBeenCalledWith("a000", 8192, { __c64uIntent: "user" });

    const stored = loadStoredRoms();
    expect(stored.kernal).toEqual(kernal());
    expect(stored.basic).toEqual(basic());
  });

  it("never fetches chargen — $D000 is I/O under default banking", async () => {
    const api = fakeApi({ e000: kernal(), a000: basic() });
    await fetchSystemRomsFromDevice(api, "c64u.local");
    expect(api.readMemory).not.toHaveBeenCalledWith("d000", expect.anything(), expect.anything());
  });

  it("does NOT store a dump that fails validation", async () => {
    // A DMA read reflects current banking: with a cartridge active it returns RAM,
    // which is still 8192 plausible-looking bytes. Storing that would silently
    // poison playback, so it must be rejected.
    const api = fakeApi({ e000: new Uint8Array(C64_ROM_BYTES).fill(0xff), a000: basic() });

    const result = await fetchSystemRomsFromDevice(api, "c64u.local");

    expect(result.ok).toBe(false);
    expect(loadStoredRoms().kernal).toBeUndefined();
    const kernalOutcome = result.outcomes.find((outcome) => outcome.kind === "kernal");
    expect(kernalOutcome?.ok).toBe(false);
    expect(kernalOutcome?.reason).toContain("not a ROM");
  });

  it("keeps a good image when the other read fails", async () => {
    const api = fakeApi({ e000: kernal(), a000: new Error("device unreachable") });

    const result = await fetchSystemRomsFromDevice(api, "c64u.local");

    expect(result.ok).toBe(false);
    expect(loadStoredRoms().kernal).toEqual(kernal());
    expect(result.outcomes.find((outcome) => outcome.kind === "basic")?.reason).toContain("device unreachable");
  });

  it("reports a readable description and fingerprint for each stored image", async () => {
    const api = fakeApi({ e000: kernal(), a000: basic() });

    const result = await fetchSystemRomsFromDevice(api, "c64u.local");

    for (const outcome of result.outcomes) {
      expect(outcome.ok).toBe(true);
      expect(outcome.description).toBeTruthy();
      expect(outcome.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    }
  });
});
