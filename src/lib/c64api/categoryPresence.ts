/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which config categories the connected device has.
 *
 * An Ultimate-II+ cartridge has no Audio Mixer, Data Streams or lighting categories, and asking for
 * them answers 404: every Home visit on one sent seven such requests. A category is absent when the
 * device's own category list omits it. Before that list is read, a category that answered 404 is
 * absent. The list wins over a 404, which can be transient. Forgotten on every device change.
 */
export class CategoryPresence {
  private listed: Set<string> | null = null;
  private readonly missing = new Set<string>();

  recordList(categories: unknown) {
    if (Array.isArray(categories)) this.listed = new Set(categories.map(String));
  }

  recordMissing(category: string) {
    this.missing.add(category);
  }

  isAbsent(category: string) {
    return this.listed !== null ? !this.listed.has(category) : this.missing.has(category);
  }

  reset() {
    this.listed = null;
    this.missing.clear();
  }
}
