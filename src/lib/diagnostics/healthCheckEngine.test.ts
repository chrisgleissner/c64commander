/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Module mocks (must be declared before imports) ───────────────────────────

vi.mock('@/lib/logging', () => ({ addLog: vi.fn() }));

vi.mock('@/lib/diagnostics/latencyTracker', () => ({
  computeLatencyPercentiles: vi.fn(() => ({ p50: 10, p90: 20, p99: 30 })),
}));

vi.mock('@/lib/diagnostics/healthHistory', () => ({
  pushHealthHistoryEntry: vi.fn(),
}));

vi.mock('@/lib/diagnostics/healthModel', async (importOriginal) => {
  const mod = await importOriginal<typeof import('@/lib/diagnostics/healthModel')>();
  return {
    ...mod,
    deriveConnectivityState: vi.fn(() => 'Online'),
  };
});

const mockGetInfo = vi.fn();
const mockReadMemory = vi.fn();
const mockGetConfigItem = vi.fn();
const mockSetConfigValue = vi.fn();
const mockLoadConfig = vi.fn();

vi.mock('@/lib/c64api', () => ({
  getC64API: vi.fn(() => ({
    getInfo: mockGetInfo,
    readMemory: mockReadMemory,
    getConfigItem: mockGetConfigItem,
    setConfigValue: mockSetConfigValue,
    loadConfig: mockLoadConfig,
  })),
  getC64APIConfigSnapshot: vi.fn(() => ({ deviceHost: 'c64u.local' })),
}));

const mockListFtpDirectory = vi.fn();
vi.mock('@/lib/ftp/ftpClient', () => ({
  listFtpDirectory: mockListFtpDirectory,
}));

vi.mock('@/lib/ftp/ftpConfig', () => ({
  getStoredFtpPort: vi.fn(() => 21),
}));

vi.mock('@/lib/connection/connectionManager', () => ({
  getConnectionSnapshot: vi.fn(() => ({ state: 'REAL_CONNECTED' })),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import {
  isHealthCheckRunning,
  runHealthCheck,
} from '@/lib/diagnostics/healthCheckEngine';
import { clearHealthHistory } from '@/lib/diagnostics/healthHistory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const successfulInfo = {
  product: 'Ultimate 64 Elite',
  firmware_version: '3.11',
  fpga_version: '1.42',
  core_version: 'C64',
  errors: [],
};

// A valid 3-byte JIFFY response: jiffy = 0x003C00 = 15360 → 256 seconds uptime
const jiffyBytes = new Uint8Array([0x00, 0x3c, 0x00]);

// LED Strip Settings roundtrip — returns currentValue=5
const ledItemData = { selected: 5 };
const ledResp = { 'LED Strip Settings': { 'Strip Intensity': ledItemData } };

const setupAllProbesSuccess = () => {
  mockGetInfo.mockResolvedValue(successfulInfo);
  mockReadMemory.mockImplementation((addr: string) => {
    if (addr === '00A2') return Promise.resolve(jiffyBytes);
    if (addr === 'D012') return Promise.resolve(new Uint8Array([0x42]));
    return Promise.resolve(new Uint8Array(0));
  });
  // CONFIG probe: read → write → readback → revert → verify
  // All return selected=5 to simulate no drift. writeTemp=6 (5+1 ≤ 31)
  mockGetConfigItem
    .mockResolvedValueOnce(ledResp) // initial read: value=5
    .mockResolvedValueOnce({ 'LED Strip Settings': { 'Strip Intensity': { selected: 6 } } }) // readback: value=6
    .mockResolvedValueOnce(ledResp); // verify revert: value=5
  mockSetConfigValue.mockResolvedValue(undefined);
  mockListFtpDirectory.mockResolvedValue([]);
};

beforeEach(() => {
  vi.clearAllMocks();
  clearHealthHistory();
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── isHealthCheckRunning ─────────────────────────────────────────────────────

describe('isHealthCheckRunning', () => {
  it('returns false when no run is in progress', () => {
    expect(isHealthCheckRunning()).toBe(false);
  });
});

// ─── runHealthCheck — all-success path ───────────────────────────────────────

describe('runHealthCheck — all-success path', () => {
  it('returns a run result with all probes succeeded', async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result).not.toBeNull();
    expect(result!.probes.REST.outcome).toBe('Success');
    expect(result!.probes.JIFFY.outcome).toBe('Success');
    expect(result!.probes.CONFIG.outcome).toBe('Success');
    expect(result!.probes.FTP.outcome).toBe('Success');
  });

  it('returns overallHealth Healthy when all probes pass', async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result!.overallHealth).toBe('Healthy');
  });

  it('extracts deviceInfo from REST probe', async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result!.deviceInfo?.product).toBe('Ultimate 64 Elite');
    expect(result!.deviceInfo?.firmware).toBe('3.11');
  });

  it('derives uptime from JIFFY bytes', async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    // jiffy = 0x00 | (0x3C << 8) | (0x00 << 16) = 15360 → floor(15360/60) = 256
    expect(result!.deviceInfo?.uptimeSeconds).toBe(256);
  });

  it('returns runId, startTimestamp, endTimestamp fields', async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result!.runId).toMatch(/^hcr-/);
    expect(result!.startTimestamp).toBeTruthy();
    expect(result!.endTimestamp).toBeTruthy();
  });

  it('returns latency data from computeLatencyPercentiles', async () => {
    setupAllProbesSuccess();
    const result = await runHealthCheck();
    expect(result!.latency).toEqual({ p50: 10, p90: 20, p99: 30 });
  });

  it('returns null when a run is already in progress (concurrent guard)', async () => {
    setupAllProbesSuccess();
    // Start first run but don't await yet
    const first = runHealthCheck();
    // Second run should return null immediately
    const second = await runHealthCheck();
    expect(second).toBeNull();
    await first;
  });
});

