import { describe, expect, it } from 'vitest';

import { shouldSkipFuzzyScreenshotPrune } from '../../../scripts/screenshotPrunePolicy.js';

describe('shouldSkipFuzzyScreenshotPrune', () => {
  it('skips fuzzy prune for import screenshots and profiles', () => {
    expect(shouldSkipFuzzyScreenshotPrune('play/import/02-c64u-file-picker.png')).toBe(true);
    expect(shouldSkipFuzzyScreenshotPrune('doc/img/app/play/import/03-local-file-picker.png')).toBe(true);
    expect(shouldSkipFuzzyScreenshotPrune('doc/img/app/play/import/profiles/compact/02-c64u-file-picker.png')).toBe(true);
  });

  it('does not skip fuzzy prune for unrelated screenshots', () => {
    expect(shouldSkipFuzzyScreenshotPrune('home/02-connection-status-popover.png')).toBe(false);
    expect(shouldSkipFuzzyScreenshotPrune('doc/img/app/settings/01-overview.png')).toBe(false);
  });
});
