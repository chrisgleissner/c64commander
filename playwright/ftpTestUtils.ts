import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { createMockFtpServer, type MockFtpServer } from '../tests/mocks/mockFtpServer';
import { createMockFtpBridgeServer, type MockFtpBridgeServer } from '../tests/mocks/mockFtpBridgeServer';

export type FtpTestServers = {
  ftpServer: MockFtpServer;
  bridgeServer: MockFtpBridgeServer;
  close: () => Promise<void>;
};

export const startFtpTestServers = async (options?: { password?: string }) => {
  const rootDir = path.resolve('playwright/fixtures/ftp-root');
  const ftpServer = await createMockFtpServer({
    rootDir,
    password: options?.password || '',
  });
  const bridgeServer = await createMockFtpBridgeServer();

  return {
    ftpServer,
    bridgeServer,
    close: async () => {
      await bridgeServer.close();
      await ftpServer.close();
    },
  } as FtpTestServers;
};

export const seedFtpConfig = async (
  page: Page,
  options: { host: string; port: number; bridgeUrl: string; password?: string },
) => {
  await page.addInitScript(
    ({ host, port, bridgeUrl, password }) => {
      localStorage.setItem('c64u_device_host', host);
      localStorage.setItem('c64u_ftp_port', String(port));
      localStorage.setItem('c64u_ftp_bridge_url', bridgeUrl);
      if (password !== undefined) {
        localStorage.setItem('c64u_password', password);
      }
    },
    options,
  );
};
