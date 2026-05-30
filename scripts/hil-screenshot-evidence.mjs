#!/usr/bin/env node
/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import sharp from "sharp";

const execFileAsync = promisify(execFile);

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

export const captureAndroidScreenshot = async ({ serial, rawPath }) => {
  const args = [];
  if (serial) {
    args.push("-s", serial);
  }
  args.push("exec-out", "screencap", "-p");
  const { stdout } = await execFileAsync("adb", args, {
    encoding: "buffer",
    maxBuffer: 16 * 1024 * 1024,
  });
  await mkdir(path.dirname(rawPath), { recursive: true });
  await writeFile(rawPath, stdout);
  return rawPath;
};

export const captureUiDump = async ({ serial, xmlPath }) => {
  const dumpArgs = [];
  const catArgs = [];
  if (serial) {
    dumpArgs.push("-s", serial);
    catArgs.push("-s", serial);
  }
  dumpArgs.push("shell", "uiautomator", "dump", "/sdcard/c64commander-ui.xml");
  catArgs.push("exec-out", "cat", "/sdcard/c64commander-ui.xml");
  await execFileAsync("adb", dumpArgs);
  const { stdout } = await execFileAsync("adb", catArgs, {
    encoding: "buffer",
    maxBuffer: 4 * 1024 * 1024,
  });
  await mkdir(path.dirname(xmlPath), { recursive: true });
  await writeFile(xmlPath, stdout);
  return xmlPath;
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
    if (arg === "--serial") parsed.serial = readValue();
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
  const uiDir = path.join(args.outDir, "ui");
  const rawPath = path.join(rawDir, `${args.name}.png`);
  const reviewPath = path.join(reviewDir, `${args.name}-review.png`);

  await mkdir(rawDir, { recursive: true });
  if (args.input) {
    await copyFile(args.input, rawPath);
  } else {
    await captureAndroidScreenshot({ serial: args.serial, rawPath });
  }

  const result = await createReviewScreenshot(rawPath, reviewPath, {
    reviewWidth: args.reviewWidth,
    maxDimension: args.maxDimension,
  });

  const output = {
    ...result,
    uiDumpPath: null,
  };

  if (args.uiDump) {
    output.uiDumpPath = await captureUiDump({
      serial: args.serial,
      xmlPath: path.join(uiDir, `${args.name}.xml`),
    });
  }

  await readFile(output.rawPath);
  console.log(JSON.stringify(output, null, 2));
  return output;
};

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}
