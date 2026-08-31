#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { mkdir, readFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/*
 * droidctl/dist is a build artifact and is gitignored, so this import is lazy:
 * importing it at module load would break any consumer that only wants the pure
 * helpers in this file on a tree that has not been built.
 */
const loadDroidctl = async () => {
  try {
    return await import("../droidctl/dist/server.js");
  } catch (error) {
    throw new Error(
      `Unable to load droidctl; run "npm run droid:build" first. Underlying error: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
};

const DEFAULT_REVIEW_WIDTH = 480;
const DEFAULT_MAX_DIMENSION = 1999;

const parsePositiveDimension = (value, optionName) => {
  const dimension = Number(value);
  if (!Number.isFinite(dimension) || dimension < 1) {
    throw new Error(`${optionName} must be a finite number greater than or equal to 1`);
  }
  return Math.max(1, Math.floor(dimension));
};

export const resolveReviewDimensions = (metadata, options = {}) => {
  const width = metadata.width;
  const height = metadata.height;
  if (!width || !height) {
    throw new Error("PNG metadata must include width and height");
  }

  const reviewWidth = parsePositiveDimension(options.reviewWidth ?? DEFAULT_REVIEW_WIDTH, "reviewWidth");
  const maxDimension = parsePositiveDimension(options.maxDimension ?? DEFAULT_MAX_DIMENSION, "maxDimension");
  const scale = Math.min(1, reviewWidth / width, maxDimension / width, maxDimension / height);
  return {
    width: Math.max(1, Math.floor(width * scale)),
    height: Math.max(1, Math.floor(height * scale)),
  };
};

export const createReviewScreenshot = async (rawPath, reviewPath, options = {}) => {
  const image = sharp(rawPath);
  const metadata = await image.metadata();
  const dimensions = resolveReviewDimensions(metadata, options);
  await mkdir(path.dirname(reviewPath), { recursive: true });
  await image.resize(dimensions).png().toFile(reviewPath);
  const reviewMetadata = await sharp(reviewPath).metadata();
  if (
    !reviewMetadata.width ||
    !reviewMetadata.height ||
    reviewMetadata.width >= (options.maxDimension ?? DEFAULT_MAX_DIMENSION) + 1 ||
    reviewMetadata.height >= (options.maxDimension ?? DEFAULT_MAX_DIMENSION) + 1
  ) {
    throw new Error(`Review screenshot exceeds dimension limit: ${reviewMetadata.width}x${reviewMetadata.height}`);
  }
  return {
    rawPath,
    reviewPath,
    raw: { width: metadata.width, height: metadata.height },
    review: { width: reviewMetadata.width, height: reviewMetadata.height },
  };
};

const callDroidctl = async (runtime, name, args) => {
  const result = await runtime.toolRegistry.invoke(name, args);
  const envelope = JSON.parse(result.content[0].text);
  if (!envelope.ok) {
    throw new Error(`${name} failed [${envelope.error.code}]: ${envelope.error.message}`);
  }
  return envelope.data;
};

/*
 * Device capture runs through droidctl: it carries the explicit -s, the PNG
 * signature check at capture time, and the settle-and-retry loop around the UI
 * dump. It writes raw/<name>.png and review/<name>-review.png into outDir, which
 * is the layout this script already produced.
 */
export const captureThroughDroidctl = async ({ target, outDir, name, reviewWidth, maxDimension, uiDump }) => {
  const { createDroidctlServerRuntime } = await loadDroidctl();
  const runtime = createDroidctlServerRuntime({ artifactRoot: path.join(outDir, "droidctl-runs") });
  const shot = await callDroidctl(runtime, "droid_capture.screenshot", {
    targetId: target,
    name,
    runRoot: outDir,
    ...(reviewWidth === undefined ? {} : { reviewWidth }),
    ...(maxDimension === undefined ? {} : { maxDimension }),
  });

  let uiDumpPath = null;
  if (uiDump) {
    const hierarchy = await callDroidctl(runtime, "droid_capture.ui_hierarchy", {
      targetId: target,
      name,
      runRoot: outDir,
    });
    uiDumpPath = hierarchy.xmlPath;
  }

  return { ...shot, uiDumpPath };
};

const parseArgs = (argv) => {
  const parsed = {
    name: `screenshot-${new Date().toISOString().replace(/[:.]/g, "-")}`,
    outDir: "docs/research/stabilization/prod-hardening-5/evidence",
    reviewWidth: DEFAULT_REVIEW_WIDTH,
    maxDimension: DEFAULT_MAX_DIMENSION,
    uiDump: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const readValue = () => {
      const value = argv[index + 1];
      if (!value) throw new Error(`${arg} requires a value`);
      index += 1;
      return value;
    };
    if (arg === "--target") parsed.target = readValue();
    else if (arg === "--out-dir") parsed.outDir = readValue();
    else if (arg === "--name") parsed.name = readValue();
    else if (arg === "--input") parsed.input = readValue();
    else if (arg === "--review-width") parsed.reviewWidth = Number(readValue());
    else if (arg === "--max-dimension") parsed.maxDimension = Number(readValue());
    else if (arg === "--ui-dump") parsed.uiDump = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return parsed;
};

export const runCli = async (argv = process.argv.slice(2)) => {
  const args = parseArgs(argv);
  const rawDir = path.join(args.outDir, "raw");
  const reviewDir = path.join(args.outDir, "review");
  const rawPath = path.join(rawDir, `${args.name}.png`);
  const reviewPath = path.join(reviewDir, `${args.name}-review.png`);

  if (!args.input && !args.target) {
    throw new Error("--target <targetId> is required for a device capture; there is no default target");
  }

  if (!args.input) {
    const captured = await captureThroughDroidctl({
      target: args.target,
      outDir: args.outDir,
      name: args.name,
      reviewWidth: args.reviewWidth,
      maxDimension: args.maxDimension,
      uiDump: args.uiDump,
    });
    await readFile(captured.rawPath);
    console.log(JSON.stringify(captured, null, 2));
    return captured;
  }

  await mkdir(rawDir, { recursive: true });
  await copyFile(args.input, rawPath);
  const result = await createReviewScreenshot(rawPath, reviewPath, {
    reviewWidth: args.reviewWidth,
    maxDimension: args.maxDimension,
  });
  const output = { ...result, uiDumpPath: null };
  await readFile(output.rawPath);
  console.log(JSON.stringify(output, null, 2));
  return output;
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
