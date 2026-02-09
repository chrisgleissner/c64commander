/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AUTOSTART_SEQUENCE, injectAutostart } from '@/lib/playback/autostart';

const createApiMock = () => ({
  readMemory: vi.fn<[], Promise<Uint8Array>>(),
  writeMemory: vi.fn<[], Promise<{ errors: string[] }>>(),
});

describe('autostart', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes autostart when keyboard buffer is empty', async () => {
    const api = createApiMock();
    api.readMemory.mockResolvedValue(new Uint8Array([0]));
    api.writeMemory.mockResolvedValue({ errors: [] });

    const task = injectAutostart(api as any, AUTOSTART_SEQUENCE, { pollIntervalMs: 50 });
    await vi.runAllTimersAsync();
    await task;

    expect(api.writeMemory).toHaveBeenCalledWith('0277', AUTOSTART_SEQUENCE);
    expect(api.writeMemory).toHaveBeenCalledWith('00C6', new Uint8Array([AUTOSTART_SEQUENCE.length]));
  });

  it('throws when keyboard buffer stays busy', async () => {
    const api = createApiMock();
    api.readMemory.mockResolvedValue(new Uint8Array([2]));
    api.writeMemory.mockResolvedValue({ errors: [] });

    const task = injectAutostart(api as any, AUTOSTART_SEQUENCE, { pollIntervalMs: 10, maxAttempts: 3 });
    const assertion = expect(task).rejects.toThrow('Keyboard buffer remained busy');
    await vi.runAllTimersAsync();
    await assertion;
  });
});
