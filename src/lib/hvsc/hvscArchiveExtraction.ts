import { unzipSync } from 'fflate';
import { addErrorLog } from '@/lib/logging';

type SevenZipFactory = (options: { locateFile: (url: string) => string }) => Promise<any> | any;

type ArchiveEntryHandler = (path: string, data: Uint8Array) => Promise<void> | void;

type ExtractArchiveOptions = {
  archiveName: string;
  buffer: Uint8Array;
  onEntry: ArchiveEntryHandler;
  onProgress?: (processed: number, total?: number) => void;
};

const SEVEN_Z_EXTENSION = '.7z';
const ZIP_EXTENSION = '.zip';

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/^\/+/, '');

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

const extractZip = async ({ buffer, onEntry, onProgress }: ExtractArchiveOptions) => {
  const entries = unzipSync(buffer);
  const files = Object.entries(entries).filter(([, data]) => data instanceof Uint8Array);
  let processed = 0;
  const total = files.length;
  for (const [path, data] of files) {
    processed += 1;
    await onEntry(normalizePath(path), data as Uint8Array);
    onProgress?.(processed, total);
  }
};

const extractSevenZ = async ({ archiveName, buffer, onEntry, onProgress }: ExtractArchiveOptions) => {
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

    module.callMain(['x', archivePath, `-o${outputDir}`, '-y']);

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
    for (const file of files) {
      processed += 1;
      const data = module.FS.readFile(file.fullPath, { encoding: 'binary' }) as Uint8Array;
      await onEntry(normalizePath(file.path), data);
      onProgress?.(processed, total);
    }
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
    return extractSevenZ(options);
  }
  throw new Error(`Unsupported archive format: ${options.archiveName}`);
};
