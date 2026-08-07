/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { openSync, readSync, closeSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

import { DISPLAY_PROFILE_VIEWPORTS } from "../../../playwright/displayProfileViewports";
import {
  CAPTURE_VIEWPORTS,
  SMALLEST_CAPTURE_VIEWPORT,
  describeCaptureBudgetViolation,
  describeCaptureViewports,
  findCaptureBudgetViolation,
  findCaptureViewport,
  fitsWithinViewport,
  isNonAppCapture,
  isSupportedCaptureViewport,
  toCssPixels,
} from "../../../playwright/screenshotViewportBudget";

const repoRoot = process.cwd();
const screenshotRoot = join(repoRoot, "docs", "img", "app");

/**
 * The device pixel ratio every screenshot in the corpus is captured at.
 *
 * The @screenshots suite runs on the phone project only, which is Playwright's Pixel 5 preset, and
 * that preset is 2.75. Asserted below rather than assumed, because reading the corpus back into CSS
 * pixels is only meaningful if this number is right.
 */
const CAPTURE_DEVICE_SCALE_FACTOR = 2.75;

/** The PNG header carries the dimensions in the IHDR chunk, at a fixed offset. No decoder needed. */
const readPngSize = (filePath: string): { width: number; height: number } => {
  const handle = openSync(filePath, "r");
  try {
    const header = Buffer.alloc(24);
    readSync(handle, header, 0, 24, 0);
    if (header.subarray(0, 8).toString("binary") !== "\x89PNG\r\n\x1a\n") {
      throw new Error(`${filePath} is not a PNG`);
    }
    return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
  } finally {
    closeSync(handle);
  }
};

const listPngs = (directory: string): string[] => {
  const entries = readdirSync(directory, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) return listPngs(full);
    return entry.isFile() && entry.name.endsWith(".png") ? [full] : [];
  });
};

