/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getActiveMockBaseUrl, getActiveMockFtpPort, startMockServer, stopMockServer } from '@/lib/mock/mockServer';
import { addErrorLog } from '@/lib/logging';
import { MockC64U } from '@/lib/native/mockC64u';
import { getMockConfigPayload } from '@/lib/mock/mockConfig';

vi.mock('@/lib/logging', () => ({
  addErrorLog: vi.fn(),
}));

vi.mock('@/lib/native/mockC64u', () => ({
  MockC64U: {
    startServer: vi.fn(),
    stopServer: vi.fn(),
  },
}));

vi.mock('@/lib/mock/mockConfig', () => ({
  getMockConfigPayload: vi.fn().mockResolvedValue({}),
}));

describe('mockServer', () => {
  beforeEach(async () => {
    vi.mocked(MockC64U.startServer).mockReset();
    vi.mocked(MockC64U.stopServer).mockReset();
    vi.mocked(addErrorLog).mockReset();
    vi.mocked(getMockConfigPayload).mockReset();
    vi.mocked(getMockConfigPayload).mockResolvedValue({});
    await stopMockServer();
  });

  it('starts once and caches the active base URL', async () => {
    vi.mocked(MockC64U.startServer).mockResolvedValue({ baseUrl: 'http://localhost:1234', ftpPort: 2121 });

    const first = await startMockServer();
    const second = await startMockServer();

    expect(first).toEqual({ baseUrl: 'http://localhost:1234', ftpPort: 2121 });
    expect(second).toEqual({ baseUrl: 'http://localhost:1234', ftpPort: 2121 });
    expect(vi.mocked(MockC64U.startServer)).toHaveBeenCalledTimes(1);
    expect(getActiveMockBaseUrl()).toBe('http://localhost:1234');
    expect(getActiveMockFtpPort()).toBe(2121);

    await stopMockServer();
    expect(vi.mocked(MockC64U.stopServer)).toHaveBeenCalledTimes(1);
    expect(getActiveMockBaseUrl()).toBeNull();
    expect(getActiveMockFtpPort()).toBeNull();
  });

  it('logs and rethrows start failures', async () => {
    const error = new Error('Start failed');
    vi.mocked(MockC64U.startServer).mockRejectedValue(error);

    await expect(startMockServer()).rejects.toThrow('Start failed');
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith('Mock C64U server failed to start', {
      error: 'Start failed',
    });
  });

  it('logs and rethrows stop failures', async () => {
    vi.mocked(MockC64U.startServer).mockResolvedValue({ baseUrl: 'http://localhost:1234' });
    vi.mocked(MockC64U.stopServer).mockRejectedValue(new Error('Stop failed'));

    await startMockServer();
    await expect(stopMockServer()).rejects.toThrow('Stop failed');
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith('Mock C64U server failed to stop', {
      error: 'Stop failed',
    });
  });
});
