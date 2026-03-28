/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { CSSProperties } from "react";

export type OverlayBounds = {
  top: number;
  right: number;
  bottom: number;
  left: number;
};

export const INTERSTITIAL_Z_INDEX = {
  content: 10,
  backdrop: 200,
  header: 1000,
  surface: 210,
} as const;

export const STANDARD_DIM_OPACITY = 0.4;
export const SECONDARY_DIM_OPACITY = 0.25;
export const TERTIARY_DIM_OPACITY = 0.15;
export const APP_INTERSTITIAL_BACKDROP_CLASSNAME = "bg-black";

const INTERSTITIAL_LAYER_Z_STEP = 20;
const INTERSTITIAL_SURFACE_Z_OFFSET = 10;

const APP_BAR_HEIGHT_FALLBACK_PX = 88;
const MIN_CENTERED_OVERLAY_HEIGHT_PX = 160;
export const MAX_HEADER_OVERLAP_DELTA_PX = 12;
export const OVERLAY_SAFE_ZONE_GAP_PX = 8;

export const resolveInterstitialBackdropOpacity = (depth: number): number => {
  if (depth <= 1) return STANDARD_DIM_OPACITY;
  if (depth === 2) return SECONDARY_DIM_OPACITY;
  return TERTIARY_DIM_OPACITY;
};

export const resolveInterstitialBackdropZIndex = (depth: number): number =>
  INTERSTITIAL_Z_INDEX.backdrop + Math.max(0, depth - 1) * INTERSTITIAL_LAYER_Z_STEP;

export const resolveInterstitialSurfaceZIndex = (depth: number): number =>
  resolveInterstitialBackdropZIndex(depth) + INTERSTITIAL_SURFACE_Z_OFFSET;

export const resolveInterstitialBackdropStyle = (depth: number): CSSProperties => ({
  backgroundColor: `rgb(0 0 0 / ${resolveInterstitialBackdropOpacity(depth)})`,
  zIndex: resolveInterstitialBackdropZIndex(depth),
});

export const resolveInterstitialSurfaceStyle = (depth: number): CSSProperties => ({
  zIndex: resolveInterstitialSurfaceZIndex(depth),
});

const toBounds = (rect: { top: number; right: number; bottom: number; left: number }): OverlayBounds => ({
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
  left: rect.left,
});

const unionBounds = (bounds: OverlayBounds[]): OverlayBounds | null => {
  if (bounds.length === 0) return null;

  return bounds.reduce<OverlayBounds>(
    (combined, entry) => ({
      top: Math.min(combined.top, entry.top),
      right: Math.max(combined.right, entry.right),
      bottom: Math.max(combined.bottom, entry.bottom),
      left: Math.min(combined.left, entry.left),
    }),
    bounds[0],
  );
};

const intersects = (first: OverlayBounds, second: OverlayBounds) =>
  !(
    first.right <= second.left ||
    first.left >= second.right ||
    first.bottom <= second.top ||
    first.top >= second.bottom
  );

const readBounds = (selector: string): OverlayBounds | null => {
  if (typeof document === "undefined") return null;

  const element = document.querySelector<HTMLElement>(selector);
  if (!element) return null;

  return toBounds(element.getBoundingClientRect());
};

const readGroupedBounds = (selector: string): OverlayBounds | null => {
  if (typeof document === "undefined") return null;

  const nodes = Array.from(document.querySelectorAll<HTMLElement>(selector));
  return unionBounds(nodes.map((node) => toBounds(node.getBoundingClientRect())));
};

