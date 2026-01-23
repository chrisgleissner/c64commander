import { FolderPicker } from '@/lib/native/folderPicker';
import { getPlatform } from '@/lib/native/platform';
import { addLog } from '@/lib/logging';
import { redactTreeUri } from '@/lib/native/safUtils';
import { normalizeSourcePath } from './paths';

export type LocalSourceEntry = {
  name: string;
  relativePath: string;
  uri?: string | null;
  sizeBytes?: number | null;
  modifiedAt?: string | null;
};

export type LocalSourceRecord = {
  id: string;
  name: string;
  rootName: string | null;
  rootPath: string;
  createdAt: string;
  entries: LocalSourceEntry[];
  android?: {
    treeUri: string;
    rootName: string | null;
    permissionGrantedAt: string;
  };
  requiresReselect?: boolean;
};

export type LocalSourceBuildResult = {
  source: LocalSourceRecord;
  runtimeFiles: Record<string, File>;
};

const STORE_KEY = 'c64u_local_sources:v1';

const runtimeFilesBySource = new Map<string, Record<string, File>>();

const safeRandomId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const normalizeRootName = (value: string | null | undefined) => {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const buildRootPath = (rootName: string | null) => {
  if (!rootName) return '/';
  const normalized = normalizeSourcePath(rootName);
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
};

export const loadLocalSources = (): LocalSourceRecord[] => {
  if (typeof localStorage === 'undefined') return [];
  const raw = localStorage.getItem(STORE_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as LocalSourceRecord[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

export const saveLocalSources = (sources: LocalSourceRecord[]) => {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(STORE_KEY, JSON.stringify(sources));
};

export const setLocalSourceRuntimeFiles = (sourceId: string, files: Record<string, File>) => {
  runtimeFilesBySource.set(sourceId, files);
};

export const getLocalSourceRuntimeFile = (sourceId: string, path: string) => {
  const normalized = normalizeSourcePath(path);
  return runtimeFilesBySource.get(sourceId)?.[normalized];
};

export const createLocalSourceFromFileList = (files: FileList | File[], label?: string): LocalSourceBuildResult => {
  const list = Array.from(files);
  const first = list[0] as File & { webkitRelativePath?: string };
  const rootName = first?.webkitRelativePath?.split('/')?.[0] || label || 'Folder';
  const rootPath = buildRootPath(rootName);
  const sourceId = safeRandomId();
  const createdAt = new Date().toISOString();
  const runtimeFiles: Record<string, File> = {};
  const entries: LocalSourceEntry[] = list.map((file) => {
    const relative = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const withLabel = label && !relative.includes('/') ? `${label}/${relative}` : relative;
    const relativePath = withLabel.replace(/^\/+/, '');
    const normalizedPath = normalizeSourcePath(relativePath);
    runtimeFiles[normalizedPath] = file;
    return {
      name: file.name,
      relativePath,
      sizeBytes: file.size,
      modifiedAt: new Date(file.lastModified).toISOString(),
    };
  });
  const source: LocalSourceRecord = {
    id: sourceId,
    name: rootName,
    rootName,
    rootPath,
    createdAt,
    entries,
  };
  return { source, runtimeFiles };
};

export const prepareDirectoryInput = (input: HTMLInputElement | null) => {
  if (!input) return;
  input.setAttribute('webkitdirectory', '');
  input.setAttribute('directory', '');
};

export const createLocalSourceFromPicker = async (input: HTMLInputElement | null): Promise<LocalSourceBuildResult | null> => {
  if (getPlatform() === 'android') {
    addLog('debug', 'SAF picker invoked', { platform: 'android' });
    let result: Awaited<ReturnType<typeof FolderPicker.pickDirectory>>;
    try {
      result = await FolderPicker.pickDirectory();
    } catch (error) {
      addLog('debug', 'SAF picker failed', { error: (error as Error).message });
      throw error;
    }
    const treeUri = result?.treeUri;
    if (!treeUri || result?.files != null) {
      addLog('debug', 'Android SAF picker rejected non-SAF response', {
        treeUri: redactTreeUri(treeUri),
        hasEntries: Array.isArray(result?.files),
      });
      throw new Error('Android SAF picker returned an unsupported response.');
    }
    const rootName = normalizeRootName(result?.rootName);
    const sourceId = safeRandomId();
    const createdAt = new Date().toISOString();
    addLog('debug', 'SAF tree URI received', {
      treeUri: redactTreeUri(treeUri),
      rootName,
      permissionPersisted: result?.permissionPersisted === true,
    });
    if (!result?.permissionPersisted) {
      addLog('debug', 'SAF persistable permission missing', { treeUri: redactTreeUri(treeUri) });
      throw new Error('Folder access permission could not be persisted.');
    }
    addLog('debug', 'SAF persistable permission granted', { treeUri: redactTreeUri(treeUri) });
    const source: LocalSourceRecord = {
      id: sourceId,
      name: rootName || 'This device',
      rootName,
      rootPath: '/',
      createdAt,
      entries: [],
      android: {
        treeUri,
        rootName,
        permissionGrantedAt: createdAt,
      },
    };
    return { source, runtimeFiles: {} };
  }

  const picker = (window as Window & { showDirectoryPicker?: () => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  if (!picker) {
    input?.click();
    return null;
  }

  const directoryHandle = await picker();
  const files: File[] = [];
  const walkDirectory = async (dirHandle: FileSystemDirectoryHandle, prefix: string) => {
    for await (const [name, handle] of (dirHandle as any).entries()) {
      if ((handle as FileSystemHandle).kind === 'file') {
        const file = await (handle as FileSystemFileHandle).getFile();
        Object.defineProperty(file, 'webkitRelativePath', {
          value: `${prefix}${name}`,
        });
        files.push(file);
      } else if ((handle as FileSystemHandle).kind === 'directory') {
        await walkDirectory(handle as FileSystemDirectoryHandle, `${prefix}${name}/`);
      }
    }
  };

  await walkDirectory(directoryHandle, '');
  return createLocalSourceFromFileList(files, directoryHandle.name);
};
