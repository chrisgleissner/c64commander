import { describe, expect, it } from 'vitest';
import { applyHvscProgressEventToSummary, getDefaultHvscStatusSummary } from '@/lib/hvsc/hvscStatusStore';

describe('hvsc status summary updates', () => {
  it('tracks incremental download progress', () => {
    const initial = getDefaultHvscStatusSummary();
    const summary = applyHvscProgressEventToSummary(initial, {
      ingestionId: 'test',
      stage: 'download',
      message: 'Downloading',
      downloadedBytes: 512,
      totalBytes: 2048,
      percent: 25,
    });
    expect(summary.download.status).toBe('in-progress');
    expect(summary.download.downloadedBytes).toBe(512);
    expect(summary.download.totalBytes).toBe(2048);
  });

  it('marks extraction progress and completion', () => {
    const initial = getDefaultHvscStatusSummary();
    const mid = applyHvscProgressEventToSummary(initial, {
      ingestionId: 'test',
      stage: 'archive_extraction',
      message: 'Extracting',
      processedCount: 10,
      totalCount: 100,
    });
    expect(mid.extraction.status).toBe('in-progress');
    const done = applyHvscProgressEventToSummary(mid, {
      ingestionId: 'test',
      stage: 'complete',
      message: 'Complete',
    });
    expect(done.extraction.status).toBe('success');
    expect(done.download.status).toBe('success');
  });
});
