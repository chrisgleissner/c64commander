/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Which config categories the connected device has. An Ultimate-II+ cartridge has no Audio Mixer, Data
 * Streams or lighting categories, and every Home visit asked it for seven of them. The device's own
 * list decides; before it is read, a category that answered 404 is absent. Reset on a device change.
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

  /** Whether the device's own list names the category; null before the list is read. */
  lists(category: string): boolean | null {
    return this.listed === null ? null : this.listed.has(category);
  }

  reset() {
    this.listed = null;
    this.missing.clear();
  }
}
