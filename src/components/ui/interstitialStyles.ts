/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// Dimming is kept intentionally light: backdrops separate focus without masking connectivity state.
// Opacity is held ~30% below the perceptual threshold that would suppress the health badge.
export const APP_INTERSTITIAL_BACKDROP_CLASSNAME =
  "bg-black/22 supports-[backdrop-filter]:bg-black/17 backdrop-blur-[1px]";

export const APP_SHEET_TOP_CLEARANCE =
  "max(calc(var(--app-bar-height, 3.5rem) + 0.5rem), calc(env(safe-area-inset-top) + 0.75rem))";

const APP_SHEET_TOP_CLEARANCE_FALLBACK_PX = 96;

/**
 * §badge-safe-zone — the minimum margin between the badge boundary and any overlay top edge.
 */
export const BADGE_SAFE_ZONE_MARGIN_PX = 8;

export const resolveAppSheetTopClearancePx = () => {
  if (typeof window === "undefined") return APP_SHEET_TOP_CLEARANCE_FALLBACK_PX;

  const appBarHeight = Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue("--app-bar-height"),
  );

  const resolvedAppBarHeight = Number.isFinite(appBarHeight) ? appBarHeight : 88;
  return Math.max(APP_SHEET_TOP_CLEARANCE_FALLBACK_PX, Math.round(resolvedAppBarHeight + BADGE_SAFE_ZONE_MARGIN_PX));
};

/**
 * Returns the bottom Y pixel coordinate of the badge safe zone.
 * No overlay top edge may appear above this value.
 */
export const getBadgeSafeZoneBottomPx = (): number => resolveAppSheetTopClearancePx();

/**
 * Development-mode assertion: logs an error when an overlay's top edge violates the badge safe zone.
 * Silent in production builds.
 */
export const assertOverlayRespectsBadgeSafeZone = (topPx: number, name = "overlay"): void => {
  if (process.env.NODE_ENV === "production") return;
  const safeZoneBottom = getBadgeSafeZoneBottomPx();
  if (topPx < safeZoneBottom) {
    console.error(
      `[c64] Badge safe zone violation: "${name}" top=${topPx}px is above safe zone bottom=${safeZoneBottom}px. ` +
      `All overlays must satisfy top >= OVERLAY_MAX_TOP (${safeZoneBottom}px).`,
    );
  }
};
