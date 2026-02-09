/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog } from '@/lib/logging';
import { FolderPicker } from '@/lib/native/folderPicker';
import { getPlatform, isNativePlatform } from '@/lib/native/platform';
import { base64ToUint8 } from '@/lib/sid/sidUtils';
import {
  loadRamDumpFolderConfig,
  saveRamDumpFolderConfig,
  type RamDumpFolderConfig,
  deriveRamDumpFolderDisplayPath,
} from '@/lib/config/ramDumpFolderStore';

const RAM_DUMP_MIME_TYPE = 'application/octet-stream';

const sanitizeRamDumpContext = (value?: string | null) => {
  if (!value) return '';
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '');
  return sanitized;
};

const formatRamDumpTimestamp = (date: Date) => {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, 'Z');
  return iso.replace(/:/g, '-');
};

const uint8ToBase64 = (value: Uint8Array) => {
  let binary = '';
  for (let i = 0; i < value.length; i += 1) {
    binary += String.fromCharCode(value[i]);
  }
  return btoa(binary);
};

const isAndroidNative = () => getPlatform() === 'android' && isNativePlatform();

export type PickedRamDumpFile = {
  name: string;
  sizeBytes: number;
  modifiedAt: string | null;
  bytes: Uint8Array;
  parentFolder: RamDumpFolderConfig | null;
};

const readFileFromPickerResult = async (result: {
  uri?: string;
  name?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  permissionPersisted?: boolean;
  parentTreeUri?: string | null;
  parentRootName?: string | null;
}): Promise<PickedRamDumpFile> => {
  if (!result?.uri) {
    throw new Error('No RAM dump file selected.');
  }
  if (!result.permissionPersisted) {
    throw new Error('RAM dump file permission was not granted.');
  }
  const payload = await FolderPicker.readFile({ uri: result.uri });
  const bytes = base64ToUint8(payload.data);
  const parentFolder = (() => {
    const treeUri = result.parentTreeUri?.trim() ?? '';
    if (!treeUri) return null;
    const displayPath = deriveRamDumpFolderDisplayPath(treeUri, result.parentRootName);
    return {
      treeUri,
      rootName: result.parentRootName?.trim() ? result.parentRootName : null,
      selectedAt: new Date().toISOString(),
      displayPath,
    } satisfies RamDumpFolderConfig;
  })();
  return {
    name: result.name ?? 'ram.bin',
    sizeBytes: result.sizeBytes ?? bytes.length,
    modifiedAt: result.modifiedAt ?? null,
    bytes,
    parentFolder,
  };
};

export const buildRamDumpFileName = (date = new Date(), context?: string | null) => {
  const timestamp = formatRamDumpTimestamp(date);
  const safeContext = sanitizeRamDumpContext(context);
  return `c64u-ram-${timestamp}${safeContext ? `-${safeContext}` : ''}.bin`;
};

export const selectRamDumpFolder = async (): Promise<RamDumpFolderConfig> => {
  if (!isAndroidNative()) {
    throw new Error('RAM dump folders are only supported on Android native builds.');
  }
  const result = await FolderPicker.pickDirectory();
  if (!result?.treeUri || !result.permissionPersisted) {
    throw new Error('Folder access permission could not be persisted.');
  }
  const config: RamDumpFolderConfig = {
    treeUri: result.treeUri,
    rootName: result.rootName?.trim() ? result.rootName : null,
    selectedAt: new Date().toISOString(),
    displayPath: deriveRamDumpFolderDisplayPath(result.treeUri, result.rootName),
  };
  saveRamDumpFolderConfig(config);
  return config;
};

export const ensureRamDumpFolder = async (): Promise<RamDumpFolderConfig> => {
  const existing = loadRamDumpFolderConfig();
  if (existing) return existing;
  return selectRamDumpFolder();
};

export const writeRamDumpToFolder = async (
  folder: RamDumpFolderConfig,
  fileName: string,
  bytes: Uint8Array,
) => {
  if (!isAndroidNative()) {
    throw new Error('RAM dump writing is only supported on Android native builds.');
  }
  try {
    await FolderPicker.writeFileToTree({
      treeUri: folder.treeUri,
      path: `/${fileName}`,
      data: uint8ToBase64(bytes),
      mimeType: RAM_DUMP_MIME_TYPE,
      overwrite: true,
    });
  } catch (error) {
    const err = error as Error;
    addErrorLog('Failed to write RAM dump file', {
      fileName,
      rootName: folder.rootName,
      error: err.message,
    });
    throw new Error(`Failed to write RAM dump file: ${err.message}`);
  }
};

export const pickRamDumpFile = async (
  options: { preferredFolder?: RamDumpFolderConfig } = {},
): Promise<PickedRamDumpFile> => {
  if (isAndroidNative()) {
    const result = await FolderPicker.pickFile({
      extensions: ['bin'],
      mimeTypes: [RAM_DUMP_MIME_TYPE],
      initialUri: options.preferredFolder?.treeUri,
    });
    const picked = await readFileFromPickerResult(result);
    if (!picked.name.toLowerCase().endsWith('.bin')) {
      throw new Error('Select a .bin RAM dump file.');
    }
    return picked;
  }

  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.bin';

  const file = await new Promise<File | null>((resolve) => {
    input.addEventListener('change', () => {
      resolve(input.files?.[0] ?? null);
    }, { once: true });
    input.click();
  });

  if (!file) {
    throw new Error('No RAM dump file selected.');
  }
  if (!file.name.toLowerCase().endsWith('.bin')) {
    throw new Error('Select a .bin RAM dump file.');
  }
  const buffer = await file.arrayBuffer();
  return {
    name: file.name,
    sizeBytes: file.size,
    modifiedAt: file.lastModified ? new Date(file.lastModified).toISOString() : null,
    bytes: new Uint8Array(buffer),
    parentFolder: null,
  };
};
