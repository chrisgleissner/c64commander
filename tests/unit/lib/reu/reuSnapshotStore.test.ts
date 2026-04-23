/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { buildLocalStorageKey } from "@/generated/variant";
import {
  clearReuSnapshotStore,
  deleteReuSnapshotFromStore,
  loadReuSnapshotStore,
  saveReuSnapshotToStore,
  updateReuSnapshotLabel,
  useReuSnapshotStore,
} from "@/lib/reu/reuSnapshotStore";
import type { ReuSnapshotStorageEntry } from "@/lib/reu/reuSnapshotTypes";

const addErrorLogMock = vi.fn();
vi.mock("@/lib/logging", () => ({
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
  addLog: vi.fn(),
}));

const STORE_KEY = buildLocalStorageKey("reu_snapshots:v1");

const makeEntry = (overrides: Partial<ReuSnapshotStorageEntry> = {}): ReuSnapshotStorageEntry => ({
  id: "entry-1",
  filename: "snapshot.reu",
  createdAt: "2026-01-01T00:00:00.000Z",
  snapshotType: "reu",
  sizeBytes: 1024,
  remoteFileName: "snapshot.reu",
  storage: { kind: "native-data", path: "/data/snapshot.reu" },
  metadata: { snapshot_type: "reu", display_ranges: ["0000-FFFF"], created_at: "2026-01-01T00:00:00.000Z" },
  ...overrides,
});

