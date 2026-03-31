/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSnapshotStore,
  deleteSnapshotFromStore,
  loadSnapshotStore,
  saveSnapshotToStore,
  snapshotEntryToBytes,
  updateSnapshotLabel,
} from "@/lib/snapshot/snapshotStore";
import type { SnapshotMetadata } from "@/lib/snapshot/snapshotTypes";
import { encodeSnapshot } from "@/lib/snapshot/snapshotFormat";

// ---------------------------------------------------------------------------
// localStorage stub
// ---------------------------------------------------------------------------

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
});

// Suppress real DOM events in unit tests
vi.spyOn(globalThis as unknown as Window, "dispatchEvent").mockImplementation(() => true);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const BASE_META: SnapshotMetadata = {
  snapshot_type: "program",
  display_ranges: ["$0000–$00FF", "$0200–$FFFF"],
  created_at: "2026-01-10 09:00:00",
};

const makeBytes = () =>
  encodeSnapshot("program", new Date(2026, 0, 10, 9, 0, 0), [{ start: 0, length: 4 }], [new Uint8Array([1, 2, 3, 4])]);

const makeEntry = (id: string, createdAt = "2026-01-10T09:00:00.000Z") => ({
  id,
  filename: `c64-program-20260110-090000.c64snap`,
  bytes: makeBytes(),
  createdAt,
  snapshotType: "program" as const,
  metadata: { ...BASE_META, created_at: "2026-01-10 09:00:00" },
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  localStorageMock.clear();
});

describe("loadSnapshotStore", () => {
  it("returns empty array when nothing is stored", () => {
    expect(loadSnapshotStore()).toEqual([]);
  });

  it("returns persisted snapshots", () => {
    saveSnapshotToStore(makeEntry("a"));
    expect(loadSnapshotStore()).toHaveLength(1);
  });

  it("returns snapshots newest first", () => {
    saveSnapshotToStore(makeEntry("old", "2026-01-01T00:00:00.000Z"));
    saveSnapshotToStore(makeEntry("new", "2026-06-01T00:00:00.000Z"));
    const loaded = loadSnapshotStore();
    expect(loaded[0].id).toBe("new");
    expect(loaded[1].id).toBe("old");
  });

  it("ignores invalid JSON gracefully", () => {
    localStorageMock.setItem("c64u_snapshots:v1", "{invalid json}");
    expect(loadSnapshotStore()).toEqual([]);
  });

  it("ignores records with wrong schema version", () => {
    localStorageMock.setItem("c64u_snapshots:v1", JSON.stringify({ version: 99, snapshots: [] }));
    expect(loadSnapshotStore()).toEqual([]);
  });

  it("skips entries that fail isValidEntry check", () => {
    const store = { version: 1, snapshots: [{ id: "bad" }] };
    localStorageMock.setItem("c64u_snapshots:v1", JSON.stringify(store));
    expect(loadSnapshotStore()).toHaveLength(0);
  });

  it("filters out null and non-object entries (isValidEntry null/primitive path)", () => {
    const store = { version: 1, snapshots: [null, "bad", 42] };
    localStorageMock.setItem("c64u_snapshots:v1", JSON.stringify(store));
    expect(loadSnapshotStore()).toHaveLength(0);
  });

  it("defaults to empty array when snapshots field is absent (?? [] fallback)", () => {
    localStorageMock.setItem("c64u_snapshots:v1", JSON.stringify({ version: 1 }));
    expect(loadSnapshotStore()).toHaveLength(0);
  });
});

describe("saveSnapshotToStore", () => {
  it("persists a new snapshot entry", () => {
    saveSnapshotToStore(makeEntry("x"));
    const loaded = loadSnapshotStore();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe("x");
  });

  it("stores bytes as base64", () => {
    saveSnapshotToStore(makeEntry("x"));
    const loaded = loadSnapshotStore();
    expect(typeof loaded[0].bytesBase64).toBe("string");
    expect(loaded[0].bytesBase64.length).toBeGreaterThan(0);
  });

  it("drops oldest entry when MAX_SNAPSHOTS is exceeded", () => {
    // Save 101 entries; the 101st should evict the oldest
    for (let i = 0; i < 101; i++) {
      saveSnapshotToStore(makeEntry(`id${i}`, `2026-01-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`));
    }
    const loaded = loadSnapshotStore();
    expect(loaded).toHaveLength(100);
  });
});

describe("deleteSnapshotFromStore", () => {
  it("removes the matching entry", () => {
    saveSnapshotToStore(makeEntry("a"));
    saveSnapshotToStore(makeEntry("b"));
    deleteSnapshotFromStore("a");
    const ids = loadSnapshotStore().map((e) => e.id);
    expect(ids).not.toContain("a");
    expect(ids).toContain("b");
  });

  it("is a no-op when id not found", () => {
    saveSnapshotToStore(makeEntry("a"));
    deleteSnapshotFromStore("nonexistent");
    expect(loadSnapshotStore()).toHaveLength(1);
  });
});

describe("updateSnapshotLabel", () => {
  it("updates label of matched entry", () => {
    saveSnapshotToStore(makeEntry("a"));
    updateSnapshotLabel("a", "New label");
    const loaded = loadSnapshotStore();
    expect(loaded[0].metadata.label).toBe("New label");
  });

  it("trims and removes label when empty string given", () => {
    saveSnapshotToStore({ ...makeEntry("a"), metadata: { ...BASE_META, label: "Old" } });
    updateSnapshotLabel("a", "   ");
    const loaded = loadSnapshotStore();
    expect(loaded[0].metadata.label).toBeUndefined();
  });

  it("is a no-op when id not found", () => {
    saveSnapshotToStore(makeEntry("a"));
    updateSnapshotLabel("missing", "Test");
    expect(loadSnapshotStore()[0].metadata.label).toBeUndefined();
  });
});

describe("clearSnapshotStore", () => {
  it("removes all entries", () => {
    saveSnapshotToStore(makeEntry("a"));
    saveSnapshotToStore(makeEntry("b"));
    clearSnapshotStore();
    expect(loadSnapshotStore()).toHaveLength(0);
  });
});

describe("snapshotEntryToBytes", () => {
  it("converts base64 back to the original bytes", () => {
    const original = makeBytes();
    saveSnapshotToStore(makeEntry("a"));
    const stored = loadSnapshotStore()[0];
    const restored = snapshotEntryToBytes(stored);
    expect(restored).toEqual(original);
  });
});

describe("writeSnapshotStore error handling", () => {
  it("throws and logs when localStorage.setItem fails", () => {
    const setItemSpy = vi.spyOn(localStorageMock, "setItem").mockImplementationOnce(() => {
      throw new DOMException("QuotaExceededError");
    });

    expect(() => saveSnapshotToStore(makeEntry("quota-err"))).toThrow("Failed to save snapshot:");
    setItemSpy.mockRestore();
  });
});
