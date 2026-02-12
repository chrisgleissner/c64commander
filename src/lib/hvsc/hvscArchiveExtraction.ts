/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Unzip, UnzipInflate, unzipSync } from 'fflate';
import { addErrorLog, addLog } from '@/lib/logging';

type SevenZipFactory = (options: { locateFile: (url: string) => string }) => Promise<any> | any;

type ArchiveEntryHandler = (path: string, data: Uint8Array) => Promise<void> | void;

type ExtractArchiveOptions = {
  archiveName: string;
  buffer: Uint8Array;
  onEntry: ArchiveEntryHandler;
  onProgress?: (processed: number, total?: number) => void;
  onEnumerate?: (total: number) => void;
};

const SEVEN_Z_EXTENSION = '.7z';
const ZIP_EXTENSION = '.zip';

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\/+/, '');

const readHeapUsageBytes = () => {
  if (typeof performance !== 'undefined' && 'memory' in performance) {
    const perf = performance as Performance & { memory?: { usedJSHeapSize?: number } };
    return perf.memory?.usedJSHeapSize ?? null;
  }
  if (typeof process !== 'undefined' && typeof process.memoryUsage === 'function') {
    return process.memoryUsage().heapUsed;
  }
  return null;
};

let sevenZipModulePromise: ReturnType<SevenZipFactory> | null = null;

const getSevenZipModule = async () => {
  if (!sevenZipModulePromise) {
    const initPromise = (async () => {
      const { default: SevenZip } = await import('7z-wasm');
      let wasmUrl = new URL('7z-wasm/7zz.wasm', import.meta.url).toString();
      if (typeof process !== 'undefined' && process.versions?.node) {
        const [{ createRequire }, { pathToFileURL }] = await Promise.all([
          import('module'),
          import('url'),
        ]);
        const require = createRequire(import.meta.url);
        const wasmPath = require.resolve('7z-wasm/7zz.wasm');
        wasmUrl = pathToFileURL(wasmPath).toString();
      }
      return (SevenZip as SevenZipFactory)({
        locateFile: (url) => (url.endsWith('.wasm') ? wasmUrl : url),
      });
    })();
    sevenZipModulePromise = initPromise.catch((error) => {
      sevenZipModulePromise = null;
      throw error;
    });
  }
  return sevenZipModulePromise;
};

const extractZip = async ({ buffer, onEntry, onProgress, onEnumerate }: ExtractArchiveOptions) => {
  const heapBefore = readHeapUsageBytes();
  const files = await new Promise<Array<{ path: string; data: Uint8Array }>>((resolve, reject) => {
    const extracted: Array<{ path: string; data: Uint8Array }> = [];
    const unzip = new Unzip((entry) => {
      const fileChunks: Uint8Array[] = [];
      entry.ondata = (error, chunk, final) => {
        if (error) {
          reject(error);
          return;
        }
        if (chunk && chunk.length) {
          fileChunks.push(chunk);
        }
        if (!final) return;
        const totalLength = fileChunks.reduce((sum, current) => sum + current.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        fileChunks.forEach((part) => {
          merged.set(part, offset);
          offset += part.length;
        });
        extracted.push({ path: normalizePath(entry.name), data: merged });
      };
      entry.start();
    });
    unzip.register(UnzipInflate);

    if (buffer.length === 0) {
      unzip.push(new Uint8Array(0), true);
    }

    const chunkSize = 256 * 1024;
    for (let offset = 0; offset < buffer.length; offset += chunkSize) {
      const chunk = buffer.subarray(offset, Math.min(buffer.length, offset + chunkSize));
      unzip.push(chunk, offset + chunk.length >= buffer.length);
    }

    resolve(extracted);
  });

  const total = files.length;
  onEnumerate?.(total);
  let processed = 0;
  for (const file of files) {
    processed += 1;
    await onEntry(file.path, file.data);
    onProgress?.(processed, total);
    if (processed % 50 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  if (total === 0) {
    throw new Error('Zip archive contained no extractable entries');
  }
  const heapAfter = readHeapUsageBytes();
  addLog('info', 'HVSC zip extraction memory profile', {
    totalEntries: total,
    heapBefore,
    heapAfter,
    heapDelta: (heapBefore !== null && heapAfter !== null) ? heapAfter - heapBefore : null,
  });
};

const extractSevenZ = async ({ archiveName, buffer, onEntry, onProgress, onEnumerate }: ExtractArchiveOptions) => {
  const heapBefore = readHeapUsageBytes();
  const module = await getSevenZipModule();
  const workingDir = `/work-${Date.now()}-${Math.round(Math.random() * 1e6)}`;
  const archivePath = `${workingDir}/${normalizePath(archiveName) || `archive${SEVEN_Z_EXTENSION}`}`;
  const outputDir = `${workingDir}/out`;

  const cleanupDir = (dir: string) => {
    const entries = module.FS.readdir(dir);
    entries.forEach((entry: string) => {
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

    const exitCode = module.callMain(['x', archivePath, `-o${outputDir}`, '-y']);
    if (exitCode && exitCode !== 0) {
      throw new Error(`7zip exited with code ${exitCode}`);
    }

    const files: Array<{ path: string; fullPath: string }> = [];
    const walkDir = (dir: string, prefix: string) => {
      const entries = module.FS.readdir(dir);
      entries.forEach((entry: string) => {
        if (entry === '.' || entry === '..') return;
        const fullPath = `${dir}/${entry}`;
        const stat = module.FS.stat(fullPath);
        if (module.FS.isDir(stat.mode)) {
          walkDir(fullPath, `${prefix}${entry}/`);
        } else {
          files.push({ path: `${prefix}${entry}`, fullPath });
        }
      });
    };
    walkDir(outputDir, '');

    let processed = 0;
    const total = files.length;
    onEnumerate?.(total);
    const batchSize = 100;
    for (let index = 0; index < files.length; index += batchSize) {
      const batch = files.slice(index, index + batchSize);
      for (const file of batch) {
        processed += 1;
        const data = module.FS.readFile(file.fullPath, { encoding: 'binary' }) as Uint8Array;
        await onEntry(normalizePath(file.path), data);
        try {
          module.FS.unlink(file.fullPath);
        } catch (unlinkError) {
          addErrorLog('SevenZip post-entry cleanup failed', {
            step: 'unlink-extracted-file',
            path: file.fullPath,
            error: (unlinkError as Error).message,
          });
        }
        onProgress?.(processed, total);
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const heapAfter = readHeapUsageBytes();
    addLog('info', 'HVSC 7z extraction memory profile', {
      archiveName,
      totalEntries: total,
      heapBefore,
      heapAfter,
      heapDelta: (heapBefore !== null && heapAfter !== null) ? heapAfter - heapBefore : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to extract ${archiveName}: ${message}`);
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

export const extractArchiveEntries = async (options: ExtractArchiveOptions) => {
  const lowered = options.archiveName.toLowerCase();
  if (lowered.endsWith(ZIP_EXTENSION)) {
    return extractZip(options);
  }
  if (lowered.endsWith(SEVEN_Z_EXTENSION)) {
    try {
      return await extractSevenZ(options);
    } catch (error) {
      try {
        return await extractZip(options);
      } catch (fallbackError) {
        addErrorLog('7z fallback zip extraction failed', {
          archiveName: options.archiveName,
          error: (fallbackError as Error).message,
        });
      }
      throw error;
    }
  }
  throw new Error(`Unsupported archive format: ${options.archiveName}`);
};
