import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyHvscProgressEventToSummary,
  getDefaultHvscStatusSummary,
  updateHvscStatusSummaryFromEvent,
} from '@/lib/hvsc/hvscStatusStore';

describe('hvsc status summary updates', () => {
  beforeEach(() => {
    localStorage.clear();
  });
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

  it('classifies download failures and stores error details', () => {
    const initial = getDefaultHvscStatusSummary();
    const summary = applyHvscProgressEventToSummary(initial, {
      ingestionId: 'test',
      stage: 'error',
      message: 'Request failed',
      errorCause: 'Connection refused',
    }, 'download');

    expect(summary.download.status).toBe('failure');
    expect(summary.download.errorCategory).toBe('network');
    expect(summary.download.errorMessage).toBe('Connection refused');
  });

  it('classifies extraction failures based on last stage', () => {
    const initial = getDefaultHvscStatusSummary();
    const summary = applyHvscProgressEventToSummary(initial, {
      ingestionId: 'test',
      stage: 'error',
      message: 'Disk full',
      errorCause: 'ENOSPC',
    }, 'archive_extraction');

    expect(summary.extraction.status).toBe('failure');
    expect(summary.extraction.errorCategory).toBe('storage');
  });

  it('persists status updates to storage', () => {
    const result = updateHvscStatusSummaryFromEvent({
      ingestionId: 'test',
      stage: 'download',
      message: 'Downloading',
      downloadedBytes: 10,
      totalBytes: 20,
    });

    const stored = JSON.parse(localStorage.getItem('c64u_hvsc_status:v1') ?? '{}');
    expect(stored.download?.downloadedBytes).toBe(10);
    expect(result.download.downloadedBytes).toBe(10);
  });
});
