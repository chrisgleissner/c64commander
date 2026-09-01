/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export class SafeAreaWeb {
  async setSystemBarsVisibility(): Promise<void> {
    // The browser owns its own chrome; there are no app-controlled system bars.
  }

  async setSystemBarsAppearance(): Promise<void> {
    // The browser owns its own chrome; there are no app-controlled system bars.
  }
}
