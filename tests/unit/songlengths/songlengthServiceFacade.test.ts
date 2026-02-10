/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/* @vitest-environment node */
import { describe, expect, it, vi } from 'vitest';
import { InMemoryTextBackend, SongLengthServiceFacade } from '@/lib/songlengths';

vi.mock('@/lib/logging', () => ({
  addLog: vi.fn(),
  addErrorLog: vi.fn(),
}));

const loadWithContent = async (
  service: SongLengthServiceFacade,
  content: string,
  configuredPath = '/Songlengths.md5',
) => service.loadOnColdStart(
  configuredPath,
  async () => [{ path: configuredPath, content }],
  'unit-test',
);

describe('SongLengthServiceFacade', () => {
  it('resolves unique file names directly by filename', async () => {
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test-unique' });
    await loadWithContent(service, `
; /MUSICIANS/A/solo.sid
11111111111111111111111111111111=0:30
; /MUSICIANS/B/other.sid
22222222222222222222222222222222=0:40
`);

    const resolution = service.resolveDurationSeconds({ fileName: 'solo.sid', songNr: 1 });
    expect(resolution.durationSeconds).toBe(30);
    expect(resolution.strategy).toBe('filename-unique');
  });

  it('resolves duplicate filenames using partial path', async () => {
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test-duplicate-path' });
    await loadWithContent(service, `
; /MUSICIANS/A/common.sid
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=0:10
; /MUSICIANS/B/common.sid
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=0:20
`);

    const resolution = service.resolveDurationSeconds({
      fileName: 'common.sid',
      partialPath: '/musicians/b',
      songNr: 1,
    });
    expect(resolution.durationSeconds).toBe(20);
    expect(resolution.strategy).toBe('filename-partial-path');
  });

  it('falls back to md5 when path hints do not match', async () => {
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test-md5-fallback' });
    await loadWithContent(service, `
; /MUSICIANS/A/common.sid
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=0:10
; /MUSICIANS/B/common.sid
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=0:20
`);

    const resolution = service.resolveDurationSeconds({
      virtualPath: '/missing/path/common.sid',
      fileName: 'common.sid',
      partialPath: '/unknown',
      md5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      songNr: 1,
    });
    expect(resolution.durationSeconds).toBe(20);
    expect(resolution.strategy).toBe('md5');
  });

  it('detects ambiguity and does not guess', async () => {
    const onAmbiguous = vi.fn();
    const backend = new InMemoryTextBackend({ onAmbiguous });
    const service = new SongLengthServiceFacade(backend, { serviceId: 'test-ambiguous' });
    await loadWithContent(service, `
; /MUSICIANS/A/common.sid
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=0:10
; /MUSICIANS/B/common.sid
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=0:20
`);

    const resolution = service.resolveDurationSeconds({
      fileName: 'common.sid',
      partialPath: '/musicians',
      songNr: 1,
    });
    expect(resolution.durationSeconds).toBeNull();
    expect(resolution.strategy).toBe('ambiguous');
    expect(onAmbiguous).toHaveBeenCalledOnce();
  });

  it('uses full-path resolution after duplicate partial-path ambiguity', async () => {
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test-full-path-after-ambiguity' });
    await loadWithContent(service, `
; /MUSICIANS/A/common.sid
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=0:10
; /MUSICIANS/B/common.sid
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=0:20
`);

    const resolution = service.resolveDurationSeconds({
      virtualPath: '/MUSICIANS/B/common.sid',
      fileName: 'common.sid',
      partialPath: '/musicians',
      songNr: 1,
    });
    expect(resolution.durationSeconds).toBe(20);
    expect(resolution.strategy).toBe('full-path');
  });

  it('uses md5 fallback after duplicate partial-path ambiguity and full-path miss', async () => {
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test-md5-after-ambiguity' });
    await loadWithContent(service, `
; /MUSICIANS/A/common.sid
aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa=0:10
; /MUSICIANS/B/common.sid
bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb=0:20
`);

    const resolution = service.resolveDurationSeconds({
      virtualPath: '/MISSING/common.sid',
      fileName: 'common.sid',
      partialPath: '/musicians',
      md5: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      songNr: 1,
    });
    expect(resolution.durationSeconds).toBe(20);
    expect(resolution.strategy).toBe('md5');
  });

  it('handles malformed input without crashing', async () => {
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test-malformed' });
    const stats = await loadWithContent(service, `
; /MUSICIANS/A/valid.sid
cccccccccccccccccccccccccccccccc=0:33
this is not valid
=broken
`);

    expect(stats.status).toBe('ready');
    expect(stats.backendStats.rejectedLines).toBeGreaterThan(0);
    const resolution = service.resolveDurationSeconds({ fileName: 'valid.sid', songNr: 1 });
    expect(resolution.durationSeconds).toBe(33);
  });

  it('reports unavailable state when cold-start load fails', async () => {
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test-failure' });
    const stats = await service.loadOnColdStart('/Songlengths.md5', async () => {
      throw new Error('failed to read');
    }, 'unit-test');
    expect(stats.status).toBe('unavailable');
    expect(stats.unavailableReason).toBe('songlengths unavailable');
  });

  it('builds a 100k entry index within memory estimate budget and reasonable time', async () => {
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test-100k' });
    const entries = 100_000;
    const lines: string[] = [];
    for (let i = 0; i < entries; i += 1) {
      lines.push(`/MUSICIANS/${i % 128}/song-${i}.sid 0:30`);
    }
    const content = lines.join('\n');

    const startedAt = Date.now();
    const stats = await loadWithContent(service, content, '/Songlengths.txt');
    const elapsedMs = Date.now() - startedAt;

    expect(stats.status).toBe('ready');
    expect(stats.backendStats.entriesTotal).toBe(entries);
    expect(stats.backendStats.estimatedMemoryBytes).toBeLessThan(80 * 1024 * 1024);
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
