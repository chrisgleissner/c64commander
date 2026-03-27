import { execFile as execFileCb } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

import { shouldSkipFuzzyScreenshotPrune } from "./screenshotPrunePolicy.js";

const execFile = promisify(execFileCb);
const require = createRequire(import.meta.url);
const pixelmatch = require(path.resolve(process.cwd(), "node_modules/playwright-core/lib/third_party/pixelmatch.js"));

export const SCREENSHOT_DIFF_CONFIG = Object.freeze({
  pixelmatchThreshold: 0.02,
  maxDiffPixels: 8,
  maxDiffRatio: 0.000005,
});

export const parseGitLsTreeBlobCatalog = (stdout) => {
  const blobIdsToPaths = new Map();
  const pathBlobIds = new Map();
  const trackedPaths = new Set();

  stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .forEach((line) => {
      const match = line.match(/^\d+\s+blob\s+([0-9a-f]+)\t(.+)$/i);
      if (!match) return;
      const [, blobId, repoPath] = match;
      trackedPaths.add(repoPath);
      pathBlobIds.set(repoPath, blobId);
      const paths = blobIdsToPaths.get(blobId) ?? [];
      paths.push(repoPath);
      blobIdsToPaths.set(blobId, paths);
    });

  return {
    blobIdsToPaths,
    pathBlobIds,
    trackedPaths,
  };
};

export const decideMetadataScreenshotAction = ({
  repoPath,
  currentBlobId,
  headBlobId,
  trackedPathsForBlobId = [],
  writeWhenTrackedDuplicate = false,
  skipTrackedDuplicatePrune = false,
}) => {
  if (headBlobId && currentBlobId === headBlobId) {
    return "restore-head";
  }

  const hasTrackedDuplicateAtAnotherPath = trackedPathsForBlobId.some((trackedPath) => trackedPath !== repoPath);
  if (!headBlobId && hasTrackedDuplicateAtAnotherPath && !writeWhenTrackedDuplicate && !skipTrackedDuplicatePrune) {
    return "delete-new";
  }

  return "keep";
};

const decodePngToRgba = async (input) => {
  const { data, info } = await sharp(input, { limitInputPixels: false })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return {
    data,
    width: info.width,
    height: info.height,
    totalPixels: info.width * info.height,
  };
};

export const compareScreenshotBuffers = async (
  referenceBuffer,
  candidateBuffer,
  diffConfig = SCREENSHOT_DIFF_CONFIG,
) => {
  const [reference, candidate] = await Promise.all([
    decodePngToRgba(referenceBuffer),
    decodePngToRgba(candidateBuffer),
  ]);

  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    return {
      status: "different-size",
      diffPixels: null,
      diffRatio: null,
      width: candidate.width,
      height: candidate.height,
    };
  }

  if (reference.data.equals(candidate.data)) {
    return {
      status: "identical",
      diffPixels: 0,
      diffRatio: 0,
      width: candidate.width,
      height: candidate.height,
    };
  }

  const diffPixels = pixelmatch(reference.data, candidate.data, null, reference.width, reference.height, {
    includeAA: false,
    threshold: diffConfig.pixelmatchThreshold,
  });
  const diffRatio = diffPixels / reference.totalPixels;

  if (diffPixels === 0) {
    return {
      status: "anti-aliased-equivalent",
      diffPixels,
      diffRatio,
      width: candidate.width,
      height: candidate.height,
    };
  }

  if (diffPixels <= diffConfig.maxDiffPixels) {
    return {
      status: "within-noise-budget",
      diffPixels,
      diffRatio,
      width: candidate.width,
      height: candidate.height,
    };
  }

  return {
    status: "different",
    diffPixels,
    diffRatio,
    width: candidate.width,
    height: candidate.height,
  };
};

export const decideTrackedScreenshotAction = async ({
  currentPngBuffer,
  headPngBuffer,
  skipFuzzyHeadRestore = false,
  diffConfig = SCREENSHOT_DIFF_CONFIG,
}) => {
  if (!headPngBuffer) {
    return {
      action: "keep",
      comparison: null,
    };
  }

  const comparison = await compareScreenshotBuffers(headPngBuffer, currentPngBuffer, diffConfig);

  if (comparison.status === "identical") {
    return {
      action: "restore-head",
      comparison,
    };
  }

  if (
    !skipFuzzyHeadRestore &&
    (comparison.status === "anti-aliased-equivalent" || comparison.status === "within-noise-budget")
  ) {
    return {
      action: "restore-head",
      comparison,
    };
  }

  return {
    action: "keep",
    comparison,
  };
};

