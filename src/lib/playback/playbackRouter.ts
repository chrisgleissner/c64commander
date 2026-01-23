import { addErrorLog } from '@/lib/logging';
import type { C64API } from '@/lib/c64api';
import { AUTOSTART_SEQUENCE, injectAutostart } from './autostart';
import { formatPlayCategory, getMountTypeForExtension, getPlayCategory, type PlayFileCategory } from './fileTypes';
import { mountDiskToDrive } from '@/lib/disks/diskMount';
import { createDiskEntry } from '@/lib/disks/diskTypes';
import { createSslPayload } from '@/lib/sid/sidUtils';

export type PlaySource = 'local' | 'ultimate';

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

const toBlob = async (file?: LocalPlayFile) => {
  if (!file) return null;
  if (file instanceof Blob) return file;
  const buffer = await file.arrayBuffer();
  return new Blob([buffer], { type: 'application/octet-stream' });
};

export type PlayExecutionOptions = {
  drive?: 'a' | 'b';
  loadMode?: 'run' | 'load';
  resetBeforeMount?: boolean;
  rebootBeforeMount?: boolean;
};

export const executePlayPlan = async (
  api: C64API,
  plan: PlayPlan,
  options: PlayExecutionOptions = {},
) => {
  const drive = options.drive ?? 'a';
  const resetBeforeMount = options.resetBeforeMount ?? true;
  const loadMode = options.loadMode ?? 'run';
  const rebootBeforeMount = options.rebootBeforeMount ?? false;
  const resetDelayMs = 500;

  try {
    switch (plan.category) {
      case 'sid': {
        if (plan.source === 'ultimate') {
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
          await new Promise((resolve) => setTimeout(resolve, resetDelayMs));
        } else if (resetBeforeMount) {
          await api.machineReset();
          await new Promise((resolve) => setTimeout(resolve, resetDelayMs));
        }

        if (plan.source === 'ultimate') {
          const diskEntry = createDiskEntry({
            path: plan.path,
            location: 'ultimate',
          });
          await mountDiskToDrive(api, drive, diskEntry);
        } else if (plan.file) {
          const blob = await toBlob(plan.file);
          if (!blob) throw new Error('Missing local disk data.');
          await api.mountDriveUpload(drive, blob, plan.mountType, 'readwrite');
        } else {
          const diskEntry = createDiskEntry({
            path: plan.path,
            location: 'local',
          });
          await mountDiskToDrive(api, drive, diskEntry);
        }

        await injectAutostart(api, AUTOSTART_SEQUENCE);
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
