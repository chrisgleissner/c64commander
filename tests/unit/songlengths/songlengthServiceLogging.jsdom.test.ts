/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

// jsdom environment so typeof window !== "undefined", allowing the catch fallback
// in safeAddLog / safeAddErrorLog to emit console.warn instead of returning early.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const addLogMock = vi.fn();
const addErrorLogMock = vi.fn();

vi.mock('@/lib/logging', () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
  addErrorLog: (...args: unknown[]) => addErrorLogMock(...args),
}));

describe('SongLengthServiceFacade logging fallback (jsdom)', () => {
  beforeEach(() => {
    vi.resetModules();
    addLogMock.mockReset();
    addErrorLogMock.mockReset();
  });

  it('falls back to console.warn when addLog throws during a service call', async () => {
    addLogMock.mockImplementation(() => {
      throw new Error('log-exploded');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { SongLengthServiceFacade, InMemoryTextBackend } = await import('@/lib/songlengths');
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test' });
    await service.loadOnColdStart(null, async () => [], 'test-label');

    expect(warnSpy).toHaveBeenCalledWith(
      'SongLengthServiceFacade logging failed',
      expect.objectContaining({ error: 'log-exploded' }),
    );
    warnSpy.mockRestore();
  });

  it('falls back to console.warn when addErrorLog throws during a service call', async () => {
    addLogMock.mockImplementation(() => {
      throw new Error('log-exploded');
    });
    addErrorLogMock.mockImplementation(() => {
      throw new Error('errlog-exploded');
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { SongLengthServiceFacade, InMemoryTextBackend } = await import('@/lib/songlengths');
    const service = new SongLengthServiceFacade(new InMemoryTextBackend(), { serviceId: 'test' });

    // loadOnColdStart with a throwing loader triggers addErrorLog path
    await service.loadOnColdStart(
      null,
      async () => {
        throw new Error('source-failed');
      },
      'test-label',
    );

    expect(warnSpy).toHaveBeenCalledWith(
      'SongLengthServiceFacade error logging failed',
      expect.objectContaining({ error: 'errlog-exploded' }),
    );
    warnSpy.mockRestore();
  });
});
