/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { SafeAreaInsets } from "./safeArea";

export class SafeAreaWeb {
  async getInsets(): Promise<SafeAreaInsets> {
    return {
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    };
  }
}
