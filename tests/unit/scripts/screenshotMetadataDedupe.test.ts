import { execFileSync } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import {
  SCREENSHOT_DIFF_CONFIG,
  compareScreenshotBuffers,
  decideMetadataScreenshotAction,
  decideTrackedScreenshotAction,
  parseGitLsTreeBlobCatalog,
  pruneRedundantScreenshots,
} from "../../../scripts/screenshotMetadataDedupe.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs.splice(0).map(async (directory) => {
      await rm(directory, { force: true, recursive: true });
    }),
  );
});

const createTextScreenshot = async (text: string) => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="280" height="96">
      <rect width="100%" height="100%" fill="#ffffff" />
      <text x="24" y="62" font-size="28" font-family="Arial, sans-serif" fill="#111111">${text}</text>
    </svg>
  `;
  return sharp(Buffer.from(svg)).png().toBuffer();
};

const reencodePng = async (pngBuffer: Buffer, compressionLevel: number) =>
  sharp(pngBuffer)
    .png({
      adaptiveFiltering: compressionLevel <= 3,
      compressionLevel,
    })
    .toBuffer();

const addSinglePixelNoise = async (pngBuffer: Buffer) => {
  const { data, info } = await sharp(pngBuffer).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const next = Buffer.from(data);
  next[0] = Math.max(0, next[0] - 1);
  return sharp(next, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels,
    },
  })
    .png()
    .toBuffer();
};

const createTempRepo = async () => {
  const workdir = await mkdtemp(path.join(tmpdir(), "c64commander-screenshot-dedupe-"));
  tempDirs.push(workdir);
  execFileSync("git", ["init", "-b", "main"], { cwd: workdir });
  execFileSync("git", ["config", "user.name", "Codex Test"], { cwd: workdir });
  execFileSync("git", ["config", "user.email", "codex@example.com"], { cwd: workdir });
  return workdir;
};

const commitRepoFile = async (workdir: string, repoPath: string, pngBuffer: Buffer) => {
  const filePath = path.join(workdir, repoPath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, pngBuffer);
  execFileSync("git", ["add", repoPath], { cwd: workdir });
  execFileSync("git", ["commit", "-m", `Add ${repoPath}`], { cwd: workdir });
};

describe("parseGitLsTreeBlobCatalog", () => {
  it("maps tracked paths and blob ids from git ls-tree output", () => {
    const catalog = parseGitLsTreeBlobCatalog(
      [
        "100644 blob aaa111\tdoc/img/app/home/00-overview-light.png",
        "100644 blob bbb222\tdoc/img/app/home/01-overview-dark.png",
        "100644 blob aaa111\tdoc/img/app/home/profiles/medium/01-overview.png",
      ].join("\n"),
    );

    expect(catalog.pathBlobIds.get("doc/img/app/home/00-overview-light.png")).toBe("aaa111");
    expect(catalog.pathBlobIds.get("doc/img/app/home/01-overview-dark.png")).toBe("bbb222");
    expect(catalog.blobIdsToPaths.get("aaa111")).toEqual([
      "doc/img/app/home/00-overview-light.png",
      "doc/img/app/home/profiles/medium/01-overview.png",
    ]);
    expect(catalog.trackedPaths.has("doc/img/app/home/01-overview-dark.png")).toBe(true);
  });
});

describe("compareScreenshotBuffers", () => {
  it("treats identical pixels with different PNG bytes as identical", async () => {
    const baseline = await createTextScreenshot("C64 COMMANDER");
    const recompressed = await reencodePng(baseline, 1);

    const comparison = await compareScreenshotBuffers(baseline, recompressed);

    expect(Buffer.compare(baseline, recompressed)).not.toBe(0);
    expect(comparison.status).toBe("identical");
    expect(comparison.diffPixels).toBe(0);
  });

  it("treats bounded one-pixel rendering noise as unchanged", async () => {
    const baseline = await createTextScreenshot("LOAD RAM");
    const noisy = await addSinglePixelNoise(baseline);

    const comparison = await compareScreenshotBuffers(baseline, noisy);

    expect(["anti-aliased-equivalent", "within-noise-budget"]).toContain(comparison.status);
    expect(comparison.diffPixels).toBeGreaterThanOrEqual(0);
  });

  it("preserves a small real text change", async () => {
    const baseline = await createTextScreenshot("LOAD RAM");
    const changed = await createTextScreenshot("LOAD ROM");

    const comparison = await compareScreenshotBuffers(baseline, changed);

    expect(comparison.status).toBe("different");
    expect(comparison.diffPixels).toBeGreaterThan(8);
  });

  it("treats up to eight diff pixels as noise even when the diff ratio is higher on small screenshots", async () => {
    const width = 20;
    const height = 20;
    const baseline = await sharp({
      create: {
        width,
        height,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const { data, info } = await sharp(baseline).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const noisy = Buffer.from(data);

    for (let pixelIndex = 0; pixelIndex < 8; pixelIndex += 1) {
      noisy[pixelIndex * info.channels] = 0;
    }

    const candidate = await sharp(noisy, {
      raw: {
        width: info.width,
        height: info.height,
        channels: info.channels,
      },
    })
      .png()
      .toBuffer();

    const comparison = await compareScreenshotBuffers(baseline, candidate, SCREENSHOT_DIFF_CONFIG);

    expect(comparison.diffPixels).toBe(8);
    expect(comparison.diffRatio).toBeGreaterThan(SCREENSHOT_DIFF_CONFIG.maxDiffRatio);
    expect(comparison.status).toBe("within-noise-budget");
  });

  it("reports different-size when screenshot dimensions change", async () => {
    const baseline = await sharp({
      create: {
        width: 20,
        height: 20,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const resized = await sharp({
      create: {
        width: 24,
        height: 20,
        channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .png()
      .toBuffer();

    const comparison = await compareScreenshotBuffers(baseline, resized);

    expect(comparison.status).toBe("different-size");
    expect(comparison.diffPixels).toBeNull();
    expect(comparison.diffRatio).toBeNull();
  });
});

describe("decideTrackedScreenshotAction", () => {
  it("keeps the screenshot when no HEAD buffer is available", async () => {
    const current = await createTextScreenshot("LOAD RAM");

    const decision = await decideTrackedScreenshotAction({
      currentPngBuffer: current,
      headPngBuffer: null,
    });

    expect(decision).toEqual({
      action: "keep",
      comparison: null,
    });
  });

  it("restores byte-identical tracked screenshots immediately", async () => {
    const baseline = await createTextScreenshot("LOAD RAM");

    const decision = await decideTrackedScreenshotAction({
      currentPngBuffer: baseline,
      headPngBuffer: baseline,
    });

    expect(decision.action).toBe("restore-head");
    expect(decision.comparison?.status).toBe("identical");
  });

  it("restores near-identical tracked screenshots when fuzzy restore is enabled", async () => {
    const baseline = await createTextScreenshot("LOAD RAM");
    const noisy = await addSinglePixelNoise(baseline);

    const decision = await decideTrackedScreenshotAction({
      currentPngBuffer: noisy,
      headPngBuffer: baseline,
    });

    expect(decision.action).toBe("restore-head");
    expect(["anti-aliased-equivalent", "within-noise-budget"]).toContain(decision.comparison?.status);
  });

  it("keeps near-identical tracked screenshots when fuzzy restore is explicitly disabled", async () => {
    const baseline = await createTextScreenshot("LOAD RAM");
    const noisy = await addSinglePixelNoise(baseline);

    const decision = await decideTrackedScreenshotAction({
      currentPngBuffer: noisy,
      headPngBuffer: baseline,
      skipFuzzyHeadRestore: true,
    });

    expect(decision.action).toBe("keep");
    expect(["anti-aliased-equivalent", "within-noise-budget"]).toContain(decision.comparison?.status);
  });
});

describe("decideMetadataScreenshotAction", () => {
  it("restores the tracked file when bytes match HEAD at the same path", () => {
    expect(
      decideMetadataScreenshotAction({
        repoPath: "doc/img/app/home/00-overview-light.png",
        currentBlobId: "aaa111",
        headBlobId: "aaa111",
        trackedPathsForBlobId: ["doc/img/app/home/00-overview-light.png"],
      }),
    ).toBe("restore-head");
  });

  it("deletes new duplicate screenshots when another tracked path already has the same blob", () => {
    expect(
      decideMetadataScreenshotAction({
        repoPath: "doc/img/app/home/profiles/medium/02-overview.png",
        currentBlobId: "aaa111",
        headBlobId: undefined,
        trackedPathsForBlobId: ["doc/img/app/home/00-overview-light.png"],
        writeWhenTrackedDuplicate: false,
        skipTrackedDuplicatePrune: false,
      }),
    ).toBe("delete-new");
  });

  it("keeps new duplicate screenshots when explicitly allowed", () => {
    expect(
      decideMetadataScreenshotAction({
        repoPath: "doc/img/app/home/profiles/medium/02-overview.png",
        currentBlobId: "aaa111",
        headBlobId: undefined,
        trackedPathsForBlobId: ["doc/img/app/home/00-overview-light.png"],
        writeWhenTrackedDuplicate: true,
        skipTrackedDuplicatePrune: false,
      }),
    ).toBe("keep");
  });

  it("keeps duplicate screenshots when tracked-duplicate pruning is skipped", () => {
    expect(
      decideMetadataScreenshotAction({
        repoPath: "doc/img/app/home/profiles/medium/02-overview.png",
        currentBlobId: "aaa111",
        headBlobId: undefined,
        trackedPathsForBlobId: ["doc/img/app/home/00-overview-light.png"],
        writeWhenTrackedDuplicate: false,
        skipTrackedDuplicatePrune: true,
      }),
    ).toBe("keep");
  });

  it("keeps changed tracked screenshots when blob differs from HEAD", () => {
    expect(
      decideMetadataScreenshotAction({
        repoPath: "doc/img/app/home/00-overview-light.png",
        currentBlobId: "ccc333",
        headBlobId: "aaa111",
        trackedPathsForBlobId: [],
      }),
    ).toBe("keep");
  });
});

describe("pruneRedundantScreenshots", () => {
  it("restores modified tracked screenshots whose pixels are unchanged", async () => {
    const workdir = await createTempRepo();
    const repoPath = "doc/img/app/home/00-overview-light.png";
    const baseline = await createTextScreenshot("C64 COMMANDER");
    await commitRepoFile(workdir, repoPath, baseline);

    await writeFile(path.join(workdir, repoPath), await reencodePng(baseline, 1));

    const summary = await pruneRedundantScreenshots({ workdir });
    const status = execFileSync("git", ["status", "--short", "--", "doc/img/app"], {
      cwd: workdir,
      encoding: "utf8",
    });

    expect(summary).toMatchObject({ scanned: 1, reverted: 1, deleted: 0, kept: 0 });
    expect(status.trim()).toBe("");
  });

  it("keeps tracked screenshots with a real text change", async () => {
    const workdir = await createTempRepo();
    const repoPath = "doc/img/app/home/00-overview-light.png";
    await commitRepoFile(workdir, repoPath, await createTextScreenshot("LOAD RAM"));

    await writeFile(path.join(workdir, repoPath), await createTextScreenshot("LOAD ROM"));

    const summary = await pruneRedundantScreenshots({ workdir });
    const status = execFileSync("git", ["status", "--short", "--", "doc/img/app"], {
      cwd: workdir,
      encoding: "utf8",
    });

    expect(summary).toMatchObject({ scanned: 1, reverted: 0, deleted: 0, kept: 1 });
    expect(status).toContain("M doc/img/app/home/00-overview-light.png");
  });

  it("deletes untracked screenshots that duplicate an existing tracked blob", async () => {
    const workdir = await createTempRepo();
    const trackedRepoPath = "doc/img/app/home/00-overview-light.png";
    const duplicateRepoPath = "doc/img/app/home/duplicate.png";
    const baseline = await createTextScreenshot("C64 COMMANDER");
    await commitRepoFile(workdir, trackedRepoPath, baseline);

    await mkdir(path.dirname(path.join(workdir, duplicateRepoPath)), { recursive: true });
    await writeFile(path.join(workdir, duplicateRepoPath), await readFile(path.join(workdir, trackedRepoPath)));

    const summary = await pruneRedundantScreenshots({ workdir });

    await expect(access(path.join(workdir, duplicateRepoPath))).rejects.toThrow();
    expect(summary).toMatchObject({ scanned: 1, reverted: 0, deleted: 1, kept: 0 });
  });
});
