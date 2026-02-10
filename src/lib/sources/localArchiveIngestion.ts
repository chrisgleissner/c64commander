/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { unzipSync } from 'fflate';
import { addErrorLog } from '@/lib/logging';
import type { LocalSidFile } from './LocalFsSongSource';

export type LocalArchiveIngestionResult = {
  files: LocalSidFile[];
  archiveCount: number;
  extractedCount: number;
};

const SID_EXTENSION = '.sid';
const ZIP_EXTENSION = '.zip';
const SEVEN_Z_EXTENSION = '.7z';

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\/+/, '');

const toArrayBuffer = (data: Uint8Array) => {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
};

const isSidFile = (name: string) => name.toLowerCase().endsWith(SID_EXTENSION);
const isZipFile = (name: string) => name.toLowerCase().endsWith(ZIP_EXTENSION);
const isSevenZFile = (name: string) => name.toLowerCase().endsWith(SEVEN_Z_EXTENSION);

export const isSupportedLocalArchive = (name: string) => isZipFile(name) || isSevenZFile(name);

const buildExtractedFile = (archiveName: string, entryPath: string, data: Uint8Array): LocalSidFile => {
  const normalized = normalizePath(entryPath);
  const name = normalized.split('/').pop() || normalized;
  const snapshot = new Uint8Array(data);
  return {
    name,
    webkitRelativePath: `/${archiveName}/${normalized}`,
    lastModified: Date.now(),
    arrayBuffer: async () => toArrayBuffer(snapshot),
  };
};

const readArchiveBuffer = async (archive: LocalSidFile): Promise<ArrayBuffer> => {
  if (typeof (archive as LocalSidFile).arrayBuffer === 'function') {
    return archive.arrayBuffer();
  }
  if (archive instanceof Blob) {
    return new Response(archive).arrayBuffer();
  }
  throw new Error('Selected file does not support arrayBuffer.');
};

const extractZipArchive = async (archive: LocalSidFile): Promise<LocalSidFile[]> => {
  try {
    const buffer = await readArchiveBuffer(archive);
    const entries = unzipSync(new Uint8Array(buffer));
    const results: LocalSidFile[] = [];
    Object.entries(entries).forEach(([path, data]) => {
      if (!isSidFile(path)) return;
      results.push(buildExtractedFile(archive.name, path, data));
    });
    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to extract ${archive.name}: ${message}`);
  }
};

type SevenZipFactory = (options: { locateFile: (url: string) => string }) => Promise<any> | any;

let sevenZipModulePromise: ReturnType<SevenZipFactory> | null = null;

const getSevenZipModule = async () => {
  if (!sevenZipModulePromise) {
    const { default: SevenZip } = await import('7z-wasm');
    const wasmUrl = new URL('7z-wasm/7zz.wasm', import.meta.url).toString();
    sevenZipModulePromise = (SevenZip as SevenZipFactory)({
      locateFile: (url) => (url.endsWith('.wasm') ? wasmUrl : url),
    });
  }
  return sevenZipModulePromise;
};

const extractSevenZArchive = async (archive: LocalSidFile): Promise<LocalSidFile[]> => {
  const module = await getSevenZipModule();
  const buffer = new Uint8Array(await readArchiveBuffer(archive));
  const workingDir = `/work-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const archiveName = normalizePath(archive.name) || `archive${SEVEN_Z_EXTENSION}`;
  const archivePath = `${workingDir}/${archiveName}`;
  const outputDir = `${workingDir}/out`;

  const cleanupDir = (dir: string) => {
    const entries = module.FS.readdir(dir);
    entries.forEach((entry) => {
      if (entry === '.' || entry === '..') return;
      const fullPath = `${dir}/${entry}`;
      const stat = module.FS.stat(fullPath);
      if (module.FS.isDir(stat.mode)) {
        cleanupDir(fullPath);
        module.FS.rmdir(fullPath);
      } else {
        module.FS.unlink(fullPath);
      }
    });
  };

  try {
    module.FS.mkdir(workingDir);
    module.FS.mkdir(outputDir);
    const stream = module.FS.open(archivePath, 'w+');
    module.FS.write(stream, buffer, 0, buffer.length);
    module.FS.close(stream);

    module.callMain(['x', archivePath, `-o${outputDir}`, '-y']);

    const results: LocalSidFile[] = [];
    const walkDir = (dir: string, prefix: string) => {
      const entries = module.FS.readdir(dir);
      entries.forEach((entry) => {
        if (entry === '.' || entry === '..') return;
        const fullPath = `${dir}/${entry}`;
        const stat = module.FS.stat(fullPath);
        if (module.FS.isDir(stat.mode)) {
          walkDir(fullPath, `${prefix}${entry}/`);
          return;
        }
        if (!isSidFile(entry)) return;
        const data = module.FS.readFile(fullPath, { encoding: 'binary' }) as Uint8Array;
        results.push(buildExtractedFile(archive.name, `${prefix}${entry}`, data));
      });
    };
    walkDir(outputDir, '');
    return results;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to extract ${archive.name}: ${message}`);
  } finally {
    try {
      cleanupDir(outputDir);
    } catch (error) {
      addErrorLog('SevenZip cleanup failed', {
        error: (error as Error).message,
        step: 'cleanupDir',
      });
    }
    try {
      module.FS.rmdir(outputDir);
    } catch (error) {
      addErrorLog('SevenZip cleanup failed', {
        error: (error as Error).message,
        step: 'rmdir-output',
      });
    }
    try {
      module.FS.unlink(archivePath);
    } catch (error) {
      addErrorLog('SevenZip cleanup failed', {
        error: (error as Error).message,
        step: 'unlink-archive',
      });
    }
    try {
      module.FS.rmdir(workingDir);
    } catch (error) {
      addErrorLog('SevenZip cleanup failed', {
        error: (error as Error).message,
        step: 'rmdir-workdir',
      });
    }
  }
};

export const ingestLocalArchives = async (files: LocalSidFile[]): Promise<LocalArchiveIngestionResult> => {
  const direct: LocalSidFile[] = [];
  const archives: LocalSidFile[] = [];
  files.forEach((file) => {
    if (isSidFile(file.name)) {
      direct.push(file);
    } else if (isSupportedLocalArchive(file.name)) {
      archives.push(file);
    }
  });

  const extracted: LocalSidFile[] = [];
  for (const archive of archives) {
    if (isZipFile(archive.name)) {
      extracted.push(...(await extractZipArchive(archive)));
    } else if (isSevenZFile(archive.name)) {
      extracted.push(...(await extractSevenZArchive(archive)));
    }
  }

  return {
    files: [...direct, ...extracted],
    archiveCount: archives.length,
    extractedCount: extracted.length,
  };
};
