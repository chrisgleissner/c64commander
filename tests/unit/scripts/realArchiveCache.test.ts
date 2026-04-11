import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { ensureRealArchivePair } from "../../../scripts/hvsc/realArchiveCache.mjs";

const tempDirs = [];

const createTempRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "real-archive-cache-"));
  tempDirs.push(root);
  return root;
};

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("realArchiveCache", () => {
  it("downloads both archives into the explicit cache dir when real-archive mode starts cold", async () => {
    const root = createTempRoot();
    const cacheDir = path.join(root, "hvsc-cache");
    const homeCacheDir = path.join(root, "home-cache");
    const downloadArchive = vi.fn(async (url: string, targetPath: string) => {
      writeFileSync(targetPath, `downloaded:${url}`);
    });

    const result = await ensureRealArchivePair({
      env: {
        HVSC_ARCHIVE_PATH: path.join(cacheDir, "HVSC_84-all-of-them.7z"),
        HVSC_UPDATE_84_CACHE: cacheDir,
        HVSC_PERF_BASELINE_ARCHIVE_URL: "https://example.test/HVSC_84-all-of-them.7z",
        HVSC_PERF_UPDATE_ARCHIVE_URL: "https://example.test/HVSC_Update_84.7z",
      },
      homeCacheDir,
      downloadArchive,
    });

    expect(downloadArchive).toHaveBeenCalledTimes(2);
    expect(result.downloaded).toBe(true);
    expect(result.baselineArchive).toBe(path.join(cacheDir, "HVSC_84-all-of-them.7z"));
    expect(result.updateArchive).toBe(path.join(cacheDir, "HVSC_Update_84.7z"));
    expect(existsSync(result.baselineArchive)).toBe(true);
    expect(existsSync(result.updateArchive)).toBe(true);
    expect(readFileSync(result.baselineArchive, "utf8")).toContain("HVSC_84-all-of-them.7z");
    expect(readFileSync(result.updateArchive, "utf8")).toContain("HVSC_Update_84.7z");
  });

  it("reuses existing archives without downloading when both are already present", async () => {
    const root = createTempRoot();
    const cacheDir = path.join(root, "hvsc-cache");
    const homeCacheDir = path.join(root, "home-cache");
    const baselineArchive = path.join(cacheDir, "HVSC_84-all-of-them.7z");
    const updateArchive = path.join(cacheDir, "HVSC_Update_84.7z");

    rmSync(cacheDir, { recursive: true, force: true });
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(baselineArchive, "baseline", { flag: "w" });
    writeFileSync(updateArchive, "update", { flag: "w" });

    const downloadArchive = vi.fn();

    const result = await ensureRealArchivePair({
      env: {
        HVSC_ARCHIVE_PATH: baselineArchive,
        HVSC_UPDATE_84_CACHE: cacheDir,
      },
      homeCacheDir,
      downloadArchive,
    });

    expect(downloadArchive).not.toHaveBeenCalled();
    expect(result.downloaded).toBe(false);
    expect(result.baselineArchive).toBe(baselineArchive);
    expect(result.updateArchive).toBe(updateArchive);
  });
});
