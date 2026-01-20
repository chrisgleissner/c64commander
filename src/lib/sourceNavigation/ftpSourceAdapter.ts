import { listFtpDirectory } from '@/lib/ftp/ftpClient';
import { getStoredFtpPort } from '@/lib/ftp/ftpConfig';
import type { SourceEntry, SourceLocation } from './types';

const listEntries = async (path: string): Promise<SourceEntry[]> => {
  const host = localStorage.getItem('c64u_device_host') || 'c64u';
  const password = localStorage.getItem('c64u_password') || '';
  const result = await listFtpDirectory({
    host,
    port: getStoredFtpPort(),
    password,
    path,
  });
  return (result.entries || []).map((entry) => ({
    type: entry.type,
    name: entry.name,
    path: entry.path,
    sizeBytes: entry.size ?? null,
    modifiedAt: entry.modifiedAt ?? null,
  }));
};

const listFilesRecursive = async (path: string): Promise<SourceEntry[]> => {
  const queue = [path || '/'];
  const visited = new Set<string>();
  const results: SourceEntry[] = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current || visited.has(current)) continue;
    visited.add(current);
    const entries = await listEntries(current);
    entries.forEach((entry) => {
      if (entry.type === 'dir') {
        queue.push(entry.path);
      } else {
        results.push(entry);
      }
    });
  }
  return results;
};

export const createUltimateSourceLocation = (): SourceLocation => ({
  id: 'ultimate',
  type: 'ultimate',
  name: 'C64 Ultimate',
  rootPath: '/',
  isAvailable: true,
  listEntries,
  listFilesRecursive,
});