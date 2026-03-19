/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { clearRecentTargets, getRecentTargets, recordRecentTarget } from "@/lib/diagnostics/recentTargets";

// Minimal sessionStorage stub
const store: Record<string, string> = {};
const sessionStorageStub = {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => {
    store[key] = value;
  },
  removeItem: (key: string) => {
    delete store[key];
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k];
  },
};

Object.defineProperty(globalThis, "sessionStorage", {
  value: sessionStorageStub,
  writable: true,
});

beforeEach(() => {
  sessionStorageStub.clear();
});

describe("recordRecentTarget", () => {
  it("stores a single host", () => {
    recordRecentTarget("c64u.local");
    const targets = getRecentTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].host).toBe("c64u.local");
  });

  it("stores optional modelLabel", () => {
    recordRecentTarget("c64u.local", "U64E2");
    expect(getRecentTargets()[0].modelLabel).toBe("U64E2");
  });

  it("prepends newer entries (newest first)", () => {
    recordRecentTarget("host-a");
    recordRecentTarget("host-b");
    const targets = getRecentTargets();
    expect(targets[0].host).toBe("host-b");
    expect(targets[1].host).toBe("host-a");
  });

  it("caps at 3 entries", () => {
    recordRecentTarget("host-a");
    recordRecentTarget("host-b");
    recordRecentTarget("host-c");
    recordRecentTarget("host-d");
    const targets = getRecentTargets();
    expect(targets).toHaveLength(3);
    expect(targets[0].host).toBe("host-d");
    expect(targets[2].host).toBe("host-b");
  });

  it("deduplicates by host (moves to front)", () => {
    recordRecentTarget("host-a");
    recordRecentTarget("host-b");
    recordRecentTarget("host-a"); // should move host-a to front
    const targets = getRecentTargets();
    expect(targets).toHaveLength(2);
    expect(targets[0].host).toBe("host-a");
    expect(targets[1].host).toBe("host-b");
  });

  it("updates modelLabel when re-recording same host", () => {
    recordRecentTarget("c64u.local", "U64");
    recordRecentTarget("c64u.local", "U64E2");
    const targets = getRecentTargets();
    expect(targets[0].modelLabel).toBe("U64E2");
  });
});

describe("clearRecentTargets", () => {
  it("removes all stored targets", () => {
    recordRecentTarget("host-a");
    clearRecentTargets();
    expect(getRecentTargets()).toHaveLength(0);
  });
});

describe("getRecentTargets", () => {
  it("returns empty array when no targets stored", () => {
    expect(getRecentTargets()).toEqual([]);
  });

  it("filters out entries missing host", () => {
    // Corrupt storage manually
    sessionStorageStub.setItem("c64u_recent_switch_targets", JSON.stringify([{ host: "" }, { host: "valid.host" }]));
    const targets = getRecentTargets();
    expect(targets).toHaveLength(1);
    expect(targets[0].host).toBe("valid.host");
  });

  it("returns empty array when storage contains non-array JSON", () => {
    sessionStorageStub.setItem("c64u_recent_switch_targets", '"not-an-array"');
    expect(getRecentTargets()).toEqual([]);
  });

  it("returns empty array when storage is corrupted JSON", () => {
    sessionStorageStub.setItem("c64u_recent_switch_targets", "{bad json}");
    expect(getRecentTargets()).toEqual([]);
  });
});

describe("write resilience", () => {
  it("silently handles setItem throwing (storage quota exceeded or unavailable)", () => {
    const originalSetItem = sessionStorageStub.setItem;
    sessionStorageStub.setItem = () => {
      throw new Error("QuotaExceededError");
    };
    // Should not throw even if setItem fails
    expect(() => recordRecentTarget("host-a")).not.toThrow();
    // Restore stub
    sessionStorageStub.setItem = originalSetItem;
  });
});
