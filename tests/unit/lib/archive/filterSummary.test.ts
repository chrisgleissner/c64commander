/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { describeArchiveFilters } from "@/lib/archive/filterSummary";
import type { ArchivePreset } from "@/lib/archive/types";

const presets: ArchivePreset[] = [
  { type: "category", description: "Category", values: [{ aqlKey: "apps", name: "Apps" }] },
  { type: "order", description: "Order", values: [{ aqlKey: "asc", name: "Ascending" }] },
];

describe("describeArchiveFilters", () => {
  it("names text filters and shows the preset's display name instead of its query key", () => {
    expect(describeArchiveFilters({ name: "joyride", category: "apps" }, presets)).toBe("Name joyride, Category Apps");
  });

  it("falls back to the raw value when the preset does not list it", () => {
    expect(describeArchiveFilters({ date: "2024", order: "desc" }, presets)).toBe("Date 2024, Order desc");
  });

  it("skips blank fields and returns an empty string when nothing is filled in", () => {
    expect(describeArchiveFilters({ name: "  ", group: "" }, presets)).toBe("");
  });

  it("never contains query syntax", () => {
    expect(describeArchiveFilters({ name: "joyride", category: "apps" }, presets)).not.toMatch(/[():&"]/);
  });
});
