/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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

/**
 * Root type sizes, set from the physical size of a pixel on each profile's real hardware rather
 * than from taste.
 *
 * A CSS pixel is not a fixed physical size — the device pixel ratio the browser picks decides that.
 * Measured from the rendered glyphs, cap height is 0.71 em, so the visual angle a reader actually
 * gets is `2 * atan(root * 0.71 * mmPerCssPx / (2 * distance))`. A reader at 20/40 — roughly average
 * corrected sight in the 50-60 age range this app targets — is at threshold near 10 arcminutes and
 * comfortable from about 20.
 *
 * | profile  | reference hardware                   | ppi | mm/CSS px | distance | root    | angle |
 * |----------|--------------------------------------|-----|-----------|----------|---------|-------|
 * | compact  | 3.25in 480x640 handset, DPR 1.5      | 246 | 0.1548    | 300 mm   | 16px    | 20.2' |
 * | medium   | 5.7in 1080x2280 phone, DPR 2.75      | 443 | 0.1578    | 300 mm   | 17px    | 21.8' |
 * | expanded | 10.1in 1200x1920 tablet, DPR 1.5     | 224 | 0.1700    | 400 mm   | 19.5px  | 20.2' |
 *
 * These sit just above the 20-arcminute comfortable floor rather than comfortably inside it, which
 * is a deliberate trade for screen space on the smallest profile. They cannot go lower without
 * breaching the repository's own 16 px minimum for body text (`AGENTS.md`, "Reach and readability
 * are requirements"), which is what stops the compact root going below 16px.
 *
 * Medium was 16px — 20.5 arcminutes, right on the comfortable floor, and smaller than compact
 * despite the two having almost identical physical pixels. Expanded was the worst at 18.1', below
 * the floor, because a tablet is held further away and its pixels are physically larger without the
 * type being any larger to match. The expanded row's hardware is an assumption; the other two are
 * the devices this was measured on.
 *
 * The user's own Text size setting still scales on top of all three.
 */
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

const normalizeDisplayMetric = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.round(value);
};

export const resolveAutomaticDisplayProfileWidth = (
  viewportWidth: number,
  screenWidth: number,
  screenHeight: number,
): number => {
  const normalizedViewportWidth = normalizeDisplayMetric(viewportWidth);
  const normalizedScreenWidth = normalizeDisplayMetric(screenWidth);
  const normalizedScreenHeight = normalizeDisplayMetric(screenHeight);
  const screenShortEdge =
    normalizedScreenWidth > 0 && normalizedScreenHeight > 0
      ? Math.min(normalizedScreenWidth, normalizedScreenHeight)
      : 0;
  return Math.max(normalizedViewportWidth, screenShortEdge);
};

export const resolveAutomaticDisplayProfile = (
  viewportWidth: number,
  screenWidth: number,
  screenHeight: number,
): DisplayProfile =>
  resolveDisplayProfile(resolveAutomaticDisplayProfileWidth(viewportWidth, screenWidth, screenHeight));

export const isDisplayProfileOverride = (value: unknown): value is DisplayProfileOverride =>
  typeof value === "string" && DISPLAY_PROFILE_OVERRIDE_SEQUENCE.includes(value as DisplayProfileOverride);

export const getDisplayProfileLayoutTokens = (profile: DisplayProfile) => {
  switch (profile) {
    case "compact":
      return {
        rootFontSize: "16px",
        pageMaxWidth: "100%",
        readingMaxWidth: "100%",
        pagePaddingX: "0.5rem",
        pagePaddingY: "0.5rem",
        pagePaddingTop: "0.5rem",
        // 12 gaps between 13 cards is 192 CSS px of the 332 the smallest screen has for content —
        // more than half of it spent on nothing. Halved here; the cards have their own borders, so
        // they stay distinct without it.
        sectionGap: "0.5rem",
        panelGap: "0.625rem",
        actionGridColumns: 2,
        actionGridMinWidth: "0px",
        actionGridGap: "0.625rem",
        modalMaxWidth: "100dvw",
        modalInset: "1rem",
        isCompactDialog: true,
      };
    case "expanded":
      return {
        rootFontSize: "19.5px",
        pageMaxWidth: "1200px",
        readingMaxWidth: "1080px",
        pagePaddingX: "1.5rem",
        pagePaddingY: "1.5rem",
        // 0.8125rem, not 0.875rem: this is a rem, so it grew with the root size, and
        // 0.875 x 19.5 is 17.06 CSS px — just over the 16 px that `layoutOverflow.spec.ts`
        // allows between the header and the first content block before it reads as a detached
        // blank band. 0.8125 x 19.5 is 15.84 px.
        pagePaddingTop: "0.8125rem",
        sectionGap: "1.125rem",
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
        rootFontSize: "18px",
        pageMaxWidth: "960px",
        readingMaxWidth: "960px",
        pagePaddingX: "1rem",
        pagePaddingY: "1.25rem",
        pagePaddingTop: "0.75rem",
        sectionGap: "0.875rem",
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
