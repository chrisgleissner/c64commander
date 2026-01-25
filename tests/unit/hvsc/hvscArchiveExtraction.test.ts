import { createWriteStream, existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractArchiveEntries } from '@/lib/hvsc/hvscArchiveExtraction';

const DEFAULT_UPDATE_URL = 'https://hvsc.brona.dk/HVSC/HVSC_Update_84.7z';
const DEFAULT_CACHE_DIR = path.join(os.homedir(), '.cache', 'c64commander', 'hvsc');

const downloadViaHttps = async (url: string, targetPath: string) => {
  const { request } = await import('node:https');
  await new Promise<void>((resolve, reject) => {
    const fileStream = createWriteStream(targetPath);
    const req = request(url, (res) => {
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`Failed to download ${url}: ${res.statusCode} ${res.statusMessage}`));
        return;
      }
      res.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close();
        resolve();
      });
    });
    req.on('error', reject);
    req.end();
  });
};

const downloadViaFetch = async (url: string, targetPath: string) => {
  if (typeof fetch !== 'function') {
    return downloadViaHttps(url, targetPath);
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, new Uint8Array(arrayBuffer));
};

const ensureUpdate84Archive = async () => {
  const cacheDir = process.env.HVSC_UPDATE_84_CACHE ?? DEFAULT_CACHE_DIR;
  const archiveName = 'HVSC_Update_84.7z';
  const archivePath = path.join(cacheDir, archiveName);
  if (!existsSync(archivePath)) {
    await mkdir(cacheDir, { recursive: true });
    const url = process.env.HVSC_UPDATE_84_URL ?? DEFAULT_UPDATE_URL;
    await downloadViaFetch(url, archivePath);
  }
  return archivePath;
};

describe('hvscArchiveExtraction', () => {
  it(
    'extracts HVSC_Update_84.7z fixture',
    async () => {
      const fixturePath = await ensureUpdate84Archive();
      const buffer = new Uint8Array(await readFile(fixturePath));
      const entries: string[] = [];

      await extractArchiveEntries({
        archiveName: 'HVSC_Update_84.7z',
        buffer,
        onEntry: async (entryPath) => {
          entries.push(entryPath);
        },
      });

      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((entry) => entry.toLowerCase().endsWith('.sid'))).toBe(true);
    },
    120000,
  );

  it('rejects unsupported archive formats', async () => {
    await expect(
      extractArchiveEntries({
        archiveName: 'hvsc.rar',
        buffer: new Uint8Array([1, 2, 3]),
        onEntry: async () => undefined,
      }),
    ).rejects.toThrow('Unsupported archive format');
  });
});
