/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * The in-app guide's names for the two machines involved, per edition. They mirror the helpers of
 * the same names in scripts/build-manuals.mjs, so the guide and the manual call each thing the same;
 * tests/unit/lib/docs/deviceNames.test.ts fails when the two drift apart. No phone model is named.
 */

export const isKeypadEdition = (variantId: string): boolean => variantId === "c64u-remote";

/** The device that runs the app. */
export const appDeviceName = (variantId: string): string => (isKeypadEdition(variantId) ? "phone" : "phone or tablet");

/** The controlled machine, where its model or connection matters. */
export const targetDeviceShortName = (variantId: string): string =>
  isKeypadEdition(variantId) ? "the Commodore 64 Ultimate" : "the connected Ultimate-family device";

/** Every machine the edition can control. */
export const targetDeviceDescription = (variantId: string): string =>
  isKeypadEdition(variantId)
    ? "a Commodore 64 Ultimate"
    : "a Commodore 64 Ultimate, Ultimate 64, Ultimate 64 Elite, Ultimate 64 Elite II, or Ultimate-II";
