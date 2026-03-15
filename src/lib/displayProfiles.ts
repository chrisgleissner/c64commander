export const DISPLAY_PROFILE_THRESHOLDS = {
  compactMax: 360,
  mediumMax: 599,
} as const;

export const DISPLAY_PROFILE_SEQUENCE = ["compact", "medium", "expanded"] as const;

export type DisplayProfile = (typeof DISPLAY_PROFILE_SEQUENCE)[number];

export const DISPLAY_PROFILE_OVERRIDE_SEQUENCE = ["auto", ...DISPLAY_PROFILE_SEQUENCE] as const;

export type DisplayProfileOverride = (typeof DISPLAY_PROFILE_OVERRIDE_SEQUENCE)[number];

export const DISPLAY_PROFILE_LABELS: Record<DisplayProfile, string> = {
  compact: "Small display",
  medium: "Standard display",
  expanded: "Large display",
};

export const DISPLAY_PROFILE_OVERRIDE_LABELS: Record<DisplayProfileOverride, string> = {
  auto: "Auto",
  compact: DISPLAY_PROFILE_LABELS.compact,
  medium: DISPLAY_PROFILE_LABELS.medium,
  expanded: DISPLAY_PROFILE_LABELS.expanded,
};

export const resolveDisplayProfile = (width: number): DisplayProfile => {
  if (!Number.isFinite(width) || width <= 0) return "medium";
  if (width <= DISPLAY_PROFILE_THRESHOLDS.compactMax) return "compact";
  if (width <= DISPLAY_PROFILE_THRESHOLDS.mediumMax) return "medium";
  return "expanded";
};

export const resolveEffectiveDisplayProfile = (width: number, override: DisplayProfileOverride): DisplayProfile => {
  if (override !== "auto") return override;
  return resolveDisplayProfile(width);
};

export const isDisplayProfileOverride = (value: unknown): value is DisplayProfileOverride =>
  typeof value === "string" && DISPLAY_PROFILE_OVERRIDE_SEQUENCE.includes(value as DisplayProfileOverride);

export const getDisplayProfileLayoutTokens = (profile: DisplayProfile) => {
  switch (profile) {
    case "compact":
      return {
        rootFontSize: "17px",
        pageMaxWidth: "100%",
        readingMaxWidth: "100%",
        pagePaddingX: "0.5rem",
        pagePaddingY: "0.5rem",
        pagePaddingTop: "0.5rem",
        sectionGap: "1rem",
        panelGap: "0.875rem",
        actionGridColumns: 2,
        actionGridMinWidth: "0px",
        actionGridGap: "0.625rem",
        modalMaxWidth: "100vw",
        modalInset: "1rem",
        isCompactDialog: true,
      };
    case "expanded":
      return {
        rootFontSize: "17.5px",
        pageMaxWidth: "1200px",
        readingMaxWidth: "1080px",
        pagePaddingX: "1.5rem",
        pagePaddingY: "1.5rem",
        pagePaddingTop: "1.5rem",
        sectionGap: "1.5rem",
        panelGap: "1.25rem",
        actionGridColumns: 4,
        actionGridMinWidth: "9rem",
        actionGridGap: "0.875rem",
        modalMaxWidth: "72rem",
        modalInset: "1rem",
        isCompactDialog: false,
      };
    default:
      return {
        rootFontSize: "16px",
        pageMaxWidth: "960px",
        readingMaxWidth: "960px",
        pagePaddingX: "1rem",
        pagePaddingY: "1.25rem",
        pagePaddingTop: "1.25rem",
        sectionGap: "1.25rem",
        panelGap: "1rem",
        actionGridColumns: 4,
        actionGridMinWidth: "0px",
        actionGridGap: "0.75rem",
        modalMaxWidth: "48rem",
        modalInset: "1rem",
        isCompactDialog: false,
      };
  }
};
