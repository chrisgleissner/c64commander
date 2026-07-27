import { beforeEach, describe, expect, it, vi } from "vitest";

import { C64_ROM_BYTES, romFingerprint } from "@/lib/roms/c64SystemRoms";
import { clearStoredRoms, hasCompleteRomSet, loadRomSummaries, loadStoredRoms, saveRom } from "@/lib/roms/romStore";

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

const STORAGE_KEY = "c64commander.localEngine.systemRoms.v1";

const store = (kind: "kernal" | "basic", bytes: Uint8Array) =>
  saveRom(kind, bytes, { description: `test ${kind}`, fingerprint: romFingerprint(bytes), capturedFrom: "c64u.local" });

describe("romStore", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("round-trips both images", () => {
    store("kernal", kernal());
    store("basic", basic());

    const loaded = loadStoredRoms();
    expect(loaded.kernal).toEqual(kernal());
    expect(loaded.basic).toEqual(basic());
    expect(hasCompleteRomSet()).toBe(true);
  });

  it("reports an incomplete set when only one image is present", () => {
    store("kernal", kernal());
    expect(hasCompleteRomSet()).toBe(false);
  });

  it("summarises without exposing the image bytes", () => {
    store("kernal", kernal());
    const [summary] = loadRomSummaries();

    expect(summary).toBeDefined();
    expect(summary!.description).toBe("test kernal");
    expect(summary!.capturedFrom).toBe("c64u.local");
    expect(summary!.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // The bytes must never leak into anything renderable or loggable.
    expect(JSON.stringify(summary)).not.toContain("data");
  });

  it("lets the user revoke the images", () => {
    store("kernal", kernal());
    store("basic", basic());
    clearStoredRoms();

    expect(loadStoredRoms()).toEqual({});
    expect(loadRomSummaries()).toEqual([]);
    expect(hasCompleteRomSet()).toBe(false);
  });

  it("ignores an entry whose bytes no longer match its fingerprint", () => {
    // Degrading to "no ROMs" routes playback to the C64, which is safe. Feeding
    // the engine a corrupted image would instead produce silently wrong audio.
    store("kernal", kernal());
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.kernal.fingerprint = "deadbeef";
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    expect(loadStoredRoms().kernal).toBeUndefined();
  });

  it("ignores an entry that is no longer structurally a ROM", () => {
    store("basic", basic());
    const corrupted = basic();
    corrupted.set([0, 0, 0, 0, 0, 0, 0, 0], 4); // destroy the CBMBASIC signature
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY)!);
    raw.basic.data = btoa(String.fromCharCode(...corrupted));
    raw.basic.fingerprint = romFingerprint(corrupted);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));

    expect(loadStoredRoms().basic).toBeUndefined();
  });

  it("survives unreadable storage rather than throwing", () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    expect(loadStoredRoms()).toEqual({});
    expect(loadRomSummaries()).toEqual([]);
  });
});
