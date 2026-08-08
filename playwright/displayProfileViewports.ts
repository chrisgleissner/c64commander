export const DISPLAY_PROFILE_VIEWPORTS = {
  small: {
    viewport: { width: 480, height: 640 },
    override: "compact",
    expectedProfile: "compact",
  },
  // The smallest screen the app supports, and the size to measure and illustrate it
  // at. A 480x640 hardware panel on a ~3.25in display works out near 246 ppi, which
  // Android buckets as hdpi and hands the WebView at a device pixel ratio of 1.5 - so
  // the page gets 320x426 CSS pixels, not 480x640. The `small` entry below is 480x640
  // in CSS pixels, which is a physically much larger screen.
  //
  // Height is what makes this the demanding case: every other entry here is at least
  // 640 CSS pixels tall, so nothing else exercises a viewport where the fixed app bar
  // and tab bar take this large a share and the scrollable area left over is under
  // half what the other profiles get.
  compact: {
    viewport: { width: 320, height: 426 },
    override: "compact",
    expectedProfile: "compact",
  },
  medium: {
    viewport: { width: 393, height: 727 },
    override: "medium",
    expectedProfile: "medium",
  },
  expanded: {
    viewport: { width: 800, height: 1280 },
    override: "expanded",
    expectedProfile: "expanded",
  },
} as const;

export type DisplayProfileViewportId = keyof typeof DISPLAY_PROFILE_VIEWPORTS;

export const DISPLAY_PROFILE_VIEWPORT_SEQUENCE = Object.keys(DISPLAY_PROFILE_VIEWPORTS) as DisplayProfileViewportId[];

/**
 * The profiles the manuals are illustrated at: one each.
 *
 * The C64U Remote manual uses `compact`, the smallest screen the app supports and the one
 * that edition's hardware has. The C64 Commander manual uses `medium`, an ordinary phone.
 * `scripts/build-manuals.mjs` picks between them per variant and fails the build if a
 * manual embeds a screenshot from the other one.
 *
 * `small` and `expanded` are deliberately absent: nothing in either manual is illustrated
 * at those sizes, and capturing them would double the work for images no manual embeds.
 */
export const MANUAL_PROFILE_SEQUENCE = ["compact", "medium"] as const satisfies readonly DisplayProfileViewportId[];
