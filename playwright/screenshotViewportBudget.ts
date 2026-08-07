/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { DISPLAY_PROFILE_VIEWPORTS, type DisplayProfileViewportId } from "./displayProfileViewports";

export type ViewportSize = { width: number; height: number };

/**
 * The rule this module enforces: a screenshot may never show more than the device it was taken on
 * would show.
 *
 * A screenshot is documentation of a screen. An image taller than any screen the app runs on is not
 * a picture of the product — it is a composite that no user can ever see, and a reader who measures
 * the product by it is measuring something that does not exist. The two ways the suite produced one
 * were an element capture (`locator.screenshot()` photographs an element taller than the viewport by
 * scrolling the page and stitching the strips together) and a viewport set taller than any real
 * panel so that an element would fit inside it.
 *
 * Both are now refused. Captures are clipped to the viewport, and the viewport itself must be one of
 * the sizes below.
 */

/**
 * Every viewport a screenshot may be captured at, in CSS pixels.
 *
 * These are the four display profiles the app itself is built around, and each one is a real screen:
 * see `displayProfileViewports.ts` for what each corresponds to. The smallest is 320x426, which is a
 * 480x640 panel of about 3.25 inches — Android buckets that density as hdpi and hands the WebView a
 * device pixel ratio of 1.5, so the page gets 320x426 CSS pixels rather than 480x640.
 *
 * Nothing else is allowed. A size picked to make some particular element fit is the defect this
 * list exists to prevent, however plausible the number looks.
 */
export const CAPTURE_VIEWPORTS: Record<DisplayProfileViewportId, ViewportSize> = Object.fromEntries(
  Object.entries(DISPLAY_PROFILE_VIEWPORTS).map(([id, entry]) => [id, entry.viewport]),
) as Record<DisplayProfileViewportId, ViewportSize>;

/** The smallest screen the app supports, and the one every capture has to survive. */
export const SMALLEST_CAPTURE_VIEWPORT: ViewportSize = CAPTURE_VIEWPORTS.compact;

/**
 * How much a measured size may exceed a viewport before it counts as a violation, in CSS pixels.
 *
 * Images are stored in device pixels and the device pixel ratio is not an integer (2.75 on the
 * reference handset), so converting back to CSS pixels lands a fraction under or over. One pixel of
 * slack absorbs that and nothing else: the failures this guards against are tens or hundreds of
 * pixels, not one.
 */
export const CAPTURE_SIZE_SLACK_CSS_PX = 1;

/** True when `size` fits inside `viewport`, allowing for the rounding slack. */
export const fitsWithinViewport = (size: ViewportSize, viewport: ViewportSize): boolean =>
  size.width <= viewport.width + CAPTURE_SIZE_SLACK_CSS_PX &&
  size.height <= viewport.height + CAPTURE_SIZE_SLACK_CSS_PX;

/**
 * Which screen a finished image must have come from, or null when no screen could have produced it.
 *
 * Width decides the screen, height then has to fit it. A capture is never wider than the viewport
 * it was taken at, so the narrowest screen at least as wide as the image is the narrowest one that
 * could have produced it — and that screen's height is then the ceiling the image has to respect.
 *
 * Checking only "does it fit inside some viewport" is too weak to catch the defect this module is
 * about: a 320x1080 image fits inside the 800x1280 expanded screen, so the check would pass an image
 * three times taller than any screen of that width. Attributing by width first is what makes the
 * ceiling the right one.
 *
 * The rule is deliberately strict at the edges: a 320-pixel-wide element photographed on the medium
 * screen is held to the compact screen's height. That case does not occur in the corpus, and the
 * strictness is what keeps the check meaningful.
 */
export const findCaptureViewport = (size: ViewportSize): DisplayProfileViewportId | null => {
  const ids = Object.keys(CAPTURE_VIEWPORTS) as DisplayProfileViewportId[];
  const wideEnough = ids
    .filter((id) => size.width <= CAPTURE_VIEWPORTS[id].width + CAPTURE_SIZE_SLACK_CSS_PX)
    .sort((left, right) => CAPTURE_VIEWPORTS[left].width - CAPTURE_VIEWPORTS[right].width);
  const narrowest = wideEnough[0];
  if (!narrowest) return null;
  return fitsWithinViewport(size, CAPTURE_VIEWPORTS[narrowest]) ? narrowest : null;
};

