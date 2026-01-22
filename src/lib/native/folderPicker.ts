import { registerPlugin } from '@capacitor/core';

export type PickedFolderEntry = {
  uri: string;
  name: string;
  path: string;
};

type FolderPickerPlugin = {
  pickDirectory: (options?: { extensions?: string[] }) => Promise<{ uri: string; files: PickedFolderEntry[]; rootName?: string }>;
  readFile: (options: { uri: string }) => Promise<{ data: string }>;
};

type FolderPickerOverride = Partial<FolderPickerPlugin>;

const resolveOverride = (): FolderPickerOverride | null => {
  if (typeof window === 'undefined') return null;
  const candidate = (window as Window & { __c64uFolderPickerOverride?: FolderPickerOverride }).__c64uFolderPickerOverride;
  return candidate ?? null;
};

const plugin = registerPlugin<FolderPickerPlugin>('FolderPicker');

export const FolderPicker: FolderPickerPlugin = {
  pickDirectory: (options) => {
    const override = resolveOverride();
    if (override?.pickDirectory) {
      return override.pickDirectory(options);
    }
    return plugin.pickDirectory(options);
  },
  readFile: (options) => {
    const override = resolveOverride();
    if (override?.readFile) {
      return override.readFile(options);
    }
    return plugin.readFile(options);
  },
};
