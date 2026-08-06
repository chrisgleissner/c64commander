export const DISPLAY_PROFILE_VIEWPORTS = {
  // The smallest screen the app claims to support, in CSS pixels.
  //
  // This is not the same thing as the `small` entry below. A 480x640 hardware panel
  // on a ~3.25in display works out at roughly 246 ppi, which Android buckets as hdpi
  // and hands the WebView at a device pixel ratio of 1.5 - so the page gets 320x426
  // CSS pixels, not 480x640. `small` describes a viewport that is 480x640 in CSS
  // pixels, which is a physically much larger screen.
  //
  // The height is what makes this the interesting case: every other entry here is at
  // least 640 CSS pixels tall, so nothing exercised a viewport where the fixed app
  // bar and tab bar eat a much larger share of the screen and the scrollable area
  // left over is under half of what the other profiles get.
  tiny: {
    viewport: { width: 320, height: 426 },
    override: "compact",
    expectedProfile: "compact",
  },
  small: {
    viewport: { width: 480, height: 640 },
    override: "compact",
    expectedProfile: "compact",
  },
  compact: {
    viewport: { width: 360, height: 640 },
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
