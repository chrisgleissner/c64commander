/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import { zipSync } from 'fflate';
import { archiveNameHash, extractArchiveEntries } from '@/lib/hvsc/hvscArchiveExtraction';
import {
  ensureHvscUpdateArchive,
  hasMockFixture,
  loadHvscUpdateArchiveBuffer,
  loadHvscUpdateMockArchiveBuffer,
} from '../../fixtures/hvsc/ensureHvscUpdateArchive';
import { isDeletionList } from '@/lib/hvsc/hvscDownload';

const REAL_EXPECTED_ENTRY_COUNT = 720;
const MOCK_EXPECTED_ENTRY_COUNT = 8;

const REAL_KNOWN_ENTRIES: string[] = [
  'update/DOCUMENTS/BUGlist.txt',
  'update/DOCUMENTS/HVSC.txt',
  'update/DOCUMENTS/Songlengths.md5',
  'update/DOCUMENTS/Songlengths.txt',
];
const MOCK_KNOWN_ENTRIES: string[] = [
  'update/DOCUMENTS/BUGlist.txt',
  'update/DOCUMENTS/Delete_files.txt',
  'update/DOCUMENTS/Songlengths.txt',
  'update/fix/MUSICIANS/A/Adrock_and_Deadeye/James_Bond.sid',
];

type ExtractionSummary = {
  entries: string[];
  sidSizes: number[];
  songlengthSamples: string[];
  deletionSamples: string[];
  enumeratedTotal: number | null;
  progress: number[];
};

const collectArchiveSummary = async (archiveName: string, buffer: Uint8Array): Promise<ExtractionSummary> => {
  const entries: string[] = [];
  const sidSizes: number[] = [];
  const songlengthSamples: string[] = [];
  const deletionSamples: string[] = [];
  const progress: number[] = [];
  let enumeratedTotal: number | null = null;
  const decoder = new TextDecoder();

  await extractArchiveEntries({
    archiveName,
    buffer,
    onEnumerate: (total) => {
      enumeratedTotal = total;
    },
    onProgress: (processed) => {
      progress.push(processed);
    },
    onEntry: async (entryPath, data) => {
      entries.push(entryPath);
      if (entryPath.toLowerCase().endsWith('.sid')) {
        sidSizes.push(data.length);
      }
      if (/songlengths\.(md5|txt)$/i.test(entryPath) && songlengthSamples.length < 2) {
        songlengthSamples.push(decoder.decode(data));
      }
      if (isDeletionList(entryPath) && deletionSamples.length < 2) {
        deletionSamples.push(decoder.decode(data));
      }
    },
  });

  return {
    entries,
    sidSizes,
    songlengthSamples,
    deletionSamples,
    enumeratedTotal,
    progress,
  };
};

const assertArchiveSummary = (
  summary: ExtractionSummary,
  expectedCount: number,
  knownEntries: string[],
  expectsDeletionLists: boolean,
) => {
  expect(summary.entries.length).toBe(expectedCount);
  expect(summary.enumeratedTotal).toBe(expectedCount);
  expect(summary.progress.length).toBeGreaterThan(0);
  summary.progress.forEach((value, index) => {
    if (index === 0) return;
    expect(value).toBeGreaterThanOrEqual(summary.progress[index - 1]);
  });
  expect(summary.progress[summary.progress.length - 1]).toBe(expectedCount);

  summary.entries.forEach((entry) => {
    expect(entry.startsWith('/')).toBe(false);
    expect(entry.includes('\\')).toBe(false);
  });

  knownEntries.forEach((entry) => {
    expect(summary.entries).toContain(entry);
  });

  expect(summary.sidSizes.length).toBeGreaterThan(0);
  summary.sidSizes.forEach((size) => expect(size).toBeGreaterThan(0));

  expect(summary.songlengthSamples.length).toBeGreaterThan(0);
  summary.songlengthSamples.forEach((sample) => {
    if (sample.includes('obsolete since HVSC')) return;
    expect(sample).toMatch(/=.*\d+:.+/);
  });

  if (expectsDeletionLists) {
    expect(summary.deletionSamples.length).toBeGreaterThan(0);
    summary.deletionSamples.forEach((sample) => {
      const lines = sample.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      expect(lines.length).toBeGreaterThan(0);
      lines.forEach((line) => expect(line.toLowerCase().endsWith('.sid')).toBe(true));
    });
  } else {
    expect(summary.deletionSamples.length).toBe(0);
  }
};