// ─── runHealthCheck — REST probe failure ─────────────────────────────────────

describe('runHealthCheck — REST probe failure', () => {
  it('skips JIFFY, RASTER, CONFIG when REST fails', async () => {
    mockGetInfo.mockRejectedValue(new Error('Network error'));
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.REST.outcome).toBe('Fail');
    expect(result!.probes.JIFFY.outcome).toBe('Skipped');
    expect(result!.probes.RASTER.outcome).toBe('Skipped');
    expect(result!.probes.CONFIG.outcome).toBe('Skipped');
  });

  it('still runs FTP probe even when REST fails', async () => {
    mockGetInfo.mockRejectedValue(new Error('Network error'));
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.FTP.outcome).toBe('Success');
  });

  it('sets REST Fail reason from error message', async () => {
    mockGetInfo.mockRejectedValue(new Error('Connection refused'));
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.REST.reason).toContain('Connection refused');
  });

  it('sets Unhealthy overallHealth when REST fails', async () => {
    mockGetInfo.mockRejectedValue(new Error('timeout'));
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.overallHealth).toBe('Unhealthy');
  });
});

// ─── runHealthCheck — JIFFY probe ────────────────────────────────────────────

describe('runHealthCheck — JIFFY probe', () => {
  it('fails JIFFY when fewer than 3 bytes returned', async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === '00A2') return Promise.resolve(new Uint8Array([0x01]));
      if (addr === 'D012') return Promise.resolve(new Uint8Array([0x42]));
      return Promise.resolve(new Uint8Array(0));
    });
    mockGetConfigItem.mockResolvedValue(ledResp).mockResolvedValueOnce(ledResp);
    // All getConfigItem calls
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce({ 'LED Strip Settings': { 'Strip Intensity': { selected: 6 } } })
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.JIFFY.outcome).toBe('Fail');
    expect(result!.probes.JIFFY.reason).toContain('Expected 3 bytes');
  });

  it('skips JIFFY when readMemory throws', async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === '00A2') return Promise.reject(new Error('Read failed'));
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce({ 'LED Strip Settings': { 'Strip Intensity': { selected: 6 } } })
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.JIFFY.outcome).toBe('Fail');
  });
});

// ─── runHealthCheck — RASTER probe (optional) ────────────────────────────────

describe('runHealthCheck — RASTER probe', () => {
  it('skips RASTER when readMemory returns empty bytes', async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === '00A2') return Promise.resolve(jiffyBytes);
      if (addr === 'D012') return Promise.resolve(new Uint8Array(0)); // empty
      return Promise.resolve(new Uint8Array(0));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce({ 'LED Strip Settings': { 'Strip Intensity': { selected: 6 } } })
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.RASTER.outcome).toBe('Skipped');
  });

  it('skips RASTER when readMemory throws (unsupported)', async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === '00A2') return Promise.resolve(jiffyBytes);
      return Promise.reject(new Error('Unsupported register'));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce({ 'LED Strip Settings': { 'Strip Intensity': { selected: 6 } } })
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.RASTER.outcome).toBe('Skipped');
  });
});

// ─── runHealthCheck — CONFIG probe ───────────────────────────────────────────

describe('runHealthCheck — CONFIG probe', () => {
  it('fails CONFIG when readback value does not match written value', async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === '00A2') return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // Initial read=5, writeTemp=6 is sent, but readback returns 5 (no change)
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp) // initial read: 5
      .mockResolvedValueOnce(ledResp) // readback: still 5, expected 6 → mismatch
      .mockResolvedValueOnce(ledResp); // verify
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe('Fail');
    expect(result!.probes.CONFIG.reason).toContain('Readback mismatch');
  });

  it('fails CONFIG when post-revert verify mismatches', async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === '00A2') return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // Initial=5, writeTemp=6, readback=6 (ok), revert to 5, verify returns 6 (fail)
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp) // initial: 5
      .mockResolvedValueOnce({ 'LED Strip Settings': { 'Strip Intensity': { selected: 6 } } }) // readback: 6 ok
      .mockResolvedValueOnce({ 'LED Strip Settings': { 'Strip Intensity': { selected: 6 } } }); // verify: 6 ≠ 5
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe('Fail');
    expect(result!.probes.CONFIG.reason).toContain('Post-revert mismatch');
  });

  it('skips CONFIG when no suitable target is available', async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === '00A2') return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    // getConfigItem returns empty data for all targets → both targets skipped
    mockGetConfigItem.mockResolvedValue({});
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockResolvedValue([]);

    const result = await runHealthCheck();
    expect(result!.probes.CONFIG.outcome).toBe('Skipped');
  });
});

// ─── runHealthCheck — FTP probe ───────────────────────────────────────────────

describe('runHealthCheck — FTP probe', () => {
  it('fails FTP when listFtpDirectory throws', async () => {
    mockGetInfo.mockResolvedValue(successfulInfo);
    mockReadMemory.mockImplementation((addr: string) => {
      if (addr === '00A2') return Promise.resolve(jiffyBytes);
      return Promise.resolve(new Uint8Array([0x42]));
    });
    mockGetConfigItem
      .mockResolvedValueOnce(ledResp)
      .mockResolvedValueOnce({ 'LED Strip Settings': { 'Strip Intensity': { selected: 6 } } })
      .mockResolvedValueOnce(ledResp);
    mockSetConfigValue.mockResolvedValue(undefined);
    mockListFtpDirectory.mockRejectedValue(new Error('FTP connection refused'));

    const result = await runHealthCheck();
    expect(result!.probes.FTP.outcome).toBe('Fail');
    expect(result!.probes.FTP.reason).toContain('FTP connection refused');
  });
});
