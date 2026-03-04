/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Directory, Filesystem } from '@capacitor/filesystem';
import { addErrorLog, addLog } from '@/lib/logging';
import { base64ToUint8 } from '@/lib/sid/sidUtils';
import {
  InMemoryTextBackend,
  SongLengthServiceFacade,
  type SongLengthResolveQuery,
  type SongLengthResolution,
  type SongLengthSourceFile,
} from '@/lib/songlengths';

const HVSC_WORK_DIR = 'hvsc';
const HVSC_LIBRARY_DIR = `${HVSC_WORK_DIR}/library`;
const SONG_LENGTH_FILE_PATTERN = /^songlengths\.(md5|txt)$/i;

const backend = new InMemoryTextBackend({
  onRejectedLine: ({ sourceFile, line, raw, reason }) => {
    addLog('warn', 'Songlengths rejected line', {
      service: 'hvsc-songlengths',
      sourceFile,
      line,
      raw,
      reason,
    });
  },
  onAmbiguous: ({ fileName, partialPath, candidateCount, candidates }) => {
    addLog('warn', 'Songlengths ambiguity detected', {
      service: 'hvsc-songlengths',
      fileName,
      partialPath,
      candidateCount,
      candidates,
    });
  },
});
const facade = new SongLengthServiceFacade(backend, { serviceId: 'hvsc-songlengths' });

let hasAttemptedColdStartLoad = false;
let activeLoad: Promise<void> | null = null;

