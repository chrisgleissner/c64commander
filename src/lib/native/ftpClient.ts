/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { registerPlugin } from '@capacitor/core';
import type { NativeTraceContext } from '@/lib/native/nativeTraceContext';

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
  traceContext?: NativeTraceContext;
};

export type FtpReadOptions = {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  path: string;
  traceContext?: NativeTraceContext;
};

export type FtpClientPlugin = {
  listDirectory: (options: FtpListOptions) => Promise<{ entries: FtpEntry[] }>;
  readFile: (options: FtpReadOptions) => Promise<{ data: string; sizeBytes?: number }>;
};

export const FtpClient = registerPlugin<FtpClientPlugin>('FtpClient', {
  web: () => import('./ftpClient.web').then((module) => new module.FtpClientWeb()),
});
