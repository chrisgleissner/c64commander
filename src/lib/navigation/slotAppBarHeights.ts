/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const slotAppBarHeights = new Map<number, string>();

export const rememberSlotAppBarHeight = (pageIndex: number, height: string): void => {
  slotAppBarHeights.set(pageIndex, height);
};

/** The header height a tab slot last held, so a rebuilt page starts with it rather than the root default. */
export const rememberedSlotAppBarHeight = (pageIndex: number): string | undefined => slotAppBarHeights.get(pageIndex);