const decodeBase64Text = (raw: string) => {
  try {
    const bytes = base64ToUint8(raw);
    return new TextDecoder().decode(bytes);
  } catch (error) {
    addErrorLog('HVSC songlengths decode fallback used', {
      service: 'hvsc-songlengths',
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
    return raw;
  }
};

const getErrorMessage = (error: unknown) => {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    if ('message' in error && typeof (error as { message?: unknown }).message === 'string') {
      return (error as { message: string }).message;
    }
    if ('error' in error) {
      const nested = (error as { error?: unknown }).error;
      if (typeof nested === 'string') return nested;
      if (nested && typeof nested === 'object' && 'message' in nested && typeof (nested as { message?: unknown }).message === 'string') {
        return (nested as { message: string }).message;
      }
    }
  }
  return String(error ?? '');
};

const isMissingPathError = (error: unknown) =>
  /does not exist|not exist|no such file|not found/i.test(getErrorMessage(error));

const ensureSonglengthDirectory = async (path: string) => {
  try {
    await Filesystem.mkdir({ directory: Directory.Data, path, recursive: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      addLog('debug', 'HVSC songlengths directory missing during bootstrap', {
        service: 'hvsc-songlengths',
        path,
        error: getErrorMessage(error),
      });
      return;
    }
    addLog('warn', 'HVSC songlengths directory bootstrap failed', {
      service: 'hvsc-songlengths',
      path,
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
  }
};

const isReadableFile = async (path: string) => {
  try {
    const stat = await Filesystem.stat({ directory: Directory.Data, path });
    return stat.type === 'file';
  } catch (error) {
    if (isMissingPathError(error)) return false;
    addErrorLog('HVSC songlengths stat failed', {
      service: 'hvsc-songlengths',
      path,
      error: {
        name: (error as Error).name,
        message: (error as Error).message,
        stack: (error as Error).stack,
      },
    });
    return false;
  }
};

const discoverSonglengthFiles = async (): Promise<SongLengthSourceFile[]> => {
  const roots = [HVSC_LIBRARY_DIR, `${HVSC_LIBRARY_DIR}/DOCUMENTS`];
  const discovered: string[] = [];
  await Promise.all(roots.map((rootPath) => ensureSonglengthDirectory(rootPath)));
  await Promise.all(
    roots.map(async (rootPath) => {
      try {
        const listing = await Filesystem.readdir({ directory: Directory.Data, path: rootPath });
        (listing.files ?? []).forEach((entry) => {
          const name = typeof entry === 'string' ? entry : entry.name ?? '';
          if (!name || !SONG_LENGTH_FILE_PATTERN.test(name)) return;
          discovered.push(`${rootPath}/${name}`);
        });
      } catch (error) {
        addLog('debug', 'HVSC songlengths directory unavailable', {
          service: 'hvsc-songlengths',
          rootPath,
          error: (error as Error).message,
        });
      }
    }),
  );

  const sortedPaths = Array.from(new Set(discovered)).sort((a, b) => {
    const aMd5 = a.toLowerCase().endsWith('.md5');
    const bMd5 = b.toLowerCase().endsWith('.md5');
    if (aMd5 && !bMd5) return -1;
    if (!aMd5 && bMd5) return 1;
    return a.localeCompare(b);
  });

  const files: SongLengthSourceFile[] = [];
  for (const path of sortedPaths) {
    const isReadable = await isReadableFile(path);
    if (!isReadable) {
      addLog('debug', 'HVSC songlengths file missing; skipping read', {
        service: 'hvsc-songlengths',
        path,
      });
      continue;
    }
    try {
      const file = await Filesystem.readFile({ directory: Directory.Data, path });
      files.push({
        path,
        content: decodeBase64Text(file.data),
      });
    } catch (error) {
      if (isMissingPathError(error)) {
        addLog('debug', 'HVSC songlengths file disappeared before read', {
          service: 'hvsc-songlengths',
          path,
          error: getErrorMessage(error),
        });
        continue;
      }
      addErrorLog('HVSC songlengths file read failed', {
        service: 'hvsc-songlengths',
        path,
        error: {
          name: (error as Error).name,
          message: (error as Error).message,
          stack: (error as Error).stack,
        },
      });
    }
  }

  const hasMd5 = files.some((file) => file.path.toLowerCase().endsWith('.md5'));
  const hasTxt = files.some((file) => file.path.toLowerCase().endsWith('.txt'));
  const detectedSource = hasMd5 && hasTxt ? 'merged' : hasMd5 ? 'md5' : hasTxt ? 'txt' : 'none';
  addLog('info', 'HVSC songlengths source detected', {
    service: 'hvsc-songlengths',
    detectedSource,
    files: files.map((file) => file.path),
  });
  return files;
};

const loadInternal = async (trigger: 'cold-start' | 'config-change') => {
  if (trigger === 'cold-start') {
    await facade.loadOnColdStart(HVSC_LIBRARY_DIR, discoverSonglengthFiles, 'hvsc-library');
  } else {
    await facade.reloadOnConfigChange(HVSC_LIBRARY_DIR, discoverSonglengthFiles, 'hvsc-library');
  }
};

const runLoad = async (trigger: 'cold-start' | 'config-change') => {
  if (activeLoad) {
    await activeLoad;
    return;
  }
  activeLoad = loadInternal(trigger).finally(() => {
    activeLoad = null;
    hasAttemptedColdStartLoad = true;
  });
  await activeLoad;
};

export const ensureHvscSonglengthsReadyOnColdStart = async () => {
  if (hasAttemptedColdStartLoad) return;
  await runLoad('cold-start');
};

export const reloadHvscSonglengthsOnConfigChange = async () => {
  await runLoad('config-change');
};

export const resolveHvscSonglengthDuration = async (query: SongLengthResolveQuery): Promise<SongLengthResolution> => {
  await ensureHvscSonglengthsReadyOnColdStart();
  return facade.resolveDurationSeconds(query);
};

export const getHvscSonglengthsStats = () => facade.stats();

export const resetHvscSonglengths = (reason = 'manual-reset') => {
  hasAttemptedColdStartLoad = false;
  facade.reset(reason);
};

export const __test__ = {
  decodeBase64Text,
  discoverSonglengthFiles,
  ensureSonglengthDirectory,
  isReadableFile,
  isMissingPathError,
};
