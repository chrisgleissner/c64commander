/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

import { addLog } from "@/lib/logging";
import {
  clearFilesystemSnapshotStale,
  isFilesystemSnapshotStale,
  markFilesystemSnapshotStale,
} from "@/lib/hvsc/hvscBrowseIndexFallbackMarker";

describe("the filesystem snapshot stale marker", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.mocked(addLog).mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is set by marking and cleared by clearing", () => {
    expect(isFilesystemSnapshotStale()).toBe(false);
    markFilesystemSnapshotStale();
    expect(isFilesystemSnapshotStale()).toBe(true);
    clearFilesystemSnapshotStale();
    expect(isFilesystemSnapshotStale()).toBe(false);
  });

  it("reports not stale and logs a warning with the stack when localStorage cannot be read", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage disabled");
    });

    expect(isFilesystemSnapshotStale()).toBe(false);
    expect(addLog).toHaveBeenCalledWith(
      "warn",
      "Failed to read HVSC browse index fallback marker",
      expect.objectContaining({ error: "storage disabled", stack: expect.any(String) }),
    );
  });

  it("reports not stale when there is no localStorage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(isFilesystemSnapshotStale()).toBe(false);
  });

  it("clears nothing and does not throw when there is no localStorage", () => {
    vi.stubGlobal("localStorage", undefined);
    expect(() => clearFilesystemSnapshotStale()).not.toThrow();
    expect(addLog).not.toHaveBeenCalled();
  });
});