/** True when `viewport` is one of the allowed capture viewports. */
export const isSupportedCaptureViewport = (viewport: ViewportSize | null): boolean => {
  if (!viewport) return false;
  return Object.values(CAPTURE_VIEWPORTS).some(
    (allowed) => allowed.width === viewport.width && allowed.height === viewport.height,
  );
};

export const describeCaptureViewports = (): string =>
  (Object.keys(CAPTURE_VIEWPORTS) as DisplayProfileViewportId[])
    .map((id) => `${id} ${CAPTURE_VIEWPORTS[id].width}x${CAPTURE_VIEWPORTS[id].height}`)
    .join(", ");

/** Device pixels back to CSS pixels, for a capture taken at `deviceScaleFactor`. */
export const toCssPixels = (size: ViewportSize, deviceScaleFactor: number): ViewportSize => ({
  width: size.width / deviceScaleFactor,
  height: size.height / deviceScaleFactor,
});

export type CaptureBudgetViolation = {
  relativePath: string;
  imageCssSize: ViewportSize;
  viewport: ViewportSize;
  reason: "taller-than-viewport" | "wider-than-viewport" | "unsupported-viewport";
};

/**
 * What is wrong with this capture, or null when nothing is.
 *
 * Both halves of the rule are checked here so a caller cannot enforce one and forget the other: the
 * viewport must be a real device size, and the image must fit inside it.
 */
export const findCaptureBudgetViolation = (input: {
  relativePath: string;
  imageCssSize: ViewportSize;
  viewport: ViewportSize | null;
}): CaptureBudgetViolation | null => {
  const viewport = input.viewport;
  if (!isSupportedCaptureViewport(viewport)) {
    return {
      relativePath: input.relativePath,
      imageCssSize: input.imageCssSize,
      viewport: viewport ?? { width: 0, height: 0 },
      reason: "unsupported-viewport",
    };
  }
  const allowed = viewport as ViewportSize;
  if (input.imageCssSize.height > allowed.height + CAPTURE_SIZE_SLACK_CSS_PX) {
    return {
      relativePath: input.relativePath,
      imageCssSize: input.imageCssSize,
      viewport: allowed,
      reason: "taller-than-viewport",
    };
  }
  if (input.imageCssSize.width > allowed.width + CAPTURE_SIZE_SLACK_CSS_PX) {
    return {
      relativePath: input.relativePath,
      imageCssSize: input.imageCssSize,
      viewport: allowed,
      reason: "wider-than-viewport",
    };
  }
  return null;
};

const round = (value: number) => Math.round(value * 10) / 10;

export const describeCaptureBudgetViolation = (violation: CaptureBudgetViolation): string => {
  const image = `${round(violation.imageCssSize.width)}x${round(violation.imageCssSize.height)} CSS px`;
  const viewport = `${violation.viewport.width}x${violation.viewport.height} CSS px`;
  switch (violation.reason) {
    case "unsupported-viewport":
      return (
        `${violation.relativePath} was captured at ${viewport}, which is not a screen the app supports. ` +
        `Capture at one of: ${describeCaptureViewports()}. ` +
        `A viewport sized to make an element fit is the defect this check exists to prevent; scroll the ` +
        `element into view instead.`
      );
    case "taller-than-viewport":
      return (
        `${violation.relativePath} is ${image}, which is taller than the ${viewport} device it was captured on. ` +
        `An element taller than the viewport must be clipped to the viewport and, where the part that ` +
        `matters is below the fold, scrolled into view before the capture.`
      );
    case "wider-than-viewport":
      return `${violation.relativePath} is ${image}, which is wider than the ${viewport} device it was captured on.`;
  }
};

/**
 * Paths under `docs/img/app/` that are not produced by the screenshot suite.
 *
 * `launch/auth-challenge/` holds framebuffer grabs taken on a real handset for the device-discovery
 * research report. They are 1080x2280 device pixels because that is the handset's own screen, so
 * they do already show only what a device shows — but the device is not one of the four profiles
 * above, and no capture code decides their size. Listed rather than pattern-matched so that adding
 * one is a deliberate act.
 */
export const NON_APP_CAPTURE_PREFIXES: readonly string[] = ["launch/auth-challenge/"];

export const isNonAppCapture = (relativePath: string): boolean =>
  NON_APP_CAPTURE_PREFIXES.some((prefix) => relativePath.startsWith(prefix));
