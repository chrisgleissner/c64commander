/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

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

    it('ignores updates when storage is corrupted', () => {
      localStorage.setItem('c64u_hvsc_status:v1', 'invalid-json{');
      const loaded = loadHvscStatusSummary();
      expect(loaded).toEqual(getDefaultHvscStatusSummary());
    });

    it('ignores updates when summary misses core properties', () => {
      localStorage.setItem('c64u_hvsc_status:v1', '{}');
      const loaded = loadHvscStatusSummary();
      expect(loaded).toEqual(getDefaultHvscStatusSummary());
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

    it('ignores non-complete events', () => {
      const initial = getDefaultHvscStatusSummary();
      // @ts-expect-error - simulating unknown stage
      const result = applyHvscProgressEventToSummary(initial, {
        stage: 'unknown_stage',
        message: 'test',
      });
      expect(result).toEqual(initial);
    });

    it('handles download success with existing finishedAt', () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.finishedAt = 'existing-time';

      const next = applyHvscProgressEventToSummary(initial, {
        stage: 'download',
        message: 'done',
        percent: 100,
      });

      expect(next.download.finishedAt).toBe('existing-time');
    });

    it('preserves existing duration when event does not provide it', () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.durationMs = 999;

      const next = applyHvscProgressEventToSummary(initial, {
        stage: 'download',
        message: 'progress',
        percent: 50,
      });

      expect(next.download.durationMs).toBe(999);
    });

    it('updates download size and total bytes properly', () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.downloadedBytes = 50;
      initial.download.sizeBytes = 50;

      // Case 1: event has totalBytes -> uses event.totalBytes
      let next = applyHvscProgressEventToSummary(initial, {
        stage: 'download',
        message: 'progress',
        downloadedBytes: 60,
        totalBytes: 100,
      });
      expect(next.download.sizeBytes).toBe(100);

      // Case 2: download complete, no totalBytes -> uses downloadedBytes
      // Reset for clarity
      initial.download.downloadedBytes = 50;
      initial.download.sizeBytes = 50;
      next = applyHvscProgressEventToSummary(initial, {
        stage: 'download',
        message: 'done',
        percent: 100,
        downloadedBytes: 120, // no totalBytes property
      });
      expect(next.download.sizeBytes).toBe(120);

      // Case 3: in-progress, no totalBytes -> keeps old sizeBytes
      initial.download.sizeBytes = 999;
      next = applyHvscProgressEventToSummary(initial, {
        stage: 'download',
        message: 'progress',
        downloadedBytes: 60,
        // no totalBytes, no completion
      });
      expect(next.download.sizeBytes).toBe(999);
    });

    it('marks download success when extraction starts (with status transition)', () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.status = 'in-progress';

      const result = applyHvscProgressEventToSummary(initial, {
        stage: 'archive_extraction',
        message: 'extracting',
      });

      expect(result.download.status).toBe('success');
    });

    it('keeps download status if not in-progress when extraction starts', () => {
      const initial = getDefaultHvscStatusSummary();
      initial.download.status = 'idle';

      const result = applyHvscProgressEventToSummary(initial, {
        stage: 'archive_extraction',
        message: 'extracting',
      });

      expect(result.download.status).toBe('idle');
    });

    it('preserves success status on completion event', () => {
      const initial = getDefaultHvscStatusSummary();
      initial.extraction.status = 'success';
      initial.download.status = 'success';

      const result = applyHvscProgressEventToSummary(initial, {
        stage: 'complete',
        message: 'done',
      });

      expect(result.extraction.status).toBe('success');
      expect(result.download.status).toBe('success');
    });

    it('handles generic errors not matching categories', () => {
      const initial = getDefaultHvscStatusSummary();
      const result = applyHvscProgressEventToSummary(initial, {
        stage: 'error',
        message: 'Something weird happened',
      }, 'download');

      expect(result.download.errorCategory).toBe('download');
    });

    it('handles extraction failure when error stage is unknown', () => {
      const initial = getDefaultHvscStatusSummary();
      const result = applyHvscProgressEventToSummary(initial, {
        stage: 'error',
        message: 'Something weird happened',
      }, 'unknown_stage_name');

      // Default fallthrough logic for unknown lastStage?
      // The code: if (lastStage === 'download') { ... } return { extraction: ... }
      // So unexpected lastStage falls through to extraction error
      expect(result.extraction.status).toBe('failure');
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
