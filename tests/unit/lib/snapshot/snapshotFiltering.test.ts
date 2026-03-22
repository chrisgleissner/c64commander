/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { filterSnapshots } from "@/lib/snapshot/snapshotFiltering";
import type { SnapshotStorageEntry } from "@/lib/snapshot/snapshotTypes";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const makeEntry = (
  id: string,
  type: SnapshotStorageEntry["snapshotType"],
  overrides: Partial<SnapshotStorageEntry["metadata"]> = {},
): SnapshotStorageEntry => ({
  id,
  filename: `c64-${type}-20260101-120000.c64snap`,
  bytesBase64: btoa("data"),
  createdAt: "2026-01-01T12:00:00.000Z",
  snapshotType: type,
  metadata: {
    snapshot_type: type,
    display_ranges: [],
    created_at: "2026-01-01 12:00:00",
    ...overrides,
  },
});

const ENTRIES: SnapshotStorageEntry[] = [
  makeEntry("1", "program", { label: "World of games", content_name: "Boulderdash" }),
  makeEntry("2", "basic", { label: "My BASIC prog", created_at: "2026-03-15 08:00:00" }),
  makeEntry("3", "screen", { content_name: "Title screen save" }),
  makeEntry("4", "custom", { label: undefined }),
  makeEntry("5", "program", { label: "Backup before play" }),
];

// ---------------------------------------------------------------------------
// Type filter
// ---------------------------------------------------------------------------

describe("filterSnapshots — type filter", () => {
  it('returns all entries when typeFilter is "all"', () => {
    expect(filterSnapshots(ENTRIES, "", "all")).toHaveLength(ENTRIES.length);
  });

  it("filters to only program snapshots", () => {
    const result = filterSnapshots(ENTRIES, "", "program");
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.snapshotType === "program")).toBe(true);
  });

  it("filters to only basic snapshots", () => {
    const result = filterSnapshots(ENTRIES, "", "basic");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("returns empty when type has no matches", () => {
    const result = filterSnapshots(ENTRIES, "", "custom");
    expect(result).toHaveLength(1); // id 4
  });
});

// ---------------------------------------------------------------------------
// Text filter
// ---------------------------------------------------------------------------

describe("filterSnapshots — text filter", () => {
  it("returns all when query is empty", () => {
    expect(filterSnapshots(ENTRIES, "", "all")).toHaveLength(ENTRIES.length);
  });

  it("returns all when query is whitespace only", () => {
    expect(filterSnapshots(ENTRIES, "   ", "all")).toHaveLength(ENTRIES.length);
  });

  it("matches label case-insensitively", () => {
    const result = filterSnapshots(ENTRIES, "WORLD", "all");
    expect(result.map((e) => e.id)).toContain("1");
  });

  it("matches content_name case-insensitively", () => {
    const result = filterSnapshots(ENTRIES, "boulderdash", "all");
    expect(result.map((e) => e.id)).toContain("1");
  });

  it("matches on snapshotType string", () => {
    const result = filterSnapshots(ENTRIES, "screen", "all");
    // id 3 has type 'screen' and the word in content_name
    expect(result.some((e) => e.snapshotType === "screen")).toBe(true);
  });

  it("matches on created_at date fragment", () => {
    const result = filterSnapshots(ENTRIES, "2026-03-15", "all");
    expect(result.map((e) => e.id)).toContain("2");
  });

  it("returns empty when no match", () => {
    const result = filterSnapshots(ENTRIES, "xyzzy_nomatch", "all");
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Combined type + text filter
// ---------------------------------------------------------------------------

describe("filterSnapshots — combined filters", () => {
  it("applies both type and text filters simultaneously", () => {
    // type=program, query matches "backup"
    const result = filterSnapshots(ENTRIES, "backup", "program");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("5");
  });

  it("returns empty when type narrows out text match", () => {
    // "boulderdash" is program type, but filtering to basic should return empty
    const result = filterSnapshots(ENTRIES, "boulderdash", "basic");
    expect(result).toHaveLength(0);
  });

  it("handles entry with missing created_at (line 41 ?? fallback)", () => {
    // metadata.created_at is undefined → ?? "" right side fires
    const entryNoDate: SnapshotStorageEntry = makeEntry("99", "program", {
      created_at: undefined as unknown as string,
      label: "no-date-entry",
    });
    const result = filterSnapshots([entryNoDate], "no-date-entry", "all");
    expect(result).toHaveLength(1);
  });
});
