/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const files = new Map<string, string>();
const failures = { write: false, deletePaths: new Set<string>() };

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
      if (failures.write) throw new Error("ENOSPC: no space left on device");
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
});

beforeEach(() => {
  files.clear();
  failures.write = false;
  failures.deletePaths.clear();
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
    expect(warnings[0][2]).toMatchObject({ songCount: 3, localStorageError: expect.stringContaining("quota") });
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
});
