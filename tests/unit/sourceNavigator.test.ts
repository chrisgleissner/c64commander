import { describe, expect, it } from 'vitest';
import { createLocalScopedSource } from '@/lib/scopedBrowser/localSourceAdapter';
import { ensureWithinRoot, getParentPathWithinRoot, isPathWithinRoot } from '@/lib/scopedBrowser/paths';
import type { LocalSourceRecord } from '@/lib/scopedBrowser/localSourcesStore';

describe('scoped browser paths', () => {
  it('keeps navigation within root', () => {
    expect(isPathWithinRoot('/Root/Sub/', '/Root/')).toBe(true);
    expect(isPathWithinRoot('/Other/', '/Root/')).toBe(false);
    expect(ensureWithinRoot('/Other/', '/Root/')).toBe('/Root/');
  });

  it('stops upward navigation at root', () => {
    expect(getParentPathWithinRoot('/Root/Sub/Folder/', '/Root/')).toBe('/Root/Sub/');
    expect(getParentPathWithinRoot('/Root/', '/Root/')).toBe('/Root/');
  });
});

describe('local scoped source', () => {
  const localSource: LocalSourceRecord = {
    id: 'local-1',
    name: 'Test Folder',
    rootName: 'Test Folder',
    rootPath: '/Test Folder/',
    createdAt: new Date().toISOString(),
    entries: [
      { name: 'Disk 1.d64', relativePath: 'Test Folder/Disk 1.d64' },
      { name: 'Demo.sid', relativePath: 'Test Folder/Sub Folder/Demo.sid' },
    ],
  };

  it('lists folders and files under root', async () => {
    const scoped = createLocalScopedSource(localSource);
    const entries = await scoped.listEntries('/Test Folder/');
    const names = entries.map((entry) => entry.name).sort();
    expect(names).toContain('Disk 1.d64');
    expect(names).toContain('Sub Folder');
  });

  it('lists files recursively for a folder', async () => {
    const scoped = createLocalScopedSource(localSource);
    const entries = await scoped.listFilesRecursive('/Test Folder/Sub Folder/');
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe('Demo.sid');
  });
});