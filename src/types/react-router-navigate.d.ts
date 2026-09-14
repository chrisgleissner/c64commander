/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { NavigateOptions, To } from "react-router";

// react-router 7 types navigate() as `void | Promise<void>` because data routers return a promise.
// The app only uses <BrowserRouter>, whose navigate returns nothing, so this is the augmentation
// react-router documents for that router.
declare module "react-router" {
  interface NavigateFunction {
    (to: To, options?: NavigateOptions): void;
    (delta: number): void;
  }
}
