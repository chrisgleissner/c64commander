import type { LocalPlayFile } from '@/lib/playback/playbackRouter';
import { computeSidMd5 } from '@/lib/sid/sidUtils';

export type SonglengthsData = {
  pathToSeconds: Map<string, number>;
  md5ToSeconds: Map<string, number>;
};

const normalizePath = (path: string) => {
  const normalized = path.replace(/\\/g, '/');
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
};

export const resolveSonglengthsSeconds = (
  data: SonglengthsData | null | undefined,
  path: string,
  md5?: string | null,
) => {
  if (!data) return null;
  const normalizedPath = normalizePath(path || '/');
  const pathMatch = data.pathToSeconds.get(normalizedPath);
  if (pathMatch !== undefined && pathMatch !== null) return pathMatch;
  if (!md5) return null;
  const md5Match = data.md5ToSeconds.get(md5);
  return md5Match !== undefined && md5Match !== null ? md5Match : null;
};

export const countSonglengthsEntries = (data: SonglengthsData | null | undefined) => {
  if (!data) return 0;
  return Math.max(data.pathToSeconds.size, data.md5ToSeconds.size);
};

export const resolveSonglengthsDurationMs = async (
  data: SonglengthsData | null | undefined,
  path: string,
  file?: LocalPlayFile | null,
) => {
  const seconds = resolveSonglengthsSeconds(data, path, null);
  if (seconds !== null) return seconds * 1000;
  if (!file) return null;
  try {
    const buffer = await file.arrayBuffer();
    const md5 = await computeSidMd5(buffer);
    const md5Seconds = resolveSonglengthsSeconds(data, path, md5);
    return md5Seconds !== null ? md5Seconds * 1000 : null;
  } catch {
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

export const parseSonglengths = (content: string): SonglengthsData => {
  const pathToSeconds = new Map<string, number>();
  const md5ToSeconds = new Map<string, number>();
  let currentPath = '';

  const lines = content.split(/\r?\n/);
  lines.forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith(';') || line.startsWith('#')) {
      const path = line.replace(/^[:;#]+/, '').trim();
      if (path) currentPath = normalizePath(path);
      return;
    }
    if (line.startsWith('[')) return;

    if (line.includes('=')) {
      const parts = line.split('=');
      if (parts.length !== 2) return;
      const md5 = parts[0]?.trim();
      const time = parts[1]?.trim();
      if (!md5 || !time) return;
      const seconds = parseTimeToSeconds(time);
      if (seconds === null) return;
      if (currentPath) {
        pathToSeconds.set(currentPath, seconds);
      }
      md5ToSeconds.set(md5, seconds);
      return;
    }

    const match = line.match(/^(.+?)\s+(\d+:\d{2}(?:\.\d{1,3})?)$/);
    if (!match) return;
    const path = match[1]?.trim();
    const time = match[2]?.trim();
    if (!path || !time) return;
    const seconds = parseTimeToSeconds(time);
    if (seconds === null) return;
    pathToSeconds.set(normalizePath(path), seconds);
  });

  return { pathToSeconds, md5ToSeconds };
};
