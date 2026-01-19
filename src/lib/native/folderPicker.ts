import { registerPlugin } from '@capacitor/core';

export type PickedFolderEntry = {
  uri: string;
  name: string;
  path: string;
};

type FolderPickerPlugin = {
  pickDirectory: () => Promise<{ uri: string; files: PickedFolderEntry[] }>;
  readFile: (options: { uri: string }) => Promise<{ data: string }>;
};

export const FolderPicker = registerPlugin<FolderPickerPlugin>('FolderPicker');
