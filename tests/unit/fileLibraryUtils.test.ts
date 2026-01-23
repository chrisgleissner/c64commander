import { describe, expect, it, vi } from 'vitest';
import { buildFileLibraryId, buildLocalPlayFileFromUri, resolvePlayRequestFromLibrary } from '@/lib/playback/fileLibraryUtils';
import type { FileLibraryEntry } from '@/lib/playback/fileLibraryTypes';

vi.mock('@/lib/native/folderPicker', () => ({
  FolderPicker: {
    readFile: vi.fn(),
  },
}));

const mockFolderPicker = async (data: string) => {
  const { FolderPicker } = await import('@/lib/native/folderPicker');
  (FolderPicker.readFile as ReturnType<typeof vi.fn>).mockResolvedValue({ data });
};

describe('fileLibraryUtils', () => {
  it('builds normalized ids for ultimate and local sources', () => {
    const ultimateId = buildFileLibraryId('ultimate', 'Usb0/Games/Disk 1.d64');
    const localId = buildFileLibraryId('local', '/Local/Demo.sid', 'source-1');

    expect(ultimateId).toBe('ultimate:/Usb0/Games/Disk 1.d64');
    expect(localId).toBe('source-1:/Local/Demo.sid');
  });

  it('builds local play files that read from FolderPicker', async () => {
    await mockFolderPicker(btoa('hello'));
    const file = buildLocalPlayFileFromUri('demo.sid', '/demo.sid', 'content://demo/sid');
    const buffer = await file.arrayBuffer();
    const text = new TextDecoder().decode(new Uint8Array(buffer));

    expect(file.name).toBe('demo.sid');
    expect(file.webkitRelativePath).toBe('/demo.sid');
    expect(text).toBe('hello');
  });

  it('resolves play requests for ultimate entries', () => {
    const entry: FileLibraryEntry = {
      id: 'ultimate:/Usb0/Games/Disk 1.d64',
      source: 'ultimate',
      name: 'Disk 1.d64',
      path: '/Usb0/Games/Disk 1.d64',
      category: 'disk',
      addedAt: new Date().toISOString(),
    };

    const request = resolvePlayRequestFromLibrary(entry, {});
    expect(request).toEqual({ source: 'ultimate', path: entry.path });
  });

  it('uses runtime files when available for local entries', async () => {
    const entry: FileLibraryEntry = {
      id: 'local:/Local/demo.sid',
      source: 'local',
      name: 'demo.sid',
      path: '/Local/demo.sid',
      category: 'sid',
      localUri: 'content://demo/sid',
      addedAt: new Date().toISOString(),
    };
    const runtimeFile = {
      name: 'demo.sid',
      webkitRelativePath: '/Local/demo.sid',
      lastModified: Date.now(),
      arrayBuffer: async () => new ArrayBuffer(0),
    };

    const request = resolvePlayRequestFromLibrary(entry, { [entry.id]: runtimeFile });
    expect(request.source).toBe('local');
    expect(request.path).toBe(entry.path);
    expect(request.file).toBe(runtimeFile);
  });
});
