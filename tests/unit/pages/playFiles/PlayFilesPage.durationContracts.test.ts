import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const testFilePath = fileURLToPath(import.meta.url);
const pagePath = resolve(dirname(testFilePath), '../../../../src/pages/PlayFilesPage.tsx');
const pageSource = readFileSync(pagePath, 'utf8');

describe('PlayFilesPage duration contracts', () => {
  it('persists accepted duration overrides across the playlist', () => {
    expect(pageSource.match(/applyDurationOverrideToPlaylist\(prev, nextDurationMs\)/g)).toHaveLength(3);
  });
});
