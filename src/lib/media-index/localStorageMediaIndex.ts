/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { MediaEntry, MediaIndex, MediaIndexSnapshot, MediaIndexStorage, MediaType } from './mediaIndex';

const STORAGE_KEY = 'c64u_media_index:v1';

const safeParse = (raw: string | null): MediaIndexSnapshot | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MediaIndexSnapshot;
  } catch {
    return null;
  }
};

export class LocalStorageMediaIndexStorage implements MediaIndexStorage {
  async read(): Promise<MediaIndexSnapshot | null> {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    return safeParse(raw);
  }

  async write(snapshot: MediaIndexSnapshot): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  }
}

export class JsonMediaIndex implements MediaIndex {
  private entries = new Map<string, MediaEntry>();
  private loaded = false;

  constructor(private readonly storage: MediaIndexStorage) {}

  async load(): Promise<void> {
    const snapshot = await this.storage.read();
    this.entries.clear();
    if (snapshot?.entries) {
      snapshot.entries.forEach((entry) => {
        this.entries.set(entry.path, entry);
      });
    }
    this.loaded = true;
  }

  async save(): Promise<void> {
    const snapshot: MediaIndexSnapshot = {
      version: 1,
      updatedAt: new Date().toISOString(),
      entries: Array.from(this.entries.values()),
    };
    await this.storage.write(snapshot);
  }

  async scan(_paths: string[]): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  queryByType(type: MediaType): MediaEntry[] {
    return Array.from(this.entries.values()).filter((entry) => entry.type === type);
  }

  queryByPath(path: string): MediaEntry | null {
    return this.entries.get(path) ?? null;
  }

  getAll(): MediaEntry[] {
    return Array.from(this.entries.values());
  }

  setEntries(entries: MediaEntry[]): void {
    this.entries.clear();
    entries.forEach((entry) => this.entries.set(entry.path, entry));
  }
}
