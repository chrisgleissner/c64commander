/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { getParentPath } from "@/lib/playback/localFileBrowser";
import { normalizeSourcePath } from "@/lib/sourceNavigation/paths";

export const SONGLENGTHS_FILE_NAMES = ["songlengths.md5", "songlengths.txt"];
export const DOCUMENTS_FOLDER = "DOCUMENTS";
export const HVSC_FOLDER = "HVSC";
const SIBLING_LIBRARY_DOCUMENTS_FOLDERS = [`${HVSC_FOLDER}/${DOCUMENTS_FOLDER}/`, `${HVSC_FOLDER}/C64Music/${DOCUMENTS_FOLDER}/`];

export const isSonglengthsFileName = (name: string) => SONGLENGTHS_FILE_NAMES.includes(name.trim().toLowerCase());

const normalizeLocalPath = (path: string) => (path.startsWith("/") ? path : `/${path}`);

export const buildSonglengthsSearchFolders = (path: string) => {
  const normalized = normalizeLocalPath(path || "/");
  const folder = normalized.endsWith("/") ? normalized : normalized.slice(0, normalized.lastIndexOf("/") + 1);
  const folders = new Set<string>();
  let current = folder || "/";
  while (current) {
    const base = normalizeSourcePath(current.endsWith("/") ? current : `${current}/`);
    folders.add(base);
    folders.add(normalizeSourcePath(`${base}${DOCUMENTS_FOLDER}/`));
    if (!base.toLowerCase().includes(`/${HVSC_FOLDER.toLowerCase()}/`)) {
      SIBLING_LIBRARY_DOCUMENTS_FOLDERS.forEach((relativeFolder) => {
        folders.add(normalizeSourcePath(`${base}${relativeFolder}`));
      });
    }
    if (base === "/") break;
    current = getParentPath(base);
  }
  return Array.from(folders);
};

export const buildSonglengthsSearchPaths = (path: string) => {
  const paths: string[] = [];
  buildSonglengthsSearchFolders(path).forEach((base) => {
    SONGLENGTHS_FILE_NAMES.forEach((fileName) => {
      paths.push(`${base}${fileName}`);
    });
  });
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
