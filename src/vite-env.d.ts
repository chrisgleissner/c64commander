/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/// <reference types="vite/client" />

declare const __APP_VERSION__: string;
declare const __GIT_SHA__: string;
declare const __BUILD_TIME__: string;
declare const __SW_BUILD_ID__: string;

declare module "*.yaml?raw" {
  const content: string;
  export default content;
}

declare module "*.yml?raw" {
  const content: string;
  export default content;
}
