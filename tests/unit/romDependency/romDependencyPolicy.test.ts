/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addErrorLog } from "@/lib/logging";
import {
  loadEmbeddedRomDependencyList,
  PINNED_MANIFEST_SHA256,
  setRomDependencyAssetsForTests,
  validateRomDependencyAssets,
} from "@/lib/romDependency/embeddedRomDependencyList";
import { decodeRomDependencyList } from "@/lib/romDependency/romDependencyList";
import { assessRomDependency, resolveActiveRomLane } from "@/lib/romDependency/romDependencyPolicy";
import {
  FAKE_REFERENCE_ROMS,
  FAKE_ROMS,
  readFixture,
  syntheticAssets,
  syntheticSid,
  SYNTHETIC_SID_MD5,
} from "../../helpers/romDependencyFixture";

vi.mock("@/lib/logging", () => ({ addErrorLog: vi.fn(), addLog: vi.fn() }));
vi.mock("@/lib/sid/sidUtils", () => ({ computeSidMd5: vi.fn(async () => "788728f8e8eb6f7e2c5918b28383a1d6") }));

const authentic = { kernal: FAKE_ROMS.kernal, basic: FAKE_ROMS.basic };

describe("resolveActiveRomLane", () => {
  const lane = (engine: Parameters<typeof resolveActiveRomLane>[0], roms: Parameters<typeof resolveActiveRomLane>[1]) =>
    resolveActiveRomLane(engine, roms, FAKE_REFERENCE_ROMS);

  it.each([
    ["sidlite", {}, "sidliteNone", false],
    ["residfp", {}, "residfpNone", false],
    ["sidlite", authentic, "sidliteKernalBasic", false],
    ["residfp", authentic, "residfpKernalBasic", false],
    // libSidplayEZ is reSIDfp-based but not the audited build: read as reSIDfp, flagged approximate.
    ["sidplayez", {}, "residfpNone", true],
    ["sidplayez", authentic, "residfpKernalBasic", true],
    // The engine is only given the images when it has both, so a lone image is no ROMs at all.
    ["sidlite", { kernal: FAKE_ROMS.kernal }, "sidliteNone", false],
    ["residfp", { basic: FAKE_ROMS.basic }, "residfpNone", false],
  ] as const)("%s with %j is the %s configuration", (engine, roms, expected, approximate) => {
    expect(lane(engine, roms)).toEqual({ kind: "lane", lane: expected, approximate });
  });

  it("is the reference configuration with all three authentic ROMs, whatever the engine", () => {
    for (const engine of ["sidlite", "residfp", "sidplayez"] as const) {
      expect(lane(engine, { ...authentic, chargen: FAKE_ROMS.chargen })).toEqual({ kind: "reference" });
    }
  });

  it("reads KERNAL and BASIC images that are not the authentic ones (for example JiffyDOS) as the KERNAL + BASIC configuration, approximately", () => {
    const other = new Uint8Array(8192).fill(1);
    expect(lane("residfp", { kernal: other, basic: FAKE_ROMS.basic })).toEqual({
      kind: "lane",
      lane: "residfpKernalBasic",
      approximate: true,
    });
    expect(lane("sidlite", { kernal: FAKE_ROMS.kernal, basic: other })).toEqual({
      kind: "lane",
      lane: "sidliteKernalBasic",
      approximate: true,
    });
    // A character ROM that is not the authentic one is no better than an approximation either.
    expect(lane("sidlite", { ...authentic, chargen: other })).toEqual({
      kind: "lane",
      lane: "sidliteKernalBasic",
      approximate: true,
    });
  });

  it("keeps a missing or partial ROM set on the no-ROMs configuration, even when the one image is not authentic", () => {
    expect(lane("sidlite", { kernal: new Uint8Array(8192).fill(1) })).toEqual({
      kind: "lane",
      lane: "sidliteNone",
      approximate: false,
    });
  });
});

