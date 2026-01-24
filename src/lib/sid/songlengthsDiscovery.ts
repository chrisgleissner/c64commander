import { getParentPath } from '@/lib/playback/localFileBrowser';
import { normalizeSourcePath } from '@/lib/sourceNavigation/paths';

export const SONGLENGTHS_FILE_NAME = 'songlengths.md5';
export const DOCUMENTS_FOLDER = 'DOCUMENTS';

const normalizeLocalPath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

export const buildSonglengthsSearchPaths = (path: string) => {
  const normalized = normalizeLocalPath(path || '/');
  const folder = normalized.endsWith('/') ? normalized : normalized.slice(0, normalized.lastIndexOf('/') + 1);
  const paths: string[] = [];
  let current = folder || '/';
  while (current) {
    const base = current.endsWith('/') ? current : `${current}/`;
    paths.push(`${base}${SONGLENGTHS_FILE_NAME}`);
    paths.push(`${base}${DOCUMENTS_FOLDER}/${SONGLENGTHS_FILE_NAME}`);
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