describe("screenshot viewport budget", () => {
  it("allows only the four display-profile viewports, and names 320x426 as the smallest", () => {
    expect(SMALLEST_CAPTURE_VIEWPORT).toEqual({ width: 320, height: 426 });
    expect(CAPTURE_VIEWPORTS.compact).toEqual(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    expect(isSupportedCaptureViewport({ width: 320, height: 426 })).toBe(true);
    expect(isSupportedCaptureViewport({ width: 393, height: 727 })).toBe(true);
    // The sizes that were previously chosen to make one element fit.
    expect(isSupportedCaptureViewport({ width: 320, height: 1080 })).toBe(false);
    expect(isSupportedCaptureViewport({ width: 332, height: 680 })).toBe(false);
    expect(isSupportedCaptureViewport({ width: 393, height: 760 })).toBe(false);
    expect(isSupportedCaptureViewport(null)).toBe(false);
  });

  it("rejects a capture taller than the device it was taken on", () => {
    const violation = findCaptureBudgetViolation({
      relativePath: "play/sid-radio/01-controls.png",
      imageCssSize: { width: 320, height: 1080 },
      viewport: { width: 320, height: 426 },
    });
    expect(violation?.reason).toBe("taller-than-viewport");
    expect(describeCaptureBudgetViolation(violation!)).toContain("taller than the 320x426 CSS px device");
  });

  it("rejects a capture wider than the device it was taken on", () => {
    const violation = findCaptureBudgetViolation({
      relativePath: "home/wide.png",
      imageCssSize: { width: 900, height: 400 },
      viewport: { width: 320, height: 426 },
    });
    expect(violation?.reason).toBe("wider-than-viewport");
  });

  it("rejects a viewport that is not a screen the app supports, however plausible the number", () => {
    const violation = findCaptureBudgetViolation({
      relativePath: "home/remote-input/03-keyboard-compact.png",
      imageCssSize: { width: 332, height: 641 },
      viewport: { width: 332, height: 680 },
    });
    expect(violation?.reason).toBe("unsupported-viewport");
    expect(describeCaptureBudgetViolation(violation!)).toContain(describeCaptureViewports());
  });

  it("accepts a capture that fits the device", () => {
    expect(
      findCaptureBudgetViolation({
        relativePath: "home/00-overview-light.png",
        imageCssSize: { width: 320, height: 426 },
        viewport: { width: 320, height: 426 },
      }),
    ).toBeNull();
  });

  it("absorbs the fractional device pixel ratio rather than the defect", () => {
    // 727 CSS px at 2.75 stores as 1999 device px, which reads back as 727.0 minus a fraction.
    expect(fitsWithinViewport(toCssPixels({ width: 1081, height: 1999 }, 2.75), { width: 393, height: 727 })).toBe(
      true,
    );
    // Ten CSS pixels over is not rounding.
    expect(fitsWithinViewport({ width: 393, height: 737 }, { width: 393, height: 727 })).toBe(false);
  });

  it("attributes an image to a screen by its width, then holds it to that screen's height", () => {
    expect(findCaptureViewport({ width: 320, height: 400 })).toBe("compact");
    expect(findCaptureViewport({ width: 361, height: 700 })).toBe("medium");
    expect(findCaptureViewport({ width: 480, height: 640 })).toBe("small");
    expect(findCaptureViewport({ width: 800, height: 1280 })).toBe("expanded");
    // The defect: 320x1080 fits inside the 800x1280 expanded screen, so a plain "fits inside some
    // viewport" check would pass it. No 320-wide screen is 1080 tall.
    expect(findCaptureViewport({ width: 320, height: 1080 })).toBeNull();
    // 400 CSS px wide can only be the 480x640 small screen, whose height it exceeds.
    expect(findCaptureViewport({ width: 400, height: 740 })).toBeNull();
    // Wider than every supported screen.
    expect(findCaptureViewport({ width: 866, height: 780 })).toBeNull();
  });
});

describe("committed screenshot corpus", () => {
  const files = listPngs(screenshotRoot);

  it("finds the corpus", () => {
    expect(files.length).toBeGreaterThan(100);
  });

  /**
   * The regression this exists to catch.
   *
   * A screenshot taller than the device it claims to show is documentation of a screen that does not
   * exist. It got into the corpus twice over: `locator.screenshot()` photographs an element taller
   * than the viewport by scrolling and stitching, and viewports were then set taller than any real
   * panel so that a particular element would fit. Both are refused at capture time now, and this
   * checks the committed files so that a stale image cannot survive the change either.
   */
  it("holds no image that shows more than a supported device would", () => {
    const offenders = files
      .map((file) => {
        const relativePath = relative(screenshotRoot, file).split(sep).join("/");
        if (isNonAppCapture(relativePath)) return null;
        const cssSize = toCssPixels(readPngSize(file), CAPTURE_DEVICE_SCALE_FACTOR);
        const viewport = findCaptureViewport(cssSize);
        if (viewport) return null;
        return `${relativePath} is ${Math.round(cssSize.width)}x${Math.round(cssSize.height)} CSS px`;
      })
      .filter((entry): entry is string => entry !== null);

    expect(
      offenders,
      `These images are larger than any supported screen (${describeCaptureViewports()}):\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("captures the whole corpus at the phone project's device pixel ratio", () => {
    // Every image is stored at CAPTURE_DEVICE_SCALE_FACTOR, which is what makes the check above
    // meaningful. An image whose CSS size lands on a whole profile viewport proves the factor.
    const overviews = files.filter((file) => file.endsWith(join("profiles", "expanded", "01-overview.png")));
    expect(overviews.length).toBeGreaterThan(0);
    for (const file of overviews) {
      const cssSize = toCssPixels(readPngSize(file), CAPTURE_DEVICE_SCALE_FACTOR);
      expect(Math.round(cssSize.width), file).toBe(DISPLAY_PROFILE_VIEWPORTS.expanded.viewport.width);
      expect(Math.round(cssSize.height), file).toBe(DISPLAY_PROFILE_VIEWPORTS.expanded.viewport.height);
    }
  });
});
