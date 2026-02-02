import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/tracing/traceSession', () => ({
  exportTraceZip: vi.fn(() => new Uint8Array([1, 2, 3])),
  getTraceEvents: vi.fn(() => [{ id: 'trace-1', type: 'rest', origin: 'user' }]),
  buildAppMetadata: vi.fn(() => ({ appVersion: '1.0.0', platform: 'web' })),
}));

import { buildTraceZipBlob, downloadTraceZip } from '@/lib/tracing/traceExport';
import { exportTraceZip } from '@/lib/tracing/traceSession';

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
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    vi.useFakeTimers();

    downloadTraceZip('traces.zip');

    expect(createSpy).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    vi.advanceTimersByTime(5000);
    expect(revokeSpy).toHaveBeenCalledWith('blob:trace');
  });
});
