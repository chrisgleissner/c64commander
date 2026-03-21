/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { buildSnapshotFileName, formatDisplayTimestamp, formatFileTimestamp } from "@/lib/snapshot/snapshotFilename";

// Use a fixed date at a known local time
// 2026-03-08 14:05:09 UTC (for deterministic output regardless of timezone
// we construct via Date.UTC then extract local components in the functions)
const LOCAL_DATE = new Date(2026, 2, 8, 14, 5, 9); // local time

describe("formatDisplayTimestamp", () => {
  it("formats as YYYY-MM-DD HH:MM:SS", () => {
    const result = formatDisplayTimestamp(LOCAL_DATE);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("produces correct values for all fields", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5); // Jan 2, 03:04:05
    expect(formatDisplayTimestamp(d)).toBe("2026-01-02 03:04:05");
  });

  it("pads single-digit month, day, hour, minute, second", () => {
    const d = new Date(2026, 0, 1, 1, 1, 1);
    const result = formatDisplayTimestamp(d);
    expect(result).toMatch(/-01-01 01:01:01$/);
  });
});

describe("formatFileTimestamp", () => {
  it("formats as YYYYMMDD-HHMMSS", () => {
    const result = formatFileTimestamp(LOCAL_DATE);
    expect(result).toMatch(/^\d{8}-\d{6}$/);
  });

  it("produces correct compact values", () => {
    const d = new Date(2026, 0, 2, 3, 4, 5);
    expect(formatFileTimestamp(d)).toBe("20260102-030405");
  });
});

describe("buildSnapshotFileName", () => {
  it("includes type prefix for known types", () => {
    const fn = buildSnapshotFileName("program", LOCAL_DATE);
    expect(fn).toMatch(/^c64-program-\d{8}-\d{6}\.c64snap$/);
  });

  it("uses correct prefix for each type", () => {
    const pairs: Array<["program" | "basic" | "screen" | "custom", string]> = [
      ["program", "program"],
      ["basic", "basic"],
      ["screen", "screen"],
      ["custom", "custom"],
    ];
    for (const [type, prefix] of pairs) {
      expect(buildSnapshotFileName(type, LOCAL_DATE)).toContain(`c64-${prefix}-`);
    }
  });

  it("ends with .c64snap extension", () => {
    expect(buildSnapshotFileName("screen", LOCAL_DATE)).toMatch(/\.c64snap$/);
  });

  it("uses current date when none provided", () => {
    const before = Date.now();
    const name = buildSnapshotFileName("program");
    const after = Date.now();
    // The filename contains a year — just check it's in a reasonable range
    const year = new Date(before).getFullYear();
    expect(name).toContain(String(year));
    expect(after).toBeGreaterThanOrEqual(before);
  });

  it('uses "custom" prefix for unknown snapshot type (line 47 ?? fallback)', () => {
    // config?.filePrefix is undefined for unknown types → ?? "custom" right side fires
    const name = buildSnapshotFileName("unknown-type" as Parameters<typeof buildSnapshotFileName>[0], LOCAL_DATE);
    expect(name).toContain("c64-custom-");
  });
});
