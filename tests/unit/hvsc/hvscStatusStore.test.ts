// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyHvscProgressEventToSummary,
  clearHvscStatusSummary,
  getDefaultHvscStatusSummary,
  loadHvscStatusSummary,
  saveHvscStatusSummary,
  updateHvscStatusSummaryFromEvent,
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

  describe('Persistence', () => {
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

    it('persists status updates from events', () => {
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

  describe('State transitions', () => {
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

    it('marks marks download success when extraction starts', () => {
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

  describe('Failure handling', () => {
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
  });
});
