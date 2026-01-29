import { getParentPath } from '@/lib/playback/localFileBrowser';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';

export const SONGLENGTHS_FILE_NAMES = ['songlengths.md5', 'songlengths.txt'];
export const DOCUMENTS_FOLDER = 'DOCUMENTS';

export const isSonglengthsFileName = (name: string) =>
  SONGLENGTHS_FILE_NAMES.includes(name.trim().toLowerCase());

const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

export const buildSonglengthsSearchPaths = (path: string) => {
  const normalized = normalizeLocalPath(path || '/');
  const folder = normalized.endsWith('/') ? normalized : normalized.slice(0, normalized.lastIndexOf('/') + 1);
  const paths: string[] = [];
  let current = folder || '/';
  while (current) {
    const base = current.endsWith('/') ? current : `${current}/`;
    SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
      paths.push(`${base}${fileName}`);
      paths.push(`${base}${DOCUMENTS_FOLDER}/${fileName}`);
    });
    if (base === '/') break;
    current = getParentPath(base);
  }
  return paths;
};

export const collectSonglengthsSearchPaths = (paths: string[]) => {
  const set = new Set<string>();
  paths.forEach((path) => {
    buildSonglengthsSearchPaths(path).forEach((candidate) => {
      set.add(normalizeSourcePath(candidate));
    });
  });
  return Array.from(set);
};
