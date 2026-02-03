// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyHvscProgressEventToSummary,
  clearHvscStatusSummary,
  getDefaultHvscStatusSummary,
  loadHvscStatusSummary,
  saveHvscStatusSummary,
  type HvscStatusSummary,
} from '@/lib/hvsc/hvscStatusStore';

describe('hvscStatusStore', () => {
  beforeEach(() => {
    if (typeof globalThis.localStorage === 'undefined') {
      const store = new Map<string, string>();
      (globalThis as typeof globalThis & { localStorage?: Storage }).localStorage = {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      } as Storage;
    } else {
      globalThis.localStorage.clear();
    }
  });

  it('returns defaults when storage is empty', () => {
    expect(loadHvscStatusSummary()).toEqual(getDefaultHvscStatusSummary());
  });

  it('persists and loads summary data', () => {
    const summary: HvscStatusSummary = {
      download: {
        status: 'success',
        startedAt: 'now',
        finishedAt: 'later',
        durationMs: 1234,
        sizeBytes: 987,
        downloadedBytes: 456,
        totalBytes: 1024,
      },
      extraction: {
        status: 'success',
        startedAt: 'now',
        finishedAt: 'later',
        durationMs: 5678,
        filesExtracted: 42,
        totalFiles: 120,
      },
      lastUpdatedAt: 'later',
    };

    saveHvscStatusSummary(summary);
    expect(loadHvscStatusSummary()).toEqual(summary);

    clearHvscStatusSummary();
    expect(loadHvscStatusSummary()).toEqual(getDefaultHvscStatusSummary());
  });

  it('marks download success when extraction starts', () => {
    const base = getDefaultHvscStatusSummary();
    const downloadEvent = {
      stage: 'download',
      message: 'Downloading',
      downloadedBytes: 10,
      totalBytes: 100,
    } as any;
    const extractionEvent = {
      stage: 'archive_extraction',
      message: 'Extracting',
      processedCount: 1,
      totalCount: 2,
    } as any;

    const afterDownload = applyHvscProgressEventToSummary(base, downloadEvent, null);
    expect(afterDownload.download.status).toBe('in-progress');

    const afterExtraction = applyHvscProgressEventToSummary(afterDownload, extractionEvent, 'download');
    expect(afterExtraction.download.status).toBe('success');
    expect(afterExtraction.extraction.status).toBe('in-progress');
  });

  it('marks download success when percent reaches 100', () => {
    const base = getDefaultHvscStatusSummary();
    const event = {
      stage: 'download',
      message: 'Downloaded',
      downloadedBytes: 100,
      totalBytes: 100,
      percent: 100,
      elapsedTimeMs: 1234,
    } as any;

    const next = applyHvscProgressEventToSummary(base, event, null);
    expect(next.download.status).toBe('success');
    expect(next.download.finishedAt).toBeTruthy();
    expect(next.download.durationMs).toBe(1234);
    expect(next.download.totalBytes).toBe(100);
  });
});