const readCssNumber = (variableName: string, fallback: number) => {
  if (typeof window === "undefined") return fallback;

  const rawValue = window.getComputedStyle(document.documentElement).getPropertyValue(variableName);
  const parsed = Number.parseFloat(rawValue);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

export const resolveAppBarHeightPx = () => readCssNumber("--app-bar-height", APP_BAR_HEIGHT_FALLBACK_PX);

export const resolveHeaderOverlapDeltaPx = () =>
  Math.min(MAX_HEADER_OVERLAP_DELTA_PX, Math.round(resolveAppBarHeightPx() * 0.15));

export const getAppBarBounds = (): OverlayBounds | null => readBounds("[data-testid='app-bar-row']");

export const getAppBarTitleBounds = (): OverlayBounds | null => readBounds("[data-testid='app-bar-title-zone']");

export const getBadgeBounds = (): OverlayBounds | null => readBounds("[data-testid='unified-health-badge']");

export const getBadgeCriticalBounds = (): OverlayBounds | null =>
  readGroupedBounds("[data-testid='unified-health-badge'] [data-overlay-critical='badge']");

export const getBadgeSafeZone = (): OverlayBounds | null => getBadgeBounds();

export const getBadgeSafeZoneBottomPx = (): number => {
  const badgeBounds = getBadgeBounds();
  if (badgeBounds) {
    return Math.round(badgeBounds.bottom);
  }

  const headerBounds = getAppBarBounds();
  if (headerBounds) {
    return Math.round(headerBounds.bottom);
  }

  return resolveAppBarHeightPx();
};

export const resolveAppSheetTopClearancePx = () =>
  Math.max(0, getBadgeSafeZoneBottomPx() - resolveHeaderOverlapDeltaPx());

export const resolveWorkflowSheetLayout = () => ({
  top: resolveAppSheetTopClearancePx(),
});

export const resolveCenteredOverlayLayout = (
  contentHeight: number,
  viewportHeight = typeof window === "undefined" ? 900 : window.innerHeight,
) => {
  const appBarBounds = getAppBarBounds();
  const minTop = Math.max(
    getBadgeSafeZoneBottomPx() + OVERLAY_SAFE_ZONE_GAP_PX,
    appBarBounds ? Math.round(appBarBounds.bottom) + OVERLAY_SAFE_ZONE_GAP_PX : 0,
  );
  const centeredTop = Math.round((viewportHeight - contentHeight) / 2);
  const top = Math.max(minTop, centeredTop);
  const maxHeight = Math.max(MIN_CENTERED_OVERLAY_HEIGHT_PX, viewportHeight - top - 12);

  return { top, maxHeight };
};

export const boundsFromElement = (element: HTMLElement): OverlayBounds => toBounds(element.getBoundingClientRect());

export const assertOverlayRespectsBadgeSafeZone = (topPxOrBounds: number | OverlayBounds, name = "overlay"): void => {
  if (process.env.NODE_ENV === "production") return;

  const minAllowedTop = resolveAppSheetTopClearancePx();
  const topPx = typeof topPxOrBounds === "number" ? topPxOrBounds : topPxOrBounds.top;

  if (topPx < minAllowedTop) {
    console.error(
      `[c64] Overlay top violation: "${name}" top=${topPx}px is above the allowed sheet top=${minAllowedTop}px. ` +
        `Workflow overlays must satisfy top >= ${minAllowedTop}px.`,
    );
  }

  if (typeof topPxOrBounds === "number") return;

  const titleBounds = getAppBarTitleBounds();
  if (titleBounds && intersects(topPxOrBounds, titleBounds)) {
    console.error(
      `[c64] Header title intersection: "${name}" overlaps the header title zone. ` +
        `Overlay bounds=${JSON.stringify(topPxOrBounds)} title=${JSON.stringify(titleBounds)}.`,
    );
  }

  const badgeCriticalBounds = getBadgeCriticalBounds();
  if (badgeCriticalBounds && intersects(topPxOrBounds, badgeCriticalBounds)) {
    console.error(
      `[c64] Badge text intersection: "${name}" overlaps the badge critical content. ` +
        `Overlay bounds=${JSON.stringify(topPxOrBounds)} badgeCritical=${JSON.stringify(badgeCriticalBounds)}.`,
    );
  }

  const badgeBounds = getBadgeBounds();
  const minimumBorderTop = badgeBounds ? Math.round(badgeBounds.bottom - resolveHeaderOverlapDeltaPx()) : null;
  if (minimumBorderTop !== null && topPx < minimumBorderTop) {
    console.error(
      `[c64] Badge border overlap exceeded: "${name}" top=${topPx}px is above the allowed border overlap line=${minimumBorderTop}px.`,
    );
  }
};
