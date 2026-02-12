/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';
import { addLog } from '@/lib/logging';
import { getPlatform } from '@/lib/native/platform';
import { getActiveAction } from '@/lib/tracing/actionTrace';
import { resolveNativeTraceContext, type NativeTraceContext } from '@/lib/native/nativeTraceContext';

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
  pickDirectory: (options?: { extensions?: string[]; traceContext?: NativeTraceContext }) => Promise<FolderPickerDirectoryResult>;
  pickFile: (options?: { extensions?: string[]; mimeTypes?: string[]; initialUri?: string; traceContext?: NativeTraceContext }) => Promise<FolderPickerFileResult>;
  listChildren: (options: { treeUri: string; path?: string; traceContext?: NativeTraceContext }) => Promise<{ entries: SafFolderEntry[] }>;
  getPersistedUris: (options?: { traceContext?: NativeTraceContext }) => Promise<{ uris: SafPersistedUri[] }>;
  readFile: (options: { uri: string; traceContext?: NativeTraceContext }) => Promise<{ data: string }>;
  readFileFromTree: (options: { treeUri: string; path: string; traceContext?: NativeTraceContext }) => Promise<{ data: string }>;
  writeFileToTree: (options: {
    treeUri: string;
    path: string;
    data: string;
    mimeType?: string;
    overwrite?: boolean;
    traceContext?: NativeTraceContext;
  }) => Promise<{ uri: string; sizeBytes: number; modifiedAt?: string | null }>;
};

type FolderPickerOverride = Partial<FolderPickerPlugin>;

const allowAndroidOverride = () => {
  if (typeof window === 'undefined') return false;
  const testProbeEnabled = import.meta.env.VITE_ENABLE_TEST_PROBES === '1'
    || (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled === true;
  return testProbeEnabled
    && (window as Window & { __c64uAllowAndroidFolderPickerOverride?: boolean }).__c64uAllowAndroidFolderPickerOverride === true;
};

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

const withTraceContext = <T extends Record<string, unknown> | undefined>(options: T) => ({
  ...(options ?? {}),
  traceContext: resolveNativeTraceContext(getActiveAction()),
});

const plugin = registerPlugin<FolderPickerPlugin>('FolderPicker');

export const FolderPicker: FolderPickerPlugin = {
  pickDirectory: (options) => {
    const override = resolveOverrideMethod('pickDirectory');
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.pickDirectory(withTrace);
  },
  pickFile: (options) => {
    const override = resolveOverrideMethod('pickFile');
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.pickFile(withTrace);
  },
  listChildren: (options) => {
    const override = resolveOverrideMethod('listChildren');
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.listChildren(withTrace);
  },
  getPersistedUris: (options) => {
    const override = resolveOverrideMethod('getPersistedUris');
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.getPersistedUris(withTrace);
  },
  readFile: (options) => {
    const override = resolveOverrideMethod('readFile');
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.readFile(withTrace);
  },
  readFileFromTree: (options) => {
    const override = resolveOverrideMethod('readFileFromTree');
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.readFileFromTree(withTrace);
  },
  writeFileToTree: (options) => {
    const override = resolveOverrideMethod('writeFileToTree');
    const withTrace = withTraceContext(options);
    if (override) return override(withTrace);
    return plugin.writeFileToTree(withTrace);
  },
};
