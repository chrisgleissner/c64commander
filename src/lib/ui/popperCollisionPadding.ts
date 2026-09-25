/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { readKeypadGuidanceReservePx } from "@/lib/ui/keypadGuidanceReserve";

export type CollisionPadding = { top: number; right: number; bottom: number; left: number };

const readInsetPx = (style: CSSStyleDeclaration, name: string): number => {
  const value = Number.parseFloat(style.getPropertyValue(name));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

/** Every closed select on a page renders its content wrapper, so the reading is reused briefly. */
const CACHE_MS = 1000;
let cached: { at: number; reserveKey: string; padding: CollisionPadding } | null = null;

/**
 * The room a menu, popover or select list must leave free at each screen edge: the system bars the
 * app draws under, and the keypad guidance bar while it shows. Without it a tall menu was placed at
 * y=0, under the status bar, with a height that counted space the user cannot read.
 */
export const resolveSafeAreaCollisionPadding = (): CollisionPadding => {
  const reserveKey = document.documentElement.style.getPropertyValue("--keypad-guidance-reserved-height");
  const now = Date.now();
  if (cached && cached.reserveKey === reserveKey && now - cached.at < CACHE_MS) return cached.padding;
  const style = getComputedStyle(document.documentElement);
  const padding = {
    top: readInsetPx(style, "--safe-area-inset-top"),
    right: readInsetPx(style, "--safe-area-inset-right"),
    bottom: readInsetPx(style, "--safe-area-inset-bottom") + readKeypadGuidanceReservePx(),
    left: readInsetPx(style, "--safe-area-inset-left"),
  };
  cached = { at: now, reserveKey, padding };
  return padding;
};

export const resetSafeAreaCollisionPaddingForTests = (): void => {
  cached = null;
};
