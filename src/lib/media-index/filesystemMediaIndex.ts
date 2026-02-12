/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Directory, Filesystem } from '@capacitor/filesystem';
import type { MediaIndexSnapshot, MediaIndexStorage } from './mediaIndex';

const STORAGE_PATH = 'hvsc/index/media-index-v2.json';

const encodeUtf8Base64 = (value: string) => {
  if (typeof btoa === 'function') {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    bytes.forEach((byte) => {
      binary += String.fromCharCode(byte);
    });
    return btoa(binary);
  }
  return Buffer.from(value, 'utf-8').toString('base64');
};

const decodeUtf8Base64 = (value: string) => {
  try {
    if (typeof atob === 'function') {
      const binary = atob(value);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
      }
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(value, 'base64').toString('utf-8');
  } catch {
    return value;
  }
};

const safeParse = (raw: string | null): MediaIndexSnapshot | null => {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MediaIndexSnapshot;
  } catch {
    return null;
  }
};

export class FilesystemMediaIndexStorage implements MediaIndexStorage {
  async read(): Promise<MediaIndexSnapshot | null> {
    try {
      const result = await Filesystem.readFile({
        directory: Directory.Data,
        path: STORAGE_PATH,
      });
      const decoded = decodeUtf8Base64(result.data);
      return safeParse(decoded);
    } catch {
      return null;
    }
  }

  async write(snapshot: MediaIndexSnapshot): Promise<void> {
    await Filesystem.mkdir({ directory: Directory.Data, path: 'hvsc/index', recursive: true });
    await Filesystem.writeFile({
      directory: Directory.Data,
      path: STORAGE_PATH,
      data: encodeUtf8Base64(JSON.stringify(snapshot)),
      recursive: true,
    });
  }
}
