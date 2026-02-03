import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tracing/traceSession', () => ({
  exportTraceZip: vi.fn(() => new Uint8Array([1, 2, 3])),
  getTraceEvents: vi.fn(() => [{ id: 'trace-1', type: 'rest', origin: 'user' }]),
  buildAppMetadata: vi.fn(() => ({ appVersion: '1.0.0', platform: 'web' })),
}));

vi.mock('@capacitor/share', () => ({
  Share: {
    share: vi.fn()
  }
}));

vi.mock('@capacitor/filesystem', () => ({
  Filesystem: {
    writeFile: vi.fn(),
    getUri: vi.fn()
  },
  Directory: {
    Cache: 'CACHE'
  }
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: {
    isNativePlatform: vi.fn()
  }
}));

import { buildTraceZipBlob, downloadTraceZip, shareTraceZip } from '@/lib/tracing/traceExport';
import { exportTraceZip } from '@/lib/tracing/traceSession';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';

describe('traceExport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('builds a zip blob', () => {
    const blob = buildTraceZipBlob();
    expect(blob.type).toBe('application/zip');
    expect(vi.mocked(exportTraceZip)).toHaveBeenCalled();
  });

  it('builds a redacted zip blob', () => {
    const blob = buildTraceZipBlob({ redacted: true });
    expect(blob.type).toBe('application/zip');
  });

  it('downloads and revokes trace zip URL', () => {
    const createSpy = vi.fn(() => 'blob:trace');
    const revokeSpy = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', { value: createSpy, configurable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeSpy, configurable: true });
    // Mock anchor click
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    vi.useFakeTimers();

    downloadTraceZip('traces.zip');

    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(revokeSpy).toHaveBeenCalledWith('blob:trace');
  });

  describe('shareTraceZip', () => {
    it('calls downloadTraceZip logic on web', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
      
      const createSpy = vi.fn(() => 'blob:trace');
      Object.defineProperty(URL, 'createObjectURL', { value: createSpy, configurable: true });
      const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
      
      await shareTraceZip('web-trace.zip');
      
      expect(createSpy).toHaveBeenCalled();
      expect(clickSpy).toHaveBeenCalled();
    });

    it('uses Filesystem and Share on native', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Filesystem.writeFile).mockResolvedValue({ uri: 'file://path' });
      vi.mocked(Filesystem.getUri).mockResolvedValue({ uri: 'file://path' });
      vi.mocked(Share.share).mockResolvedValue({ activityType: 'test' }); // fix return type if needed
      
      await shareTraceZip('native-trace.zip');
      
      expect(Filesystem.writeFile).toHaveBeenCalledWith(expect.objectContaining({
          path: 'native-trace.zip',
          directory: Directory.Cache
      }));
      expect(Filesystem.getUri).toHaveBeenCalledWith(expect.objectContaining({
          path: 'native-trace.zip',
          directory: Directory.Cache
      }));
      expect(Share.share).toHaveBeenCalledWith(expect.objectContaining({
          files: ['file://path']
      }));
    });

    it('handles errors on native', async () => {
      vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
      vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error('Write failed'));
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      
      await expect(shareTraceZip('fail.zip')).rejects.toThrow('Write failed');
      expect(consoleSpy).toHaveBeenCalledWith('Failed to share trace:', expect.any(Error));
    });
  });
});
