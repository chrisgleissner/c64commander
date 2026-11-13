/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const failures = { write: false, blankWrites: false, deletePaths: new Set<string>(), writePaths: new Set<string>() };

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    stat: vi.fn(async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error("File does not exist");
      return { type: "file", size: files.get(path)!.length };
    }),
    mkdir: vi.fn(async () => undefined),
    deleteFile: vi.fn(async ({ path }: { path: string }) => {
      if (failures.deletePaths.has(path)) throw new Error("EACCES: delete denied");
      files.delete(path);
    }),
    readFile: vi.fn(async ({ path }: { path: string }) => {
      if (!files.has(path)) throw new Error("File does not exist");
      return { data: files.get(path) };
    }),
    writeFile: vi.fn(async ({ path, data }: { path: string; data: string }) => {
      if (failures.write || failures.writePaths.has(path) || (failures.blankWrites && data === ""))
        throw new Error("ENOSPC: no space left on device");
      files.set(path, data);
    }),
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

import { addLog } from "@/lib/logging";
import {
  buildHvscBrowseIndexFromEntries,
  forgetHvscBrowseIndexSnapshot,
  loadHvscBrowseIndexSnapshot,
  saveHvscBrowseIndexSnapshot,
} from "@/lib/hvsc/hvscBrowseIndexStore";

const library = (count: number, prefix = "Track") =>
  buildHvscBrowseIndexFromEntries(
    Array.from({ length: count }, (_, index) => ({
      path: `/HVSC/${prefix}_${index}.sid`,
      name: `${prefix}_${index}.sid`,
      type: "sid" as const,
    })),
  );

const quotaError = () => Object.assign(new Error("The quota has been exceeded."), { name: "QuotaExceededError" });

const failLocalStorageWrites = () =>
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw quotaError();
  });

afterEach(() => {
  vi.mocked(Storage.prototype.setItem).mockRestore?.();
  vi.mocked(Storage.prototype.removeItem).mockRestore?.();
});

beforeEach(() => {
  files.clear();
  failures.write = false;
  failures.blankWrites = false;
  failures.deletePaths.clear();
  failures.writePaths.clear();
  localStorage.clear();
  vi.mocked(addLog).mockClear();
  forgetHvscBrowseIndexSnapshot();
});

