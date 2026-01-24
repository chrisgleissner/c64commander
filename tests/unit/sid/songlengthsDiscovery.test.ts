import { describe, expect, it } from 'vitest';
import { buildSonglengthsSearchPaths, collectSonglengthsSearchPaths, DOCUMENTS_FOLDER, SONGLENGTHS_FILE_NAME } from '@/lib/sid/songlengthsDiscovery';

const normalize = (paths: string[]) => paths.map((path) => path.replace(/\\/g, '/'));

describe('songlengthsDiscovery', () => {
  it('builds upward and DOCUMENTS search paths', () => {
    const paths = buildSonglengthsSearchPaths('/Music/DEMOS/demo.sid');
    const normalized = normalize(paths);
    expect(normalized).toContain(`/Music/DEMOS/${SONGLENGTHS_FILE_NAME}`);
    expect(normalized).toContain(`/Music/DEMOS/${DOCUMENTS_FOLDER}/${SONGLENGTHS_FILE_NAME}`);
    expect(normalized).toContain(`/Music/${SONGLENGTHS_FILE_NAME}`);
    expect(normalized).toContain(`/Music/${DOCUMENTS_FOLDER}/${SONGLENGTHS_FILE_NAME}`);
    expect(normalized).toContain(`/${SONGLENGTHS_FILE_NAME}`);
    expect(normalized).toContain(`/${DOCUMENTS_FOLDER}/${SONGLENGTHS_FILE_NAME}`);
  });

  it('collects unique normalized paths across inputs', () => {
    const paths = collectSonglengthsSearchPaths([
      '/Music/DEMOS/demo.sid',
      '/Music/DEMOS/demo2.sid',
    ]);
    const matches = paths.filter((path) => path.endsWith(`/${SONGLENGTHS_FILE_NAME}`));
    const unique = new Set(matches);
    expect(unique.size).toBeGreaterThan(0);
    expect(unique.size).toBe(matches.length);
  });
});