describe("assessRomDependency", () => {
  // Fixture grades [sidliteNone, sidliteKernalBasic, residfpNone, residfpKernalBasic], threshold 128:
  //   subtune 1: 0, 255, 120, 253    subtune 2: 254, 100, 255, 127    subtune 3: 128, 255, 129, 254
  const assess = (
    engine: Parameters<typeof assessRomDependency>[0]["engine"],
    songNr: number | null | undefined,
    roms: Parameters<typeof assessRomDependency>[0]["roms"] = {},
    threshold?: number,
  ) => assessRomDependency({ sidBytes: syntheticSid(), songNr, engine, roms, threshold });

  beforeEach(() => {
    const { assets, pin } = syntheticAssets();
    setRomDependencyAssetsForTests(async () => assets, pin);
  });
  afterEach(() => setRomDependencyAssetsForTests(null));

  it("reports a song as low only in the lane where its grade is below the threshold", async () => {
    expect(await assess("sidlite", 1)).toEqual({ kind: "low", lane: "sidliteNone", grade: 0, approximate: false });
    expect(await assess("residfp", 1)).toEqual({ kind: "low", lane: "residfpNone", grade: 120, approximate: false });
    // Subtune 1 grades 255 and 253 once KERNAL and BASIC are supplied.
    expect(await assess("sidlite", 1, authentic)).toEqual({ kind: "none" });
    expect(await assess("residfp", 1, authentic)).toEqual({ kind: "none" });
    // Subtune 2 is the other way round.
    expect(await assess("sidlite", 2)).toEqual({ kind: "none" });
    expect(await assess("sidlite", 2, authentic)).toEqual({
      kind: "low",
      lane: "sidliteKernalBasic",
      grade: 100,
      approximate: false,
    });
  });

  it("treats a grade equal to the threshold as playable and one below it as low", async () => {
    // residfp + KERNAL/BASIC grades 127 on subtune 2: threshold 128 is one above, so low.
    expect(await assess("residfp", 2, authentic)).toEqual({
      kind: "low",
      lane: "residfpKernalBasic",
      grade: 127,
      approximate: false,
    });
    expect(await assess("residfp", 2, authentic, 127)).toEqual({ kind: "none" });
    expect(await assess("residfp", 2, authentic, 128)).toMatchObject({ kind: "low", grade: 127 });
    // Subtune 3 grades exactly 128 in sidliteNone: it plays at the list's own threshold.
    expect(await assess("sidlite", 3)).toEqual({ kind: "none" });
    expect(await assess("sidlite", 3, {}, 129)).toMatchObject({ kind: "low", grade: 128 });
    expect(await assess("residfp", 3)).toEqual({ kind: "none" }); // 129
  });

  it("uses the list's recommended minimum grade when no threshold is given", async () => {
    const { assets, pin } = syntheticAssets();
    expect(decodeRomDependencyList(assets.bin).header.recommendedMinGrade).toBe(128);
    expect(pin).toHaveLength(64);
    expect(await assess("sidlite", 3)).toEqual({ kind: "none" }); // 128 is not below 128
  });

  it("never reports 254 or 255 as low, however high the threshold", async () => {
    expect(await assess("sidlite", 2, {}, 254)).toEqual({ kind: "none" }); // 254
    expect(await assess("residfp", 2, {}, 254)).toEqual({ kind: "none" }); // 255
    expect(await assess("sidlite", 1, authentic, 254)).toEqual({ kind: "none" }); // 255
    expect(await assess("residfp", 3, authentic, 254)).toEqual({ kind: "none" }); // 254
  });

  it("reports grade 0 (no playback) as low", async () => {
    expect(await assess("sidlite", 1)).toMatchObject({ kind: "low", grade: 0 });
  });

  it("reads libSidplayEZ as reSIDfp, approximately", async () => {
    expect(await assess("sidplayez", 1)).toEqual({ kind: "low", lane: "residfpNone", grade: 120, approximate: true });
  });

  it("applies the list per subtune: an unlisted subtune of a listed file plays", async () => {
    expect(await assess("sidlite", 4)).toEqual({ kind: "none" });
  });

  it("defaults to the first tune when the item names none", async () => {
    expect(await assess("sidlite", null)).toMatchObject({ kind: "low", lane: "sidliteNone" });
    expect(await assess("sidlite", undefined)).toMatchObject({ kind: "low", lane: "sidliteNone" });
  });

  it("restricts nothing in the reference configuration, and applies the KERNAL + BASIC grade to unrecognised ROM images", async () => {
    expect(await assess("sidlite", 1, { ...authentic, chargen: FAKE_ROMS.chargen })).toEqual({ kind: "none" });
    expect(await assess("sidlite", 2, { ...authentic, chargen: FAKE_ROMS.chargen })).toEqual({ kind: "none" });
    // JiffyDOS-like images: subtune 2 grades 100 with KERNAL + BASIC, so it is a conservative hint.
    const jiffy = { kernal: new Uint8Array(8192), basic: FAKE_ROMS.basic };
    expect(await assess("sidlite", 2, jiffy)).toEqual({
      kind: "low",
      lane: "sidliteKernalBasic",
      grade: 100,
      approximate: true,
    });
    expect(await assess("sidlite", 1, jiffy)).toEqual({ kind: "none" });
  });

  it("leaves an unlisted file alone", async () => {
    const { computeSidMd5 } = await import("@/lib/sid/sidUtils");
    vi.mocked(computeSidMd5).mockResolvedValueOnce("ffffffffffffffffffffffffffffffff");
    expect(await assess("sidlite", 1)).toEqual({ kind: "none" });
    expect(SYNTHETIC_SID_MD5).toHaveLength(32);
  });
});

