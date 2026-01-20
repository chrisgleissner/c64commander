export type PlayFileCategory = 'sid' | 'mod' | 'prg' | 'crt' | 'disk' | 'volume';

const normalizeExtension = (value: string) => value.replace(/^\./, '').toLowerCase();

const SID_EXTENSIONS = new Set(['sid']);
const MOD_EXTENSIONS = new Set(['mod']);
const PRG_EXTENSIONS = new Set(['prg']);
const CRT_EXTENSIONS = new Set(['crt']);
export const DISK_IMAGE_EXTENSIONS = new Set(['d64', 'g64', 'd71', 'g71', 'd81']);
const VOLUME_IMAGE_EXTENSIONS = new Set(['dnp', 'p64', 'gcr', 'nib']);

export const SUPPORTED_PLAY_EXTENSIONS = new Set([
  ...SID_EXTENSIONS,
  ...MOD_EXTENSIONS,
  ...PRG_EXTENSIONS,
  ...CRT_EXTENSIONS,
  ...DISK_IMAGE_EXTENSIONS,
  ...VOLUME_IMAGE_EXTENSIONS,
]);

export const getFileExtension = (value: string) => {
  const base = value.split('/').pop() || value;
  const idx = base.lastIndexOf('.');
  if (idx < 0) return '';
  return normalizeExtension(base.slice(idx + 1));
};

export const isSupportedPlayFile = (value: string) => SUPPORTED_PLAY_EXTENSIONS.has(getFileExtension(value));

export const getPlayCategory = (value: string): PlayFileCategory | null => {
  const ext = getFileExtension(value);
  if (SID_EXTENSIONS.has(ext)) return 'sid';
  if (MOD_EXTENSIONS.has(ext)) return 'mod';
  if (PRG_EXTENSIONS.has(ext)) return 'prg';
  if (CRT_EXTENSIONS.has(ext)) return 'crt';
  if (DISK_IMAGE_EXTENSIONS.has(ext)) return 'disk';
  if (VOLUME_IMAGE_EXTENSIONS.has(ext)) return 'volume';
  return null;
};

export const getMountTypeForExtension = (value: string) => {
  const ext = getFileExtension(value);
  if (DISK_IMAGE_EXTENSIONS.has(ext)) return ext;
  return undefined;
};

export const formatPlayCategory = (category: PlayFileCategory) => {
  switch (category) {
    case 'sid':
      return 'SID music';
    case 'mod':
      return 'MOD music';
    case 'prg':
      return 'PRG program';
    case 'crt':
      return 'CRT cartridge';
    case 'disk':
      return 'Disk image';
    case 'volume':
      return 'Volume image';
    default:
      return 'File';
  }
};