describe("reuSnapshotStore", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe("loadReuSnapshotStore", () => {
    it("returns empty array when storage is empty", () => {
      expect(loadReuSnapshotStore()).toEqual([]);
    });

    it("returns stored entries sorted newest-first by createdAt", () => {
      const older = makeEntry({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" });
      const newer = makeEntry({ id: "new", createdAt: "2026-06-01T00:00:00.000Z" });
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, snapshots: [older, newer] }));
      const result = loadReuSnapshotStore();
      expect(result[0].id).toBe("new");
      expect(result[1].id).toBe("old");
    });

    it("returns empty array when JSON is invalid", () => {
      localStorage.setItem(STORE_KEY, "{bad json");
      expect(loadReuSnapshotStore()).toEqual([]);
      expect(addErrorLogMock).toHaveBeenCalledWith("Failed to parse REU snapshot store", expect.anything());
    });

    it("returns empty array when stored object is not version 1", () => {
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 2, snapshots: [makeEntry()] }));
      expect(loadReuSnapshotStore()).toEqual([]);
    });

    it("filters out entries missing required fields", () => {
      const valid = makeEntry({ id: "valid" });
      const invalid = { id: "x", filename: 123, createdAt: "bad", snapshotType: "reu", sizeBytes: 0 };
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, snapshots: [valid, invalid] }));
      const result = loadReuSnapshotStore();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("valid");
    });

    it("filters entries where snapshotType is not reu", () => {
      const entry = makeEntry({ snapshotType: "not-reu" as "reu" });
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, snapshots: [entry] }));
      expect(loadReuSnapshotStore()).toHaveLength(0);
    });

    it("filters entries where storage is null", () => {
      const entry = { ...makeEntry(), storage: null };
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, snapshots: [entry] }));
      expect(loadReuSnapshotStore()).toHaveLength(0);
    });

    it("filters entries where metadata is null", () => {
      const entry = { ...makeEntry(), metadata: null };
      localStorage.setItem(STORE_KEY, JSON.stringify({ version: 1, snapshots: [entry] }));
      expect(loadReuSnapshotStore()).toHaveLength(0);
    });
  });

  describe("saveReuSnapshotToStore", () => {
    it("persists a new entry to localStorage", () => {
      const entry = makeEntry();
      saveReuSnapshotToStore(entry);
      const result = loadReuSnapshotStore();
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("entry-1");
    });

    it("replaces an existing entry with the same id", () => {
      const original = makeEntry({ sizeBytes: 100 });
      saveReuSnapshotToStore(original);
      const updated = makeEntry({ sizeBytes: 9999 });
      saveReuSnapshotToStore(updated);
      const result = loadReuSnapshotStore();
      expect(result).toHaveLength(1);
      expect(result[0].sizeBytes).toBe(9999);
    });

    it("dispatches an update event after save", () => {
      const listener = vi.fn();
      window.addEventListener("c64u-reu-snapshots-updated", listener);
      saveReuSnapshotToStore(makeEntry());
      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener("c64u-reu-snapshots-updated", listener);
    });

    it("prepends new entry so newest id appears first", () => {
      const first = makeEntry({ id: "a", createdAt: "2026-01-01T00:00:00.000Z" });
      const second = makeEntry({ id: "b", createdAt: "2026-02-01T00:00:00.000Z" });
      saveReuSnapshotToStore(first);
      saveReuSnapshotToStore(second);
      const result = loadReuSnapshotStore();
      expect(result[0].id).toBe("b");
    });
  });

  describe("updateReuSnapshotLabel", () => {
    it("updates label in metadata for matching snapshot", () => {
      saveReuSnapshotToStore(makeEntry({ id: "snap-1" }));
      updateReuSnapshotLabel("snap-1", "My Label");
      const result = loadReuSnapshotStore();
      expect(result[0].metadata.label).toBe("My Label");
    });

    it("trims and removes empty label", () => {
      saveReuSnapshotToStore(makeEntry({ id: "snap-1" }));
      updateReuSnapshotLabel("snap-1", "   ");
      const result = loadReuSnapshotStore();
      expect(result[0].metadata.label).toBeUndefined();
    });

    it("does nothing if id does not exist", () => {
      saveReuSnapshotToStore(makeEntry({ id: "real" }));
      updateReuSnapshotLabel("nonexistent", "X");
      const result = loadReuSnapshotStore();
      expect(result[0].metadata.label).toBeUndefined();
    });

    it("dispatches an update event after label change", () => {
      saveReuSnapshotToStore(makeEntry({ id: "a" }));
      const listener = vi.fn();
      window.addEventListener("c64u-reu-snapshots-updated", listener);
      updateReuSnapshotLabel("a", "new name");
      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener("c64u-reu-snapshots-updated", listener);
    });
  });

  describe("deleteReuSnapshotFromStore", () => {
    it("removes entry by id", () => {
      saveReuSnapshotToStore(makeEntry({ id: "delete-me" }));
      deleteReuSnapshotFromStore("delete-me");
      expect(loadReuSnapshotStore()).toHaveLength(0);
    });

    it("does nothing if id not found", () => {
      saveReuSnapshotToStore(makeEntry({ id: "keep-me" }));
      deleteReuSnapshotFromStore("nonexistent");
      expect(loadReuSnapshotStore()).toHaveLength(1);
    });

    it("dispatches an update event after deletion", () => {
      saveReuSnapshotToStore(makeEntry({ id: "to-delete" }));
      const listener = vi.fn();
      window.addEventListener("c64u-reu-snapshots-updated", listener);
      deleteReuSnapshotFromStore("to-delete");
      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener("c64u-reu-snapshots-updated", listener);
    });
  });

  describe("clearReuSnapshotStore", () => {
    it("removes all entries from localStorage", () => {
      saveReuSnapshotToStore(makeEntry({ id: "a" }));
      saveReuSnapshotToStore(makeEntry({ id: "b" }));
      clearReuSnapshotStore();
      expect(localStorage.getItem(STORE_KEY)).toBeNull();
    });

    it("dispatches an update event with empty array", () => {
      const listener = vi.fn();
      window.addEventListener("c64u-reu-snapshots-updated", listener);
      clearReuSnapshotStore();
      expect(listener).toHaveBeenCalledTimes(1);
      const detail = (listener.mock.calls[0]?.[0] as CustomEvent).detail;
      expect(detail).toEqual([]);
      window.removeEventListener("c64u-reu-snapshots-updated", listener);
    });

    it("is safe to call on empty store", () => {
      expect(() => clearReuSnapshotStore()).not.toThrow();
    });
  });

  describe("useReuSnapshotStore", () => {
    it("returns initial snapshots from localStorage", () => {
      saveReuSnapshotToStore(makeEntry({ id: "initial" }));
      const { result } = renderHook(() => useReuSnapshotStore());
      expect(result.current.snapshots).toHaveLength(1);
      expect(result.current.snapshots[0].id).toBe("initial");
    });

    it("updates snapshots when update event is dispatched", () => {
      const { result } = renderHook(() => useReuSnapshotStore());
      expect(result.current.snapshots).toHaveLength(0);
      act(() => {
        saveReuSnapshotToStore(makeEntry({ id: "new-one" }));
      });
      expect(result.current.snapshots).toHaveLength(1);
      expect(result.current.snapshots[0].id).toBe("new-one");
    });

    it("removes event listener on unmount", () => {
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener");
      const { unmount } = renderHook(() => useReuSnapshotStore());
      unmount();
      expect(removeEventListenerSpy).toHaveBeenCalledWith("c64u-reu-snapshots-updated", expect.any(Function));
      removeEventListenerSpy.mockRestore();
    });
  });
});
