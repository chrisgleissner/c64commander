/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import { InMemoryTextBackend } from '@/lib/songlengths/inMemoryTextBackend';

const makeInput = (content: string, path = 'test.md5') => ({
  configuredPath: '/songlengths',
  sourceLabel: 'test',
  files: [{ path, content }],
});

describe('InMemoryTextBackend', () => {
  describe('resolve', () => {
    it('returns unavailable when no records loaded', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput(''));
      const result = backend.resolve({ fileName: 'test.sid' });
      expect(result.strategy).toBe('unavailable');
    });

    it('derives fileName from virtualPath when fileName is not provided', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('; /DEMOS/Song.sid\nabc123=1:30'));
      const result = backend.resolve({ virtualPath: '/DEMOS/Song.sid' });
      expect(result.strategy).toBe('filename-unique');
      expect(result.durationSeconds).toBe(90);
    });

    it('derives partialPath from virtualPath when partialPath is not provided', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput(
        '; /DEMOS/A/Song.sid\naaa=1:00\n; /DEMOS/B/Song.sid\nbbb=2:00',
      ));
      const result = backend.resolve({ virtualPath: '/DEMOS/A/Song.sid' });
      expect(result.strategy).toBe('filename-partial-path');
      expect(result.durationSeconds).toBe(60);
    });

    it('falls through to full-path when partial-path matches 0 candidates', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput(
        '; /DEMOS/A/Song.sid\naaa=1:00\n; /DEMOS/B/Song.sid\nbbb=2:00',
      ));
      const result = backend.resolve({
        fileName: 'song.sid',
        partialPath: '/NONEXIST',
        virtualPath: '/DEMOS/A/Song.sid',
      });
      expect(result.strategy).toBe('full-path');
    });

    it('returns not-found when no match exists', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('; /DEMOS/Song.sid\nabc123=1:30'));
      const result = backend.resolve({ fileName: 'nonexist.sid' });
      expect(result.strategy).toBe('not-found');
    });

    it('returns ambiguous when multiple partial-path matches exist', async () => {
      const onAmbiguous = vi.fn();
      const backend = new InMemoryTextBackend({ onAmbiguous });
      await backend.load(makeInput(
        '; /DEMOS/A/X/Song.sid\naaa=1:00\n; /DEMOS/A/Y/Song.sid\nbbb=2:00',
      ));
      const result = backend.resolve({
        fileName: 'song.sid',
        partialPath: '/DEMOS/A',
      });
      expect(result.strategy).toBe('ambiguous');
      expect(onAmbiguous).toHaveBeenCalledOnce();
    });
  });

  describe('resolveDuration', () => {
    it('defaults songNr <= 0 to index 0', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('; /DEMOS/Song.sid\nabc=1:00 2:00'));
      const r0 = backend.resolve({ fileName: 'song.sid', songNr: 0 });
      expect(r0.durationSeconds).toBe(60);
      const rNeg = backend.resolve({ fileName: 'song.sid', songNr: -1 });
      expect(rNeg.durationSeconds).toBe(60);
    });

    it('returns null when songNr exceeds subsong count', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('; /DEMOS/Song.sid\nabc=1:00'));
      const result = backend.resolve({ fileName: 'song.sid', songNr: 5 });
      expect(result.durationSeconds).toBeNull();
    });
  });

  describe('parseSongLengthFile', () => {
    it('skips bracket lines', async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput('[Database]\n; /DEMOS/Song.sid\nabc=1:00'));
      const result = backend.resolve({ fileName: 'song.sid' });
      expect(result.durationSeconds).toBe(60);
      expect(onRejected).not.toHaveBeenCalled();
    });

    it('rejects lines with unsupported format', async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput('garbage-no-space-or-eq'));
      expect(onRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'unsupported line format' }),
      );
    });

    it('rejects empty comment path markers', async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput(';'));
      expect(onRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'empty comment path marker' }),
      );
    });

    it('rejects invalid md5 key (eq at start)', async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput('=1:00'));
      expect(onRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'unsupported line format' }),
      );
    });

    it('rejects invalid duration payload for md5 line', async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput('abc=garbage'));
      expect(onRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'invalid duration payload' }),
      );
    });

    it('rejects invalid duration payload for space-separated line', async () => {
      const onRejected = vi.fn();
      const backend = new InMemoryTextBackend({ onRejectedLine: onRejected });
      await backend.load(makeInput('/path/file.sid garbage'));
      expect(onRejected).toHaveBeenCalledWith(
        expect.objectContaining({ reason: 'invalid duration payload' }),
      );
    });

    it('handles space-separated path+duration format', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('/DEMOS/Song.sid 1:30'));
      const result = backend.resolve({ fileName: 'song.sid' });
      expect(result.durationSeconds).toBe(90);
    });
  });

  describe('parseDurationTokenToSeconds', () => {
    it('returns null for seconds >= 60', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('; /DEMOS/Song.sid\nabc=0:61'));
      const result = backend.resolve({ fileName: 'song.sid' });
      expect(result.strategy).toBe('unavailable');
    });
  });

  describe('exportSnapshot', () => {
    it('exports path-to-seconds and md5-to-seconds maps', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('; /DEMOS/Song.sid\nabc123=1:30 2:00'));
      const snapshot = backend.exportSnapshot();
      expect(snapshot.pathToSeconds.size).toBe(1);
      expect(snapshot.md5ToSeconds.size).toBe(1);
      expect(snapshot.pathToSeconds.get('/DEMOS/Song.sid')).toEqual([90, 120]);
      expect(snapshot.md5ToSeconds.get('abc123')).toEqual([90, 120]);
    });

    it('returns empty maps when no records loaded', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput(''));
      const snapshot = backend.exportSnapshot();
      expect(snapshot.pathToSeconds.size).toBe(0);
      expect(snapshot.md5ToSeconds.size).toBe(0);
    });
  });

  describe('stats', () => {
    it('tracks loaded file metadata', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('; /DEMOS/Song.sid\nabc=1:00'));
      const stats = backend.stats();
      expect(stats.backend).toBe('in-memory-text');
      expect(stats.entriesTotal).toBe(1);
      expect(stats.filesLoaded).toEqual(['test.md5']);
      expect(stats.estimatedMemoryBytes).toBeGreaterThan(0);
    });
  });

  describe('md5 resolution', () => {
    it('resolves by md5 when fileName does not match', async () => {
      const backend = new InMemoryTextBackend();
      await backend.load(makeInput('; /DEMOS/Song.sid\nabc123=1:30'));
      const result = backend.resolve({ fileName: 'other.sid', md5: 'abc123' });
      expect(result.strategy).toBe('md5');
      expect(result.durationSeconds).toBe(90);
    });
  });
});