const listCandidateScreenshotFiles = async (workdir) => {
  const [unstaged, staged, untracked] = await Promise.all([
    execFile("git", ["diff", "--name-only", "--diff-filter=AM", "--", "doc/img/app"], { cwd: workdir }),
    execFile("git", ["diff", "--name-only", "--cached", "--diff-filter=AM", "--", "doc/img/app"], { cwd: workdir }),
    execFile("git", ["ls-files", "--others", "--exclude-standard", "--", "doc/img/app"], { cwd: workdir }),
  ]);

  return [
    ...new Set(
      `${unstaged.stdout}\n${staged.stdout}\n${untracked.stdout}`
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.endsWith(".png")),
    ),
  ];
};

export const loadHeadScreenshotCatalog = async (workdir = process.cwd()) => {
  try {
    const { stdout } = await execFile("git", ["ls-tree", "-r", "HEAD", "--", "doc/img/app"], {
      cwd: workdir,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseGitLsTreeBlobCatalog(stdout);
  } catch (error) {
    console.error("[png-prune] Failed to read HEAD screenshot catalog:", error);
    return {
      blobIdsToPaths: new Map(),
      pathBlobIds: new Map(),
      trackedPaths: new Set(),
    };
  }
};

const loadHeadScreenshotBuffer = async (repoPath, workdir) => {
  try {
    const { stdout } = await execFile("git", ["show", `HEAD:${repoPath}`], {
      cwd: workdir,
      encoding: "buffer",
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (error) {
    console.error(`[png-prune] Failed to read HEAD screenshot ${repoPath}:`, error);
    return null;
  }
};

const hashFile = async (filePath, workdir) => {
  try {
    const { stdout } = await execFile("git", ["hash-object", filePath], {
      cwd: workdir,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    console.error(`[png-prune] Failed to hash ${filePath}:`, error);
    return null;
  }
};

const restoreFile = async (repoPath, workdir) => {
  try {
    await execFile("git", ["restore", "--source=HEAD", "--staged", "--worktree", "--", repoPath], {
      cwd: workdir,
    });
    return true;
  } catch (error) {
    console.error(`[png-prune] Failed to restore ${repoPath}:`, error);
    return false;
  }
};

export const pruneRedundantScreenshots = async ({
  workdir = process.cwd(),
  diffConfig = SCREENSHOT_DIFF_CONFIG,
} = {}) => {
  const candidateFiles = await listCandidateScreenshotFiles(workdir);
  if (candidateFiles.length === 0) {
    return {
      scanned: 0,
      reverted: 0,
      deleted: 0,
      kept: 0,
    };
  }

  const headCatalog = await loadHeadScreenshotCatalog(workdir);
  const headBufferCache = new Map();

  let reverted = 0;
  let deleted = 0;
  let kept = 0;

  for (const repoPath of candidateFiles) {
    const headBlobId = headCatalog.pathBlobIds.get(repoPath);
    if (headBlobId) {
      const currentPngBuffer = await readFile(path.join(workdir, repoPath));
      let headPngBufferPromise = headBufferCache.get(repoPath);
      if (!headPngBufferPromise) {
        headPngBufferPromise = loadHeadScreenshotBuffer(repoPath, workdir);
        headBufferCache.set(repoPath, headPngBufferPromise);
      }
      const headPngBuffer = await headPngBufferPromise;
      const { action } = await decideTrackedScreenshotAction({
        currentPngBuffer,
        headPngBuffer,
        skipFuzzyHeadRestore: shouldSkipFuzzyScreenshotPrune(repoPath),
        diffConfig,
      });

      if (action === "restore-head") {
        const restored = await restoreFile(repoPath, workdir);
        if (restored) {
          reverted += 1;
          continue;
        }
      }

      kept += 1;
      continue;
    }

    const currentBlobId = await hashFile(repoPath, workdir);
    if (!currentBlobId) {
      kept += 1;
      continue;
    }

    const action = decideMetadataScreenshotAction({
      repoPath,
      currentBlobId,
      headBlobId,
      trackedPathsForBlobId: headCatalog.blobIdsToPaths.get(currentBlobId) ?? [],
      writeWhenTrackedDuplicate: false,
      skipTrackedDuplicatePrune: shouldSkipFuzzyScreenshotPrune(repoPath),
    });

    if (action === "delete-new") {
      try {
        await rm(path.join(workdir, repoPath), { force: true });
        deleted += 1;
        continue;
      } catch (error) {
        console.error(`[png-prune] Failed to delete duplicate screenshot ${repoPath}:`, error);
      }
    }

    kept += 1;
  }

  return {
    scanned: candidateFiles.length,
    reverted,
    deleted,
    kept,
  };
};
