import { registerPlugin } from '@capacitor/core';
import { addLog } from '@/lib/logging';
import { getPlatform } from '@/lib/native/platform';

export type PickedFolderEntry = {
  uri: string;
  name: string;
  path: string;
};

export type SafFolderEntry = {
  type: 'file' | 'dir';
  name: string;
  path: string;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type SafPersistedUri = {
  uri: string;
  read: boolean;
  write: boolean;
  persistedAt?: number | null;
};

export type FolderPickerDirectoryResult = {
  treeUri?: string;
  rootName?: string | null;
  permissionPersisted?: boolean;
  files?: PickedFolderEntry[];
  uri?: string;
};

export type FolderPickerFileResult = {
  uri?: string;
  name?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
  permissionPersisted?: boolean;
  parentTreeUri?: string | null;
  parentRootName?: string | null;
};

type FolderPickerPlugin = {
  pickDirectory: (options?: { extensions?: string[] }) => Promise<FolderPickerDirectoryResult>;
  pickFile: (options?: { extensions?: string[]; mimeTypes?: string[]; initialUri?: string }) => Promise<FolderPickerFileResult>;
  listChildren: (options: { treeUri: string; path?: string }) => Promise<{ entries: SafFolderEntry[] }>;
  getPersistedUris: () => Promise<{ uris: SafPersistedUri[] }>;
  readFile: (options: { uri: string }) => Promise<{ data: string }>;
  readFileFromTree: (options: { treeUri: string; path: string }) => Promise<{ data: string }>;
  writeFileToTree: (options: {
    treeUri: string;
    path: string;
    data: string;
    mimeType?: string;
    overwrite?: boolean;
  }) => Promise<{ uri: string; sizeBytes: number; modifiedAt?: string | null }>;
};

type FolderPickerOverride = Partial<FolderPickerPlugin>;

const allowAndroidOverride = () =>
  import.meta.env.VITE_ENABLE_TEST_PROBES === '1'
  && typeof window !== 'undefined'
  && (window as Window & { __c64uAllowAndroidFolderPickerOverride?: boolean }).__c64uAllowAndroidFolderPickerOverride === true;

const resolveOverride = (): FolderPickerOverride | null => {
  if (typeof window === 'undefined') return null;
  const candidate = (window as Window & { __c64uFolderPickerOverride?: FolderPickerOverride }).__c64uFolderPickerOverride;
  return candidate ?? null;
};

const resolveOverrideMethod = <K extends keyof FolderPickerPlugin>(method: K) => {
  const override = resolveOverride();
  const candidate = override?.[method];
  if (!candidate) return null;
  if (getPlatform() !== 'android' || allowAndroidOverride()) return candidate;
  addLog('debug', 'Android SAF override blocked', { method });
  throw new Error('Android SAF picker is required.');
};

const plugin = registerPlugin<FolderPickerPlugin>('FolderPicker');

export const FolderPicker: FolderPickerPlugin = {
  pickDirectory: (options) => {
    const override = resolveOverrideMethod('pickDirectory');
    if (override) return override(options);
    return plugin.pickDirectory(options);
  },
  pickFile: (options) => {
    const override = resolveOverrideMethod('pickFile');
    if (override) return override(options);
    return plugin.pickFile(options);
  },
  listChildren: (options) => {
    const override = resolveOverrideMethod('listChildren');
    if (override) return override(options);
    return plugin.listChildren(options);
  },
  getPersistedUris: () => {
    const override = resolveOverrideMethod('getPersistedUris');
    if (override) return override();
    return plugin.getPersistedUris();
  },
  readFile: (options) => {
    const override = resolveOverrideMethod('readFile');
    if (override) return override(options);
    return plugin.readFile(options);
  },
  readFileFromTree: (options) => {
    const override = resolveOverrideMethod('readFileFromTree');
    if (override) return override(options);
    return plugin.readFileFromTree(options);
  },
  writeFileToTree: (options) => {
    const override = resolveOverrideMethod('writeFileToTree');
    if (override) return override(options);
    return plugin.writeFileToTree(options);
  },
};
