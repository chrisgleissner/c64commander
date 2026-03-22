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
});