describe("loading and failure degradation", () => {
  afterEach(() => {
    setRomDependencyAssetsForTests(null);
    vi.clearAllMocks();
  });

  const assessWith = async (assetsFor: () => Promise<{ bin: Uint8Array; manifestText: string }>, pin?: string) => {
    setRomDependencyAssetsForTests(assetsFor, pin);
    return assessRomDependency({ sidBytes: syntheticSid(), songNr: 1, engine: "sidlite", roms: {} });
  };

  it("loads the list once", async () => {
    const { assets, pin } = syntheticAssets();
    const source = vi.fn(async () => assets);
    setRomDependencyAssetsForTests(source, pin);
    await loadEmbeddedRomDependencyList();
    await loadEmbeddedRomDependencyList();
    expect(source).toHaveBeenCalledTimes(1);
  });

  it("plays normally and logs the error when the manifest does not match the pin", async () => {
    const { assets } = syntheticAssets();
    expect(await assessWith(async () => assets, "0".repeat(64))).toEqual({ kind: "none" });
    expect(addErrorLog).toHaveBeenCalledWith(
      "SID ROM dependency list rejected; playing without it",
      expect.objectContaining({ error: expect.stringContaining("does not match the pinned") }),
    );
  });

  it("plays normally when the binary is corrupted", async () => {
    const bin = Uint8Array.from(readFixture("synthetic-sidromdep-1.bin"));
    bin[200] ^= 0xff;
    const { assets, pin } = syntheticAssets({ bin });
    expect(await assessWith(async () => assets, pin)).toEqual({ kind: "none" });
    expect(addErrorLog).toHaveBeenCalledTimes(1);
  });

  it("plays normally when the binary is not the one the manifest describes", async () => {
    const { assets, pin } = syntheticAssets({
      manifest: (m) => ((m.binary as { sha256: string }).sha256 = "a".repeat(64)),
    });
    const stale = { ...assets, bin: Uint8Array.from(readFixture("synthetic-sidromdep-1.bin")) };
    expect(await assessWith(async () => stale, pin)).toEqual({ kind: "none" });
    expect(addErrorLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: expect.stringContaining("manifest") }),
    );
  });

  it("plays normally when the assets cannot be read", async () => {
    expect(
      await assessWith(async () => {
        throw new Error("chunk failed to load");
      }),
    ).toEqual({ kind: "none" });
    expect(addErrorLog).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ error: "chunk failed to load" }),
    );
  });

  it("logs a rejected list once, not on every song", async () => {
    setRomDependencyAssetsForTests(async () => {
      throw new Error("nope");
    });
    for (let i = 0; i < 3; i++) {
      await assessRomDependency({ sidBytes: syntheticSid(), songNr: 1, engine: "sidlite", roms: {} });
    }
    expect(addErrorLog).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      "an incomplete-audit developer file",
      (m: Record<string, unknown>) => void (m.complete = false),
      /not a complete release/,
    ],
    [
      "another format",
      (m: Record<string, unknown>) => void (m.format = { id: "sidromdep-2", version: 2 }),
      /not a sidromdep-1/,
    ],
    [
      "missing reference ROM hashes",
      (m: Record<string, unknown>) => void (m.measuredProfile = {}),
      /reference ROM hashes/,
    ],
  ])("refuses a manifest that is %s", (_name, mutate, message) => {
    const { assets, pin } = syntheticAssets({ manifest: mutate });
    expect(() => validateRomDependencyAssets(assets, pin)).toThrow(message);
  });

  it("refuses a list flagged as made from an incomplete audit", () => {
    const bin = Uint8Array.from(readFixture("synthetic-sidromdep-1.bin"));
    // Flag bit 0, then repair the header CRC so only that rule is broken.
    bin[12] = 1;
    return import("@/lib/romDependency/digest").then(({ crc32 }) => {
      new DataView(bin.buffer).setUint32(52, 0, true);
      new DataView(bin.buffer).setUint32(52, crc32(bin.subarray(0, 224)), true);
      const { assets, pin } = syntheticAssets({ bin });
      expect(() => validateRomDependencyAssets(assets, pin)).toThrow(/incomplete audit/);
    });
  });

  it("ships a placeholder that validates against its pin and lists nothing", async () => {
    setRomDependencyAssetsForTests(null, PINNED_MANIFEST_SHA256);
    const loaded = await loadEmbeddedRomDependencyList();
    expect(vi.mocked(addErrorLog).mock.calls).toEqual([]);
    expect(loaded).not.toBeNull();
    expect(loaded?.list.header).toMatchObject({ hvscRelease: 85, fileCount: 0, decisionCount: 0 });
    expect(addErrorLog).not.toHaveBeenCalled();
  });
});
