import { registerPlugin } from '@capacitor/core';

export type FtpEntry = {
  name: string;
  path: string;
  type: 'file' | 'dir';
  size?: number;
  modifiedAt?: string | null;
};

export type FtpListOptions = {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  path?: string;
};

export type FtpClientPlugin = {
  listDirectory: (options: FtpListOptions) => Promise<{ entries: FtpEntry[] }>;
};

export const FtpClient = registerPlugin<FtpClientPlugin>('FtpClient', {
  web: () => import('./ftpClient.web').then((module) => new module.FtpClientWeb()),
});
