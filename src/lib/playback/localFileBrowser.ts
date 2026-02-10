/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { LocalPlayFile } from './playbackRouter';

const normalizePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);
const getLocalPath = (file: LocalPlayFile) =>
  normalizePath((file as File).webkitRelativePath || (file as any).webkitRelativePath || (file as any).name);

export const listLocalFolders = (files: LocalPlayFile[], path: string) => {
  const normalized = normalizePath(path || '/');
  const folders = new Set<string>();
  files.forEach((file) => {
    const filePath = getLocalPath(file);
    if (!filePath.startsWith(normalized)) return;
    const suffix = filePath.slice(normalized.length);
    if (!suffix || !suffix.includes('/')) return;
    const nextSegment = suffix.split('/')[0];
    const nextFolder = nextSegment ? `${normalized}${nextSegment}/` : null;
    if (nextFolder) folders.add(normalizePath(nextFolder));
  });
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
};

export const listLocalFiles = (files: LocalPlayFile[], path: string) => {
  const normalized = normalizePath(path || '/');
  return files
    .filter((file) => {
      const filePath = getLocalPath(file);
      if (!filePath.startsWith(normalized)) return false;
      const suffix = filePath.slice(normalized.length);
      return suffix && !suffix.includes('/');
    })
    .map((file) => ({
      file,
      path: getLocalPath(file),
      name: getLocalPath(file).split('/').pop() || (file as any).name,
      sizeBytes: (file as File).size ?? null,
      modifiedAt: (file as File).lastModified ? new Date((file as File).lastModified).toISOString() : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const getParentPath = (path: string) => {
  const normalized = normalizePath(path || '/');
  if (normalized === '/') return '/';
  const trimmed = normalized.replace(/\/$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  return `${trimmed.slice(0, idx)}/`;
};
