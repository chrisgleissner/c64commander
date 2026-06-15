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
const mockGetC64API = vi.fn(() => ({
  getCategories: mockGetCategories,
  getCategory: mockGetCategory,
  loadConfig: mockLoadConfig,
}));

vi.mock("@/lib/c64api", () => ({
  getC64API: mockGetC64API,
}));

import { computeConfigDrift } from "@/lib/diagnostics/configDrift";

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── computeConfigDrift ───────────────────────────────────────────────────────
//
// BUG-034: Config Drift must be strictly READ-ONLY. The previous implementation
// called `PUT /v1/configs:load_from_flash` (via api.loadConfig) on every open to
// approximate the persisted snapshot — a destructive device mutation from a
// diagnostics "compare" view that silently discarded unsaved runtime changes, plus
// an unpaced request burst that tripped c64u "Connection reset". The firmware has
// no non-destructive persisted-config read, so drift is reported as unavailable
// rather than performed destructively.

describe("computeConfigDrift (read-only)", () => {
  it("reports drift comparison as unavailable without computing any drift", async () => {
    const result = await computeConfigDrift();
    expect(result.driftItems).toHaveLength(0);
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/unavailable/i);
    expect(result.timestamp).toBeTruthy();
  });

  it("issues NO device requests — never reads categories, never loads from flash (BUG-034 regression guard)", async () => {
    await computeConfigDrift();
    // The destructive load_from_flash path and the request burst must be gone entirely.
    expect(mockGetC64API).not.toHaveBeenCalled();
    expect(mockGetCategories).not.toHaveBeenCalled();
    expect(mockGetCategory).not.toHaveBeenCalled();
    expect(mockLoadConfig).not.toHaveBeenCalled();
  });

  it("is safe to invoke repeatedly without mutating the device", async () => {
    await computeConfigDrift();
    await computeConfigDrift();
    await computeConfigDrift();
    expect(mockLoadConfig).not.toHaveBeenCalled();
  });
});
