import { DISK_IMAGE_EXTENSIONS, getFileExtension } from '@/lib/playback/fileTypes';

export type DiskLocation = 'local' | 'ultimate';

export type DiskEntry = {
  id: string;
  name: string;
  path: string;
  location: DiskLocation;
  group: string | null;
  localUri?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  importedAt: string;
  importOrder?: number | null;
};

export type DiskLocationLabel = 'Local' | 'C64U';

export const normalizeDiskPath = (value: string) => {
  if (!value) return '/';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  const withSlash = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return withSlash.replace(/\/+/g, '/');
};

export const buildDiskId = (location: DiskLocation, path: string) => `${location}:${normalizeDiskPath(path)}`;

export const getDiskName = (path: string) => {
  const normalized = normalizeDiskPath(path);
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] || normalized;
};

export const getDiskFolderPath = (path: string) => {
  const normalized = normalizeDiskPath(path);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length <= 1) return '/';
  return `/${parts.slice(0, -1).join('/')}/`;
};

export const isDiskImagePath = (path: string) => DISK_IMAGE_EXTENSIONS.has(getFileExtension(path));

export const getLeafFolderName = (path: string) => {
  const normalized = normalizeDiskPath(path);
  const parts = normalized.split('/').filter(Boolean);
  if (parts.length === 0) return null;
  if (isDiskImagePath(normalized)) {
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  }
  return parts[parts.length - 1] || null;
};

export const createDiskEntry = (params: {
  path: string;
  location: DiskLocation;
  group?: string | null;
  localUri?: string | null;
  name?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  importOrder?: number | null;
}): DiskEntry => {
  const path = normalizeDiskPath(params.path);
  return {
    id: buildDiskId(params.location, path),
    name: params.name?.trim() || getDiskName(path),
    path,
    location: params.location,
    group: params.group ?? null,
    localUri: params.localUri ?? null,
    sizeBytes: params.sizeBytes ?? null,
    modifiedAt: params.modifiedAt ?? null,
    importedAt: new Date().toISOString(),
    importOrder: params.importOrder ?? null,
  };
};

export const getLocationLabel = (location: DiskLocation): DiskLocationLabel =>
  location === 'local' ? 'Local' : 'C64U';
