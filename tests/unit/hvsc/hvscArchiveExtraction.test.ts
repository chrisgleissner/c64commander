import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractArchiveEntries } from '@/lib/hvsc/hvscArchiveExtraction';

describe('hvscArchiveExtraction', () => {
  it(
    'extracts HVSC_Update_84.7z fixture',
    async () => {
      const fixturePath = path.resolve(
        process.cwd(),
        'android/app/src/test/fixtures/HVSC_Update_84.7z',
      );
      const buffer = new Uint8Array(readFileSync(fixturePath));
      const entries: string[] = [];

      await extractArchiveEntries({
        archiveName: 'HVSC_Update_84.7z',
        buffer,
        onEntry: async (entryPath) => {
          entries.push(entryPath);
        },
      });

      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((entry) => entry.toLowerCase().endsWith('.sid'))).toBe(true);
    },
    30000,
  );
});
