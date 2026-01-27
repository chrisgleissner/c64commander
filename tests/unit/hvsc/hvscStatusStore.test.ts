import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearHvscStatusSummary,
  getDefaultHvscStatusSummary,
  loadHvscStatusSummary,
  saveHvscStatusSummary,
  type HvscStatusSummary,
} from '@/lib/hvsc/hvscStatusStore';

describe('hvscStatusStore', () => {
  beforeEach(() => {
    localStorage.clear();
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
});
