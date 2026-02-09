/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import { addErrorLog } from '@/lib/logging';

export type SonglengthsData = {
  // Values are 1-based sub-tune durations (index 0 is song #1).
  pathToSeconds: Map<string, number[]>;
  md5ToSeconds: Map<string, number[]>;
};

const normalizePath = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

const resolveDuration = (durations: number[] | undefined, songNr?: number | null) => {
  if (!durations || durations.length === 0) return null;
  const index = songNr && songNr > 0 ? songNr - 1 : 0;
  if (index < 0 || index >= durations.length) return null;
  return durations[index] ?? null;
};

export const resolveSonglengthsSeconds = (
  data: SonglengthsData | null | undefined,
  path: string,
  md5?: string | null,
  songNr?: number | null,
) => {
  if (!data) return null;

  const normalizedPath = normalizePath(path || '/');
  const pathMatch = resolveDuration(data.pathToSeconds.get(normalizedPath), songNr);
  if (pathMatch !== null) return pathMatch;

  if (!md5) return null;
  const md5Match = resolveDuration(data.md5ToSeconds.get(md5.trim().toLowerCase()), songNr);
  return md5Match !== null ? md5Match : null;
};

export const countSonglengthsEntries = (data: SonglengthsData | null | undefined) => {
  if (!data) return 0;
  return Math.max(data.pathToSeconds.size, data.md5ToSeconds.size);
};

export const resolveSonglengthsDurationMs = async (
  data: SonglengthsData | null | undefined,
  path: string,
  file?: LocalPlayFile | null,
  songNr?: number | null,
) => {
  if (!data) return null;

  const seconds = resolveSonglengthsSeconds(data, path, null, songNr);
  if (seconds !== null) return seconds * 1000;
  if (!file) return null;

  try {
    const buffer = await file.arrayBuffer();
    const { computeSidMd5 } = await import('@/lib/sid/sidUtils');
    const md5 = await computeSidMd5(buffer);
    const md5Seconds = resolveSonglengthsSeconds(data, path, md5, songNr);
    return md5Seconds !== null ? md5Seconds * 1000 : null;
  } catch (error) {
    addErrorLog('Failed to resolve SID duration via songlengths MD5', {
      error: (error as Error).message,
      path,
      songNr: songNr ?? null,
    });
    return null;
  }
};

const parseTimeToSeconds = (value: string) => {
  const parts = value.split(':');
  if (!parts.length) return null;
  const minutes = Number(parts[0]);
  if (Number.isNaN(minutes)) return null;
  const secondsPart = parts[1] ?? '0';
  const secondsSplit = secondsPart.split('.');
  const seconds = Number(secondsSplit[0] ?? '0');
  const fraction = Number((secondsSplit[1] ?? '').padEnd(3, '0').slice(0, 3));
  if (Number.isNaN(seconds) || Number.isNaN(fraction)) return null;
  const totalMs = (minutes * 60 + seconds) * 1000 + fraction;
  return Math.round(totalMs / 1000);
};

const parseDurations = (value: string) => {
  const durations: number[] = [];
  const tokens = value.trim().split(/\s+/).filter(Boolean);
  tokens.forEach((token) => {
    // Old-format Songlengths.txt tokens may include attributes like 0:06(G)
    const match = token.match(/^(\d+:\d{2}(?:\.\d{1,3})?)/);
    if (!match) return;
    const seconds = parseTimeToSeconds(match[1]);
    if (seconds === null) return;
    durations.push(seconds);
  });
  return durations;
};

export const parseSonglengths = (content: string): SonglengthsData => {
  const pathToSeconds = new Map<string, number[]>();
  const md5ToSeconds = new Map<string, number[]>();
  let currentPath = '';

  const lines = content.split(/\r?\n/);
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    const firstChar = line.charCodeAt(0);
    if (firstChar === 59 || firstChar === 35 || firstChar === 58) {
      const path = line.replace(/^[:;#]+/, '').trim();
      if (path) currentPath = normalizePath(path);
      return;
    }
    if (firstChar === 91) return;

    const eqIndex = line.indexOf('=');
    if (eqIndex > 0) {
      const md5 = line.slice(0, eqIndex).trim().toLowerCase();
      const value = line.slice(eqIndex + 1).trim();
      if (!md5 || !value) return;
      const durations = parseDurations(value);
      if (!durations.length) return;
      if (currentPath) {
        pathToSeconds.set(currentPath, durations);
      }
      md5ToSeconds.set(md5, durations);
      return;
    }

    // Legacy/non-HVSC format: "<path> <mm:ss[.SSS]> [<mm:ss[.SSS]> ...]"
    let splitIndex = -1;
    for (let i = 0; i < line.length; i += 1) {
      const code = line.charCodeAt(i);
      if (code === 32 || code === 9) {
        splitIndex = i;
        break;
      }
    }
    if (splitIndex <= 0) return;
    const path = line.slice(0, splitIndex).trim();
    const value = line.slice(splitIndex + 1).trim();
    if (!path || !value) return;
    const durations = parseDurations(value);
    if (!durations.length) return;
    pathToSeconds.set(normalizePath(path), durations);
  });

  return { pathToSeconds, md5ToSeconds };
};
