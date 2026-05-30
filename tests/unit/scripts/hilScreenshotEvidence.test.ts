import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { afterEach, describe, expect, it } from "vitest";

import { createReviewScreenshot, resolveReviewDimensions } from "../../../scripts/hil-screenshot-evidence.mjs";

let tempDirs: string[] = [];

const createTempDir = async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "c64u-hil-evidence-"));
  tempDirs.push(dir);
  return dir;
};

describe("hil screenshot evidence helper", () => {
  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })));
    tempDirs = [];
  });

  it("creates a raw PNG and review-safe downscaled PNG below configured limits", async () => {
    const dir = await createTempDir();
    const rawPath = path.join(dir, "raw", "full.png");
    const reviewPath = path.join(dir, "review", "full-review.png");
    await mkdir(path.dirname(rawPath), { recursive: true });
    await sharp({
      create: {
        width: 1080,
        height: 2280,
        channels: 4,
        background: "#112233",
      },
    })
      .png()
      .toFile(rawPath);

    const result = await createReviewScreenshot(rawPath, reviewPath);
    const rawMetadata = await sharp(result.rawPath).metadata();
    const reviewMetadata = await sharp(result.reviewPath).metadata();

    expect(rawMetadata).toMatchObject({ width: 1080, height: 2280 });
    expect(reviewMetadata.width).toBeLessThan(2000);
    expect(reviewMetadata.height).toBeLessThan(2000);
    expect(reviewMetadata.width).toBeLessThanOrEqual(480);
  });

  it("preserves smaller screenshots without upscaling", () => {
    expect(resolveReviewDimensions({ width: 320, height: 640 })).toEqual({ width: 320, height: 640 });
  });
});
