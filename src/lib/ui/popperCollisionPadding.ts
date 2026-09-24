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

/**
 * The room a menu, popover or select list must leave free at each screen edge: the system bars
 * the app draws under, and the keypad guidance bar while it shows. Without it a tall menu flipped above its trigger was placed at y=0, under
 * the status bar's clock and icons, and its available height counted space the user cannot read.
 */
export const resolveSafeAreaCollisionPadding = (): CollisionPadding => {
  if (typeof document === "undefined") return { top: 0, right: 0, bottom: 0, left: 0 };
  const style = getComputedStyle(document.documentElement);
  return {
    top: readInsetPx(style, "--safe-area-inset-top"),
    right: readInsetPx(style, "--safe-area-inset-right"),
    bottom: readInsetPx(style, "--safe-area-inset-bottom") + readKeypadGuidanceReservePx(),
    left: readInsetPx(style, "--safe-area-inset-left"),
  };
};
