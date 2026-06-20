export const DISPLAY_PROFILE_VIEWPORTS = {
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
