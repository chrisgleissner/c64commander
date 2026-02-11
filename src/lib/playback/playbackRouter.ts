/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from '@/lib/logging';
import type { C64API } from '@/lib/c64api';
import { getC64APIConfigSnapshot } from '@/lib/c64api';
import { readFtpFile } from '@/lib/ftp/ftpClient';
import { getStoredFtpPort } from '@/lib/ftp/ftpConfig';
import { normalizeFtpHost } from '@/lib/sourceNavigation/ftpSourceAdapter';
import { AUTOSTART_SEQUENCE, injectAutostart } from './autostart';
import {
  formatPlayCategory,
  getFileExtension,
  getMountTypeForExtension,
  getPlayCategory,
  type PlayFileCategory,
} from './fileTypes';
import { mountDiskToDrive, resolveLocalDiskBlob } from '@/lib/disks/diskMount';
import { createDiskEntry } from '@/lib/disks/diskTypes';
import { base64ToUint8, createSslPayload } from '@/lib/sid/sidUtils';
import { loadDiskAutostartMode, type DiskAutostartMode } from '@/lib/config/appSettings';
import { loadFirstDiskPrgViaDma, type DiskImageType } from './diskFirstPrg';

export type PlaySource = 'local' | 'ultimate' | 'hvsc';

export type LocalPlayFile = File | {
  name: string;
  webkitRelativePath?: string;
  lastModified: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

export type PlayRequest = {
  source: PlaySource;
  path: string;
  file?: LocalPlayFile;
  songNr?: number;
  durationMs?: number;
};

export type PlayPlan = {
  category: PlayFileCategory;
  source: PlaySource;
  path: string;
  mountType?: string;
  file?: LocalPlayFile;
  songNr?: number;
  durationMs?: number;
};

export const buildPlayPlan = (request: PlayRequest): PlayPlan => {
  const category = getPlayCategory(request.path);
  if (!category) {
    throw new Error('Unsupported file format.');
  }
  return {
    category,
    source: request.source,
    path: request.path,
    file: request.file,
    mountType: getMountTypeForExtension(request.path),
    songNr: request.songNr,
    durationMs: request.durationMs,
  };
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const normalizeUltimatePath = (path: string) => (path.startsWith('/') ? path : `/${path}`);

export const tryFetchUltimateSidBlob = async (path: string) => {
  const normalizedPath = normalizeUltimatePath(path);
  const { deviceHost: rawHost, password = '' } = getC64APIConfigSnapshot();
  const host = normalizeFtpHost(rawHost);
  try {
    const response = await readFtpFile({
      host,
      port: getStoredFtpPort(),
      password,
      path: normalizedPath,
    });
    const bytes = base64ToUint8(response.data);
    if (typeof response.sizeBytes === 'number' && response.sizeBytes !== bytes.length) {
      addLog('warn', 'FTP SID payload size mismatch', {
        path: normalizedPath,
        expectedBytes: response.sizeBytes,
        actualBytes: bytes.length,
      });
      return null;
    }
    return new Blob([bytes], { type: 'application/octet-stream' });
  } catch (error) {
    addLog('debug', 'FTP SID fetch failed', {
      path: normalizedPath,
      error: (error as Error).message,
    });
    return null;
  }
};

const injectDiskAutostart = async (api: C64API, payload: Uint8Array) => {
  const baseDelayMs = 250;
  const maxAttempts = 4;
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      await delay(baseDelayMs * Math.pow(1.6, attempt - 1));
    } else {
      await delay(baseDelayMs);
    }
    try {
      await injectAutostart(api, payload, { pollIntervalMs: 140, maxAttempts: 20 });
      addLog('info', 'Disk autostart injected', { attempt: attempt + 1 });
      return;
    } catch (error) {
      lastError = error as Error;
      addLog('debug', 'Disk autostart retry', { attempt: attempt + 1, error: lastError.message });
    }
  }
  addErrorLog('Disk autostart failed', { error: lastError?.message ?? 'Unknown error' });
  throw new Error('Disk autostart failed. Try again after the disk finishes mounting.');
};

const toBlob = async (file?: LocalPlayFile) => {
  if (!file) return null;
  if (file instanceof Blob) return file;
  try {
    const buffer = await file.arrayBuffer();
    return new Blob([buffer], { type: 'application/octet-stream' });
  } catch (error) {
    const message = (error as Error).message || 'Local file unavailable.';
    const isNetworkFailure = /failed to fetch|networkerror|network request failed/i.test(message);
    if (isNetworkFailure) {
      throw new Error('Local file unavailable. Re-add it to the playlist.');
    }
    throw error;
  }
};

export type PlayExecutionOptions = {
  drive?: 'a' | 'b';
  loadMode?: 'run' | 'load';
  resetBeforeMount?: boolean;
  rebootBeforeMount?: boolean;
  diskAutostartMode?: DiskAutostartMode;
};

