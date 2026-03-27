/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export type OverlayBounds = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

// Shared overlays use a flat dim layer instead of blur so the modal surface stands out
// without making obscured content smear or visually vibrate behind it.
export const STANDARD_DIM_OPACITY = 0.3;
export const APP_INTERSTITIAL_BACKDROP_CLASSNAME = "bg-black/30";

export const APP_SHEET_TOP_CLEARANCE =
  "max(calc(var(--app-bar-height, 3.5rem) + 0.5rem), calc(env(safe-area-inset-top) + 0.75rem))";

const APP_SHEET_TOP_CLEARANCE_FALLBACK_PX = 96;

/**
 * §badge-safe-zone — the minimum margin between the badge boundary and any overlay top edge.
 */
export const BADGE_SAFE_ZONE_MARGIN_PX = 8;

export const OVERLAY_SAFE_ZONE_GAP_PX = 8;

export const resolveAppSheetTopClearancePx = () => {
  if (typeof window === "undefined") return APP_SHEET_TOP_CLEARANCE_FALLBACK_PX;

  const appBarHeight = Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue("--app-bar-height"),
  );

  const resolvedAppBarHeight = Number.isFinite(appBarHeight) ? appBarHeight : 88;
  return Math.max(APP_SHEET_TOP_CLEARANCE_FALLBACK_PX, Math.round(resolvedAppBarHeight + BADGE_SAFE_ZONE_MARGIN_PX));
};

export const getBadgeSafeZone = (): OverlayBounds | null => {
  if (typeof document === "undefined") return null;

  const badge = document.querySelector<HTMLElement>("[data-testid='unified-health-badge']");
  if (!badge) return null;

  const rect = badge.getBoundingClientRect();
  return {
    top: Math.max(0, rect.top - BADGE_SAFE_ZONE_MARGIN_PX),
    right: rect.right + BADGE_SAFE_ZONE_MARGIN_PX,
    bottom: rect.bottom + BADGE_SAFE_ZONE_MARGIN_PX,
    left: Math.max(0, rect.left - BADGE_SAFE_ZONE_MARGIN_PX),
  };
};

/**
 * Returns the bottom Y pixel coordinate of the badge safe zone.
 * No overlay top edge may appear above this value.
 */
export const getBadgeSafeZoneBottomPx = (): number => {
  const safeZone = getBadgeSafeZone();
  if (safeZone) {
    return Math.max(APP_SHEET_TOP_CLEARANCE_FALLBACK_PX, Math.round(safeZone.bottom));
  }
  return resolveAppSheetTopClearancePx();
};

export const resolveCenteredOverlayLayout = (
  contentHeight: number,
  viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight,
) => {
  const minTop = getBadgeSafeZoneBottomPx() + OVERLAY_SAFE_ZONE_GAP_PX;
  const centeredTop = Math.round((viewportHeight - contentHeight) / 2);
  const top = Math.max(minTop, centeredTop);
  const maxHeight = Math.max(160, viewportHeight - top - 12);

  return { top, maxHeight };
};

/**
 * Development-mode assertion: logs an error when an overlay's top edge violates the badge safe zone.
 * Silent in production builds.
 */
export const assertOverlayRespectsBadgeSafeZone = (topPxOrBounds: number | OverlayBounds, name = "overlay"): void => {
  if (process.env.NODE_ENV === "production") return;

  const safeZoneBottom = getBadgeSafeZoneBottomPx();
  const topPx = typeof topPxOrBounds === "number" ? topPxOrBounds : topPxOrBounds.top;

  if (topPx < safeZoneBottom) {
    console.error(
      `[c64] Badge safe zone violation: "${name}" top=${topPx}px is above safe zone bottom=${safeZoneBottom}px. ` +
        `All overlays must satisfy top >= OVERLAY_MAX_TOP (${safeZoneBottom}px).`,
    );
  }

  if (typeof topPxOrBounds === "number") return;

  const safeZone = getBadgeSafeZone();
  if (!safeZone) return;

  const intersects = !(
    topPxOrBounds.right <= safeZone.left ||
    topPxOrBounds.left >= safeZone.right ||
    topPxOrBounds.bottom <= safeZone.top ||
    topPxOrBounds.top >= safeZone.bottom
  );

  if (intersects) {
    console.error(
      `[c64] Badge safe zone intersection: "${name}" overlaps the badge safe zone. ` +
        `Overlay bounds=${JSON.stringify(topPxOrBounds)} safeZone=${JSON.stringify(safeZone)}.`,
    );
  }
};
