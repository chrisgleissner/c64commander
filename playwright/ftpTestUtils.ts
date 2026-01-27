import { promises as fs } from 'node:fs';
import os from 'node:os';
import * as path from 'node:path';
import type { Page } from '@playwright/test';
import { createMockFtpServer, type MockFtpServer } from '../tests/mocks/mockFtpServer';
import { createMockFtpBridgeServer, type MockFtpBridgeServer } from '../tests/mocks/mockFtpBridgeServer';

export type FtpTestServers = {
  ftpServer: MockFtpServer;
  bridgeServer: MockFtpBridgeServer;
  close: () => Promise<void>;
};

const ensureLargeFtpFixture = async (rootDir: string) => {
  const marker = path.join(rootDir, '.fixture-seeded');
  try {
    await fs.access(marker);
    return;
  } catch {
    // continue
  }

  const megaRoot = path.join(rootDir, 'Usb0', 'Games', 'Mega Collection');
  const subFolders = ['Arcade Classics', 'Action Heroes', 'Strategy Vault'];
  await fs.mkdir(megaRoot, { recursive: true });

  const topLevelFiles = Array.from({ length: 40 }, (_, idx) => `Mega Disk ${String(idx + 1).padStart(2, '0')}.d64`);
  await Promise.all(
    topLevelFiles.map((name) => fs.writeFile(path.join(megaRoot, name), 'x', 'utf8')),
  );

  for (const folder of subFolders) {
    const folderPath = path.join(megaRoot, folder);
    await fs.mkdir(folderPath, { recursive: true });
    const files = Array.from({ length: 30 }, (_, idx) => `${folder.replace(/\s+/g, ' ')} ${idx + 1}.d64`);
    await Promise.all(
      files.map((name) => fs.writeFile(path.join(folderPath, name), 'x', 'utf8')),
    );
  }

  const demosRoot = path.join(rootDir, 'Usb0', 'Demos', 'Scroller Showcase');
  await fs.mkdir(demosRoot, { recursive: true });
  const demoFiles = Array.from({ length: 24 }, (_, idx) => `Demo ${idx + 1}.prg`);
  await Promise.all(
    demoFiles.map((name) => fs.writeFile(path.join(demosRoot, name), 'x', 'utf8')),
  );

  await fs.writeFile(marker, new Date().toISOString(), 'utf8');
};

const cloneFtpFixture = async (sourceDir: string) => {
  const tempBase = path.join(os.tmpdir(), 'c64u-ftp-root-');
  const targetDir = await fs.mkdtemp(tempBase);
  await fs.cp(sourceDir, targetDir, { recursive: true });
  return targetDir;
};

export const startFtpTestServers = async (options?: { password?: string }) => {
  const baseRoot = path.resolve('playwright/fixtures/ftp-root');
  const rootDir = await cloneFtpFixture(baseRoot);
  await ensureLargeFtpFixture(rootDir);
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
      localStorage.setItem('c64u_ftp_port', String(port));
      localStorage.setItem('c64u_ftp_bridge_url', bridgeUrl);
      if (password !== undefined) {
        localStorage.setItem('c64u_password', password);
      }
    },
    options,
  );
};