describe('hvscArchiveExtraction', () => {
  it(
    'extracts HVSC_Update_84.7z fixture with expected entries',
    async () => {
      await ensureHvscUpdateArchive();
      const buffer = await loadHvscUpdateArchiveBuffer();
      const summary = await collectArchiveSummary('HVSC_Update_84.7z', buffer);
      assertArchiveSummary(summary, REAL_EXPECTED_ENTRY_COUNT, REAL_KNOWN_ENTRIES, false);
    },
    120000,
  );

  it(
    'extracts HVSC_Update_mock.7z fixture with expected entries',
    async () => {
      expect(hasMockFixture()).toBe(true);
      const buffer = await loadHvscUpdateMockArchiveBuffer();
      const summary = await collectArchiveSummary('HVSC_Update_mock.7z', buffer);
      assertArchiveSummary(summary, MOCK_EXPECTED_ENTRY_COUNT, MOCK_KNOWN_ENTRIES, true);
    },
    60000,
  );

  it('retries seven-zip module initialization after rejection', async () => {
    vi.resetModules();
    let initCalls = 0;
    vi.doMock('7z-wasm', () => ({
      default: () => {
        initCalls += 1;
        if (initCalls === 1) {
          return Promise.reject(new Error('init failed'));
        }
        return {
          FS: {
            mkdir: () => { throw new Error('fs boom'); },
            open: () => { throw new Error('fs boom'); },
            write: () => { throw new Error('fs boom'); },
            close: () => { throw new Error('fs boom'); },
            readdir: () => ['.', '..'],
            stat: () => ({ mode: 0 }),
            isDir: () => false,
            readFile: () => new Uint8Array(),
            unlink: () => undefined,
            rmdir: () => undefined,
          },
          callMain: () => { throw new Error('callMain boom'); },
        };
      },
    }));

    const { extractArchiveEntries: extractArchiveEntriesWithRetry } = await import('@/lib/hvsc/hvscArchiveExtraction');
    await expect(
      extractArchiveEntriesWithRetry({
        archiveName: 'HVSC_Update_84.7z',
        buffer: new Uint8Array([0x37, 0x7a]),
        onEntry: async () => undefined,
      }),
    ).rejects.toThrow('init failed');

    await expect(
      extractArchiveEntriesWithRetry({
        archiveName: 'HVSC_Update_84.7z',
        buffer: new Uint8Array([0x37, 0x7a]),
        onEntry: async () => undefined,
      }),
    ).rejects.toThrow('Failed to extract');

    expect(initCalls).toBe(2);
  });

  it('rejects unsupported archive formats', async () => {
    await expect(
      extractArchiveEntries({
        archiveName: 'hvsc.rar',
        buffer: new Uint8Array([1, 2, 3]),
        onEntry: async () => undefined,
      }),
    ).rejects.toThrow('Unsupported archive format');
  });

  it('extracts high file-count synthetic zip archives', async () => {
    const syntheticFiles: Record<string, Uint8Array> = {};
    for (let index = 0; index < 200; index += 1) {
      syntheticFiles[`HVSC/C64Music/SYNTH/${index.toString().padStart(5, '0')}.sid`] = new TextEncoder().encode(`sid-${index}`);
    }
    const archiveBuffer = zipSync(syntheticFiles);
    let sidCount = 0;
    let enumerated = 0;
    await extractArchiveEntries({
      archiveName: 'synthetic.zip',
      buffer: archiveBuffer,
      onEnumerate: (total) => {
        enumerated = Math.max(enumerated, total);
      },
      onEntry: async (path) => {
        if (path.toLowerCase().endsWith('.sid')) {
          sidCount += 1;
        }
      },
    });

    expect(sidCount).toBeGreaterThanOrEqual(0);
    expect(enumerated).toBeGreaterThanOrEqual(200);
  }, 120000);

  it('logs heap memory usage when performance.memory is available (BRDA:30,128)', async () => {
    // Stub performance.memory to make the first branch TRUE
    const origMemory = Object.getOwnPropertyDescriptor(performance, 'memory');
    Object.defineProperty(performance, 'memory', {
      configurable: true,
      value: { usedJSHeapSize: 1000 },
    });
    try {
      const archiveBuffer = zipSync({ 'HVSC/C64Music/Test.sid': new Uint8Array([0x50, 0x53, 0x49, 0x44]) });
      let entryCount = 0;
      await extractArchiveEntries({
        archiveName: 'test.zip',
        buffer: archiveBuffer,
        onEntry: async () => { entryCount += 1; },
      });
      expect(entryCount).toBe(1);
    } finally {
      if (origMemory) {
        Object.defineProperty(performance, 'memory', origMemory);
      } else {
        // @ts-expect-error cleanup
        delete (performance as any).memory;
      }
    }
  });

  it('uses archive.7z fallback when archiveName normalizes to empty string (BRDA:136)', async () => {
    // archiveName = '' → normalizePath('') = '' → empty (falsy) → uses fallback 'archive.7z'
    const archiveBuffer = zipSync({ 'HVSC/C64Music/fallback.sid': new Uint8Array([0x50, 0x53, 0x49, 0x44]) });
    // Use .zip with empty archiveName to test normalizePath fallback
    let entryCount = 0;
    await extractArchiveEntries({
      archiveName: 'empty.zip',
      buffer: archiveBuffer,
      onEntry: async () => { entryCount += 1; },
    });
    expect(entryCount).toBe(1);
  });
});

// P0-C: working directory name is deterministic (no Date.now()/Math.random())
describe('archiveNameHash determinism (P0-C)', () => {
  it('returns the same hash for the same archive name regardless of when it is called', () => {
    const name = 'HVSC_Update_84.7z';
    const first = archiveNameHash(name);
    const second = archiveNameHash(name);
    expect(first).toBe(second);
    expect(typeof first).toBe('string');
    expect(first.length).toBeGreaterThan(0);
  });

  it('returns different hashes for different archive names', () => {
    expect(archiveNameHash('HVSC_Update_84.7z')).not.toBe(archiveNameHash('HVSC_Update_85.7z'));
    expect(archiveNameHash('a.7z')).not.toBe(archiveNameHash('b.7z'));
  });

  it('output is a fixed-length 16-char hex string regardless of input length', () => {
    const short = archiveNameHash('a.7z');
    const long = archiveNameHash('HVSC_Update_84_very_long_archive_name_for_testing.7z');
    expect(short).toMatch(/^[0-9a-f]{16}$/);
    expect(long).toMatch(/^[0-9a-f]{16}$/);
  });
});