describe("HVSC browse index - persistence failures", () => {
  it("does not throw when the filesystem write fails and localStorage is full, and logs one warning with sizes", async () => {
    failures.write = true;
    failLocalStorageWrites();

    await expect(saveHvscBrowseIndexSnapshot(library(3))).resolves.toBeUndefined();

    const warnings = vi.mocked(addLog).mock.calls.filter(([level]) => level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0][2]).toMatchObject({
      songCount: 3,
      localStorageError: { errorName: "QuotaExceededError", error: expect.stringContaining("quota") },
    });
    expect(warnings[0][2]).toHaveProperty("localStorageChars");
  });

  it("serves the saved snapshot from memory when every persistence layer fails", async () => {
    failures.write = true;
    failLocalStorageWrites();

    await saveHvscBrowseIndexSnapshot(library(3, "Fresh"));

    const loaded = await loadHvscBrowseIndexSnapshot();
    expect(Object.keys(loaded?.songs ?? {})).toContain("/HVSC/Fresh_0.sid");
  });

  it("does not return a localStorage snapshot older than the failed save", async () => {
    await saveHvscBrowseIndexSnapshot(library(2, "Old"));
    localStorage.setItem("c64u_hvsc_browse_index:v1", JSON.stringify(await loadHvscBrowseIndexSnapshot()));
    files.clear();
    forgetHvscBrowseIndexSnapshot();
    failures.write = true;
    failLocalStorageWrites();

    await saveHvscBrowseIndexSnapshot(library(3, "New"));
    forgetHvscBrowseIndexSnapshot();

    const loaded = await loadHvscBrowseIndexSnapshot();
    expect(Object.keys(loaded?.songs ?? {})).not.toContain("/HVSC/Old_0.sid");
  });

  it("does not let a full snapshot whose delete failed shadow a newer compact snapshot", async () => {
    await saveHvscBrowseIndexSnapshot(library(2, "Old"));
    expect([...files.keys()].some((path) => path.endsWith("hvsc-browse-index-v1.json"))).toBe(true);
    failures.deletePaths.add("hvsc/index/hvsc-browse-index-v1.json");

    await saveHvscBrowseIndexSnapshot(library(10_001, "New"));
    forgetHvscBrowseIndexSnapshot();

    const loaded = await loadHvscBrowseIndexSnapshot();
    const paths = Object.keys(loaded?.songs ?? {});
    expect(paths).toContain("/HVSC/New_0.sid");
    expect(paths).not.toContain("/HVSC/Old_0.sid");
  });

  it("logs a contextual warning with the cause when the stale full snapshot can be neither deleted nor blanked", async () => {
    await saveHvscBrowseIndexSnapshot(library(2, "Old"));
    failures.deletePaths.add("hvsc/index/hvsc-browse-index-v1.json");
    failures.blankWrites = true;

    await expect(saveHvscBrowseIndexSnapshot(library(10_001, "New"))).resolves.toBeUndefined();

    const warning = vi
      .mocked(addLog)
      .mock.calls.find(([level, , details]) => level === "warn" && String((details as any)?.error).includes("blank"));
    expect(warning?.[2]).toMatchObject({
      error: "Failed to blank stale HVSC full snapshot at hvsc/index/hvsc-browse-index-v1.json",
    });
  });

  const FULL_PATH = "hvsc/index/hvsc-browse-index-v1.json";
  const loadInFreshSession = async () => {
    vi.resetModules();
    const fresh = await import("@/lib/hvsc/hvscBrowseIndexStore");
    return Object.keys((await fresh.loadHvscBrowseIndexSnapshot())?.songs ?? {});
  };

  it("serves the new snapshot, in this session and the next, when the stale full file can be neither deleted nor blanked", async () => {
    await saveHvscBrowseIndexSnapshot(library(2, "Old"));
    failures.deletePaths.add(FULL_PATH);
    failures.blankWrites = true;

    await saveHvscBrowseIndexSnapshot(library(10_001, "New"));

    expect(Object.keys((await loadHvscBrowseIndexSnapshot())?.songs ?? {})).toContain("/HVSC/New_0.sid");
    const nextSession = await loadInFreshSession();
    expect(nextSession).toContain("/HVSC/New_0.sid");
    expect(nextSession).not.toContain("/HVSC/Old_0.sid");
  });

  it("serves the new snapshot in the next session when the media index write fails and the old files remain", async () => {
    await saveHvscBrowseIndexSnapshot(library(2, "Old"));
    failures.writePaths.add("hvsc/index/media-index-v2.json");
    expect([...files.keys()].some((path) => path.includes("media-index-v2"))).toBe(true);

    await saveHvscBrowseIndexSnapshot(library(3, "New"));

    expect(Object.keys((await loadHvscBrowseIndexSnapshot())?.songs ?? {})).toContain("/HVSC/New_0.sid");
    const nextSession = await loadInFreshSession();
    expect(nextSession).toContain("/HVSC/New_0.sid");
    expect(nextSession).not.toContain("/HVSC/Old_0.sid");
  });

  it("prefers the filesystem again once a later save succeeds there", async () => {
    await saveHvscBrowseIndexSnapshot(library(2, "Old"));
    failures.writePaths.add("hvsc/index/media-index-v2.json");
    await saveHvscBrowseIndexSnapshot(library(3, "Mid"));
    failures.writePaths.clear();
    await saveHvscBrowseIndexSnapshot(library(4, "Last"));

    expect(await loadInFreshSession()).toContain("/HVSC/Last_0.sid");
  });

  it("keeps the stored media index when only the full snapshot hits the localStorage quota", async () => {
    failures.write = true;
    const realSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === "c64u_hvsc_browse_index:v1") throw quotaError();
      realSetItem.call(this, key, value);
    });

    await saveHvscBrowseIndexSnapshot(library(3, "New"));

    expect(localStorage.getItem("c64u_media_index:v1")).not.toBeNull();
    expect(await loadInFreshSession()).toContain("/HVSC/New_0.sid");
  });

  it("does not throw and logs when removing a localStorage key throws after a failed write", async () => {
    failures.write = true;
    failLocalStorageWrites();
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });

    await expect(saveHvscBrowseIndexSnapshot(library(3))).resolves.toBeUndefined();

    expect(
      vi.mocked(addLog).mock.calls.some(([level, message]) => level === "warn" && String(message).includes("remove")),
    ).toBe(true);
  });

  it("logs a warning with the sizes and keeps the snapshot in memory when there is no window and localStorage is full", async () => {
    vi.stubGlobal("window", undefined);
    try {
      failLocalStorageWrites();

      await expect(saveHvscBrowseIndexSnapshot(library(3))).resolves.toBeUndefined();

      expect(addLog).toHaveBeenCalledWith(
        "warn",
        "HVSC browse snapshot localStorage persistence failed; keeping it in memory only",
        expect.objectContaining({ songCount: 3, localStorageChars: expect.any(Number) }),
      );
      expect(Object.keys((await loadHvscBrowseIndexSnapshot())!.songs)).toHaveLength(3);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
