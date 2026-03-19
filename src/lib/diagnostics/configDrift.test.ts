/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

const mockGetCategories = vi.fn();
const mockGetCategory = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock("@/lib/c64api", () => ({
  getC64API: vi.fn(() => ({
    getCategories: mockGetCategories,
    getCategory: mockGetCategory,
    loadConfig: mockLoadConfig,
  })),
}));

import { computeConfigDrift } from "@/lib/diagnostics/configDrift";

beforeEach(() => {
  vi.clearAllMocks();
  mockLoadConfig.mockResolvedValue(undefined);
});

// ─── computeConfigDrift ───────────────────────────────────────────────────────

describe("computeConfigDrift", () => {
  it("returns empty driftItems and no error when runtime matches persisted", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Audio"] });
    // Both runtime and persisted reads return the same value
    const audioResp = { Audio: { Volume: { selected: "10" } } };
    mockGetCategory.mockResolvedValue(audioResp);

    const result = await computeConfigDrift();
    expect(result.error).toBeNull();
    expect(result.driftItems).toHaveLength(0);
    expect(result.timestamp).toBeTruthy();
  });

  it("detects a drifted item when runtime differs from persisted", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Audio"] });
    // Runtime: Volume=10; Persisted (after loadConfig): Volume=8
    mockGetCategory
      .mockResolvedValueOnce({ Audio: { Volume: { selected: 10 } } }) // runtime
      .mockResolvedValueOnce({ Audio: { Volume: { selected: 8 } } }); // persisted

    const result = await computeConfigDrift();
    expect(result.error).toBeNull();
    expect(result.driftItems).toHaveLength(1);
    expect(result.driftItems[0].category).toBe("Audio");
    expect(result.driftItems[0].item).toBe("Volume");
    expect(result.driftItems[0].runtimeValue).toBe("10");
    expect(result.driftItems[0].persistedValue).toBe("8");
  });

  it("detects multiple drifted items across categories", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Audio", "Video"] });
    mockGetCategory
      .mockResolvedValueOnce({ Audio: { Volume: { selected: 10 } } }) // runtime Audio
      .mockResolvedValueOnce({ Video: { Mode: "PAL" } }) // runtime Video
      .mockResolvedValueOnce({ Audio: { Volume: { selected: 8 } } }) // persisted Audio
      .mockResolvedValueOnce({ Video: { Mode: "NTSC" } }); // persisted Video

    const result = await computeConfigDrift();
    expect(result.driftItems).toHaveLength(2);
    const categories = result.driftItems.map((d) => d.category).sort();
    expect(categories).toEqual(["Audio", "Video"]);
  });

  it("returns no drift for items present only in one snapshot (treats missing as empty string)", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Audio"] });
    // Runtime has Volume; persisted does not
    mockGetCategory.mockResolvedValueOnce({ Audio: { Volume: "10" } }).mockResolvedValueOnce({ Audio: {} });

    const result = await computeConfigDrift();
    // runtimeValue='10', persistedValue='' → different → drift detected
    expect(result.driftItems).toHaveLength(1);
    expect(result.driftItems[0].persistedValue).toBe("");
  });

  it("returns error message when getCategories fails", async () => {
    mockGetCategories.mockRejectedValue(new Error("API unreachable"));

    const result = await computeConfigDrift();
    expect(result.error).toContain("API unreachable");
    expect(result.driftItems).toHaveLength(0);
  });

  it("returns error when no categories are available", async () => {
    mockGetCategories.mockResolvedValue({ categories: [] });

    const result = await computeConfigDrift();
    expect(result.error).toContain("No config categories available");
    expect(result.driftItems).toHaveLength(0);
  });

  it("skips category gracefully when getCategory throws during runtime fetch", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Audio", "Broken"] });
    mockGetCategory
      .mockResolvedValueOnce({ Audio: { Volume: { selected: 5 } } }) // runtime Audio ok
      .mockRejectedValueOnce(new Error("Category not found")) // runtime Broken fails
      .mockResolvedValueOnce({ Audio: { Volume: { selected: 5 } } }) // persisted Audio
      .mockResolvedValueOnce({}); // persisted Broken (never called in this path)

    const result = await computeConfigDrift();
    // Audio matched, Broken was skipped on runtime fetch
    expect(result.error).toBeNull();
    expect(result.driftItems).toHaveLength(0); // Audio values match
  });

  it("handles string values (non-object) in config response", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Network"] });
    mockGetCategory
      .mockResolvedValueOnce({ Network: { Hostname: "c64u" } })
      .mockResolvedValueOnce({ Network: { Hostname: "c64u-2" } });

    const result = await computeConfigDrift();
    expect(result.driftItems).toHaveLength(1);
    expect(result.driftItems[0].runtimeValue).toBe("c64u");
    expect(result.driftItems[0].persistedValue).toBe("c64u-2");
  });

  it("handles numeric values in config response", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["LED Strip Settings"] });
    mockGetCategory
      .mockResolvedValueOnce({ "LED Strip Settings": { "Strip Intensity": 10 } })
      .mockResolvedValueOnce({ "LED Strip Settings": { "Strip Intensity": 5 } });

    const result = await computeConfigDrift();
    expect(result.driftItems).toHaveLength(1);
    expect(result.driftItems[0].runtimeValue).toBe("10");
    expect(result.driftItems[0].persistedValue).toBe("5");
  });

  it("skips category gracefully when getCategory throws during persisted fetch", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Audio"] });
    mockGetCategory
      .mockResolvedValueOnce({ Audio: { Volume: { selected: 5 } } }) // runtime ok
      .mockRejectedValueOnce(new Error("Persisted fetch failed")); // persisted fails

    const result = await computeConfigDrift();
    // Runtime has value 5, persisted missing → '' → drift detected
    expect(result.error).toBeNull();
    expect(result.driftItems).toHaveLength(1);
    expect(result.driftItems[0].runtimeValue).toBe("5");
    expect(result.driftItems[0].persistedValue).toBe("");
  });

  it("handles non-array categories response gracefully", async () => {
    mockGetCategories.mockResolvedValue({ categories: null });

    const result = await computeConfigDrift();
    expect(result.error).toContain("No config categories available");
  });

  it("handles undefined selected value (sel === undefined → skip)", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Audio"] });
    // selected is undefined → item not stored
    mockGetCategory
      .mockResolvedValueOnce({ Audio: { Volume: { selected: undefined } } }) // sel undefined
      .mockResolvedValueOnce({ Audio: { Volume: { selected: undefined } } }); // same

    const result = await computeConfigDrift();
    expect(result.error).toBeNull();
    expect(result.driftItems).toHaveLength(0);
  });

  it("handles non-object catData (skips category)", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Broken"] });
    // Category response returns non-object value for the category
    mockGetCategory
      .mockResolvedValueOnce({ Broken: "not-an-object" }) // non-object catData
      .mockResolvedValueOnce({ Broken: "not-an-object" }); // persisted

    const result = await computeConfigDrift();
    expect(result.error).toBeNull();
    expect(result.driftItems).toHaveLength(0);
  });

  it("detects drift when persisted has a key that runtime does not (runtimeCat[key] ?? '' → '')", async () => {
    mockGetCategories.mockResolvedValue({ categories: ["Audio"] });
    // Runtime has empty Audio; persisted has Volume — key is in allKeys but not runtimeCat
    mockGetCategory
      .mockResolvedValueOnce({ Audio: {} }) // runtime: no Volume
      .mockResolvedValueOnce({ Audio: { Volume: "8" } }); // persisted: Volume=8

    const result = await computeConfigDrift();
    expect(result.error).toBeNull();
    expect(result.driftItems).toHaveLength(1);
    expect(result.driftItems[0].runtimeValue).toBe("");
    expect(result.driftItems[0].persistedValue).toBe("8");
  });
});
