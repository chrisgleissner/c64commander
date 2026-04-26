import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const tempDirs: string[] = [];
const scriptPath = path.resolve(process.cwd(), "scripts/hvsc/prepare-perf-archives.mjs");

const createTempRoot = () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "prepare-perf-archives-"));
  tempDirs.push(root);
  return root;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop() ?? "", { recursive: true, force: true });
  }
});

describe("prepare-perf-archives", () => {
  it("downloads both archives, writes metadata, and exports the resolved env contract", () => {
    const root = createTempRoot();
    const cacheDir = path.join(root, "hvsc-cache");
    const envFile = path.join(root, "perf.env");
    const outFile = path.join(root, "archive-preparation.json");
    const baselinePayload = Buffer.from("baseline-archive").toString("base64");
    const updatePayload = Buffer.from("update-archive").toString("base64");

    execFileSync("node", [scriptPath, `--out=${outFile}`, `--write-env=${envFile}`], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: path.join(root, "home"),
        HVSC_ARCHIVE_PATH: path.join(cacheDir, "HVSC_84-all-of-them.7z"),
        HVSC_UPDATE_84_CACHE: cacheDir,
        HVSC_PERF_BASELINE_ARCHIVE_URL: `data:application/octet-stream;base64,${baselinePayload}`,
        HVSC_PERF_UPDATE_ARCHIVE_URL: `data:application/octet-stream;base64,${updatePayload}`,
      },
    });

    const metadata = JSON.parse(readFileSync(outFile, "utf8"));
    const exportedEnv = readFileSync(envFile, "utf8");

    expect(metadata.downloaded).toBe(true);
    expect(metadata.archives.baseline.sizeBytes).toBeGreaterThan(0);
    expect(metadata.archives.update.sizeBytes).toBeGreaterThan(0);
    expect(metadata.archives.baseline.sha256).toHaveLength(64);
    expect(metadata.archives.update.sha256).toHaveLength(64);
    expect(existsSync(metadata.archives.baseline.path)).toBe(true);
    expect(existsSync(metadata.archives.update.path)).toBe(true);
    expect(exportedEnv).toContain(`HVSC_PERF_BASELINE_ARCHIVE=${metadata.archives.baseline.path}`);
    expect(exportedEnv).toContain(`HVSC_PERF_UPDATE_ARCHIVE=${metadata.archives.update.path}`);
    expect(exportedEnv).toContain(`HVSC_UPDATE_84_CACHE=${cacheDir}`);
  });

  it("reuses persisted archive hashes on cache-hit runs", () => {
    const root = createTempRoot();
    const cacheDir = path.join(root, "hvsc-cache");
    const outFile = path.join(root, "archive-preparation.json");
    const baselinePayload = Buffer.from("baseline-archive").toString("base64");
    const updatePayload = Buffer.from("update-archive").toString("base64");

    const baseEnv = {
      ...process.env,
      HOME: path.join(root, "home"),
      HVSC_ARCHIVE_PATH: path.join(cacheDir, "HVSC_84-all-of-them.7z"),
      HVSC_UPDATE_84_CACHE: cacheDir,
    };

    execFileSync("node", [scriptPath, `--out=${outFile}`], {
      encoding: "utf8",
      env: {
        ...baseEnv,
        HVSC_PERF_BASELINE_ARCHIVE_URL: `data:application/octet-stream;base64,${baselinePayload}`,
        HVSC_PERF_UPDATE_ARCHIVE_URL: `data:application/octet-stream;base64,${updatePayload}`,
      },
    });

    const firstMetadata = JSON.parse(readFileSync(outFile, "utf8"));
    const baselineHashPath = `${firstMetadata.archives.baseline.path}.sha256`;
    const updateHashPath = `${firstMetadata.archives.update.path}.sha256`;

    writeFileSync(baselineHashPath, `${"a".repeat(64)}\n`, "utf8");
    writeFileSync(updateHashPath, `${"b".repeat(64)}\n`, "utf8");

    execFileSync("node", [scriptPath, `--out=${outFile}`], {
      encoding: "utf8",
      env: baseEnv,
    });

    const secondMetadata = JSON.parse(readFileSync(outFile, "utf8"));

    expect(secondMetadata.downloaded).toBe(false);
    expect(secondMetadata.archives.baseline.sha256).toBe("a".repeat(64));
    expect(secondMetadata.archives.update.sha256).toBe("b".repeat(64));
  });
});
