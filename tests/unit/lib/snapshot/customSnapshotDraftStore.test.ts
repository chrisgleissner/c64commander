/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadCustomSnapshotDrafts, saveCustomSnapshotDrafts } from "@/lib/snapshot/customSnapshotDraftStore";

const addErrorLogMock = vi.fn();

vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
}));

describe("customSnapshotDraftStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("returns one blank range when storage is empty", () => {
    expect(loadCustomSnapshotDrafts()).toEqual([{ start: "", end: "" }]);
  });

  it("loads and sanitizes persisted drafts", () => {
    localStorage.setItem(
      "c64u_custom_snapshot_ranges:v1",
      JSON.stringify([
        { start: "$0400", end: "07e7" },
        { start: "d800", end: "dbff" },
      ]),
    );

    expect(loadCustomSnapshotDrafts()).toEqual([
      { start: "0400", end: "07E7" },
      { start: "D800", end: "DBFF" },
    ]);
  });

  it("logs and falls back when storage contains invalid JSON", () => {
    localStorage.setItem("c64u_custom_snapshot_ranges:v1", "{");

    expect(loadCustomSnapshotDrafts()).toEqual([{ start: "", end: "" }]);
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Failed to parse custom snapshot drafts",
      expect.objectContaining({ error: expect.any(String) }),
    );
  });

  it("saves sanitized drafts", () => {
    saveCustomSnapshotDrafts([{ start: "$0a00", end: "0bff" }]);

    expect(JSON.parse(localStorage.getItem("c64u_custom_snapshot_ranges:v1") ?? "null")).toEqual([
      { start: "0A00", end: "0BFF" },
    ]);
  });

  it("saves defaults when passed an empty array", () => {
    saveCustomSnapshotDrafts([]);

    const stored = JSON.parse(localStorage.getItem("c64u_custom_snapshot_ranges:v1") ?? "null");
    expect(stored).toEqual([{ start: "", end: "" }]);
  });

  it("logs and falls back when storage contains non-array JSON", () => {
    localStorage.setItem("c64u_custom_snapshot_ranges:v1", JSON.stringify({ start: "0000", end: "FFFF" }));

    expect(loadCustomSnapshotDrafts()).toEqual([{ start: "", end: "" }]);
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Invalid custom snapshot draft payload",
      expect.objectContaining({ payloadType: "object" }),
    );
  });

  it("logs and falls back when all entries are invalid", () => {
    localStorage.setItem("c64u_custom_snapshot_ranges:v1", JSON.stringify([{ notStart: "x", notEnd: "y" }, 42, null]));

    expect(loadCustomSnapshotDrafts()).toEqual([{ start: "", end: "" }]);
    expect(addErrorLogMock).toHaveBeenCalledWith(
      "Custom snapshot draft payload contained no valid ranges",
      expect.objectContaining({ rangeCount: 3 }),
    );
  });
});