export const executePlayPlan = async (
  api: C64API,
  plan: PlayPlan,
  options: PlayExecutionOptions = {},
) => {
  const drive = options.drive ?? 'a';
  const loadMode = options.loadMode ?? 'run';
  const rebootBeforeMount = options.rebootBeforeMount ?? false;
  const resetBeforeMount = options.resetBeforeMount ?? true;
  const resetDelayMs = 500;
  const diskAutostartMode = options.diskAutostartMode ?? loadDiskAutostartMode();

  try {
    switch (plan.category) {
      case 'sid': {
        if (plan.source === 'ultimate') {
          const hasDuration = Boolean(plan.durationMs && plan.durationMs > 0);
          if (hasDuration) {
            const ftpBlob = await tryFetchUltimateSidBlob(plan.path);
            if (ftpBlob) {
              const sslBlob = new Blob([createSslPayload(plan.durationMs!)], { type: 'application/octet-stream' });
              await api.playSidUpload(ftpBlob, plan.songNr, sslBlob);
              return;
            }
          }
          await api.playSid(plan.path, plan.songNr);
          return;
        }
        const blob = await toBlob(plan.file);
        if (!blob) throw new Error('Missing local SID data.');
        const sslBlob = plan.durationMs && plan.durationMs > 0
          ? new Blob([createSslPayload(plan.durationMs)], { type: 'application/octet-stream' })
          : undefined;
        await api.playSidUpload(blob, plan.songNr, sslBlob);
        return;
      }
      case 'mod': {
        if (plan.source === 'ultimate') {
          await api.playMod(plan.path);
          return;
        }
        const blob = await toBlob(plan.file);
        if (!blob) throw new Error('Missing local MOD data.');
        await api.playModUpload(blob);
        return;
      }
      case 'prg': {
        if (plan.source === 'ultimate') {
          if (loadMode === 'load') {
            await api.loadPrg(plan.path);
          } else {
            await api.runPrg(plan.path);
          }
          return;
        }
        const blob = await toBlob(plan.file);
        if (!blob) throw new Error('Missing local PRG data.');
        if (loadMode === 'load') {
          await api.loadPrgUpload(blob);
        } else {
          await api.runPrgUpload(blob);
        }
        return;
      }
      case 'crt': {
        if (plan.source === 'ultimate') {
          await api.runCartridge(plan.path);
          return;
        }
        const blob = await toBlob(plan.file);
        if (!blob) throw new Error('Missing local CRT data.');
        await api.runCartridgeUpload(blob);
        return;
      }
      case 'disk': {
        if (rebootBeforeMount) {
          await api.machineReboot();
          await delay(resetDelayMs);
        } else if (resetBeforeMount) {
          await api.machineReset();
          await delay(resetDelayMs);
        }

        let localBlob: Blob | null = null;

        if (plan.source === 'ultimate') {
          const diskEntry = createDiskEntry({
            path: plan.path,
            location: 'ultimate',
          });
          await mountDiskToDrive(api, drive, diskEntry);
        } else if (plan.file) {
          localBlob = await toBlob(plan.file);
          if (!localBlob) throw new Error('Missing local disk data.');
          await api.mountDriveUpload(drive, localBlob, plan.mountType, 'readwrite');
        } else {
          const diskEntry = createDiskEntry({
            path: plan.path,
            location: 'local',
          });
          await mountDiskToDrive(api, drive, diskEntry);
        }

        const diskType = getFileExtension(plan.path);
        const dmaEligible =
          diskAutostartMode === 'dma'
          && plan.source === 'local'
          && (diskType === 'd64' || diskType === 'd71' || diskType === 'd81')
          && localBlob;

        if (dmaEligible) {
          const image = new Uint8Array(await localBlob.arrayBuffer());
          await loadFirstDiskPrgViaDma(api, image, diskType as DiskImageType);
        } else if (
          diskAutostartMode === 'dma'
          && plan.source === 'local'
          && !localBlob
          && (diskType === 'd64' || diskType === 'd71' || diskType === 'd81')
        ) {
          const diskEntry = createDiskEntry({
            path: plan.path,
            location: 'local',
          });
          try {
            const blob = await resolveLocalDiskBlob(diskEntry);
            const image = new Uint8Array(await blob.arrayBuffer());
            await loadFirstDiskPrgViaDma(api, image, diskType as DiskImageType);
          } catch (error) {
            addLog('warn', 'DMA disk autostart fallback to injection', {
              path: plan.path,
              error: (error as Error).message,
            });
            await injectDiskAutostart(api, AUTOSTART_SEQUENCE);
          }
        } else {
          await injectDiskAutostart(api, AUTOSTART_SEQUENCE);
        }
        return;
      }
      default: {
        const categoryLabel = formatPlayCategory(plan.category);
        throw new Error(`Unsupported playback type: ${categoryLabel}`);
      }
    }
  } catch (error) {
    addErrorLog('Playback failed', {
      source: plan.source,
      path: plan.path,
      category: plan.category,
      error: (error as Error).message,
    });
    throw error;
  }
};
