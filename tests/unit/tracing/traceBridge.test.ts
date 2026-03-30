/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { resetActionTrace } = vi.hoisted(() => ({ resetActionTrace: vi.fn() }));
vi.mock('@/lib/tracing/actionTrace', () => ({ resetActionTrace }));

const {
  clearTraceEvents,
  exportTraceZip,
  getTraceEvents,
  persistTracesToSession,
  replaceTraceEvents,
  resetTraceSession,
  restoreTracesFromSession,
} = vi.hoisted(() => ({
  clearTraceEvents: vi.fn(),
  exportTraceZip: vi.fn(() => new Uint8Array([1, 2, 3])),
  getTraceEvents: vi.fn(() => []),
  persistTracesToSession: vi.fn(),
  replaceTraceEvents: vi.fn(),
  resetTraceSession: vi.fn(),
  restoreTracesFromSession: vi.fn(),
}));
vi.mock('@/lib/tracing/traceSession', () => ({
  clearTraceEvents,
  exportTraceZip,
  getTraceEvents,
  persistTracesToSession,
  replaceTraceEvents,
  resetTraceSession,
  restoreTracesFromSession,
}));

const { resetTraceIds } = vi.hoisted(() => ({ resetTraceIds: vi.fn() }));
vi.mock('@/lib/tracing/traceIds', () => ({ resetTraceIds }));

import { registerTraceBridge } from '@/lib/tracing/traceBridge';

describe('traceBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset window state
    (window as Window & { __c64uTracing?: unknown; __c64uTestProbeEnabled?: boolean }).__c64uTracing =
      undefined;
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = undefined;
  });

  it('registers the bridge and restores traces from session', () => {
    registerTraceBridge();

    expect(restoreTracesFromSession).toHaveBeenCalledTimes(1);
    expect((window as Window & { __c64uTracing?: unknown }).__c64uTracing).toBeDefined();
  });

  it('clears traces via bridge.clearTraces', () => {
    registerTraceBridge();
    const bridge = (window as Window & { __c64uTracing?: { clearTraces: () => void } }).__c64uTracing!;
    bridge.clearTraces();

    expect(resetActionTrace).toHaveBeenCalledTimes(1);
    expect(clearTraceEvents).toHaveBeenCalledTimes(1);
  });

  it('returns traces via bridge.getTraces', () => {
    getTraceEvents.mockReturnValue([{ id: 1 }] as unknown as ReturnType<typeof getTraceEvents>);
    registerTraceBridge();
    const bridge = (
      window as Window & { __c64uTracing?: { getTraces: () => unknown } }
    ).__c64uTracing!;

    expect(bridge.getTraces()).toEqual([{ id: 1 }]);
  });

  it('exports traces via bridge.exportTraces', () => {
    exportTraceZip.mockReturnValue(new Uint8Array([9, 8, 7]));
    registerTraceBridge();
    const bridge = (
      window as Window & { __c64uTracing?: { exportTraces: () => Uint8Array } }
    ).__c64uTracing!;

    const result = bridge.exportTraces();
    expect(result).toBeInstanceOf(Uint8Array);
  });

  it('resets trace ids with defaults via bridge.resetTraceIds', () => {
    registerTraceBridge();
    const bridge = (
      window as Window & { __c64uTracing?: { resetTraceIds: (a?: number, b?: number) => void } }
    ).__c64uTracing!;
    bridge.resetTraceIds();

    expect(resetTraceIds).toHaveBeenCalledWith(0, 0);
  });

  it('resets trace ids with custom values via bridge.resetTraceIds', () => {
    registerTraceBridge();
    const bridge = (
      window as Window & { __c64uTracing?: { resetTraceIds: (a?: number, b?: number) => void } }
    ).__c64uTracing!;
    bridge.resetTraceIds(100, 200);

    expect(resetTraceIds).toHaveBeenCalledWith(100, 200);
  });

  it('resets trace session with defaults via bridge.resetTraceSession', () => {
    registerTraceBridge();
    const bridge = (
      window as Window & { __c64uTracing?: { resetTraceSession: (a?: number, b?: number) => void } }
    ).__c64uTracing!;
    bridge.resetTraceSession();

    expect(resetActionTrace).toHaveBeenCalledTimes(1);
    expect(resetTraceSession).toHaveBeenCalledWith(0, 0);
  });

  it('persists and restores traces via bridge delegates', () => {
    registerTraceBridge();
    const bridge = (
      window as Window & {
        __c64uTracing?: {
          persistTracesToSession: () => void;
          restoreTracesFromSession: () => void;
        };
      }
    ).__c64uTracing!;
    bridge.persistTracesToSession();
    bridge.restoreTracesFromSession();

    expect(persistTracesToSession).toHaveBeenCalledTimes(1);
    expect(restoreTracesFromSession).toHaveBeenCalledTimes(2); // once on register + once manually
  });

  it('does not re-register when bridge already exists without test probe', () => {
    registerTraceBridge();
    const firstBridge = (window as Window & { __c64uTracing?: unknown }).__c64uTracing;
    vi.clearAllMocks();

    registerTraceBridge();

    // should not call restoreTracesFromSession again
    expect(restoreTracesFromSession).not.toHaveBeenCalled();
    expect((window as Window & { __c64uTracing?: unknown }).__c64uTracing).toBe(firstBridge);
  });

  it('registers seedTraces when test probe is enabled', () => {
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    registerTraceBridge();

    const bridge = (
      window as Window & { __c64uTracing?: { seedTraces?: (e: unknown) => void } }
    ).__c64uTracing!;
    expect(bridge.seedTraces).toBeDefined();
  });

  it('seedTraces resets action trace and replaces events', () => {
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    registerTraceBridge();

    const bridge = (
      window as Window & {
        __c64uTracing?: { seedTraces?: (e: ReturnType<typeof getTraceEvents>) => void };
      }
    ).__c64uTracing!;
    const fakeEvents = [{ id: 42 }] as unknown as ReturnType<typeof getTraceEvents>;
    bridge.seedTraces!(fakeEvents);

    expect(resetActionTrace).toHaveBeenCalledTimes(1);
    expect(replaceTraceEvents).toHaveBeenCalledWith(fakeEvents);
  });

  it('adds seedTraces to existing bridge when test probe is enabled on second call', () => {
    // First register without probe
    registerTraceBridge();
    const bridge = (
      window as Window & { __c64uTracing?: { seedTraces?: unknown } }
    ).__c64uTracing;
    expect(bridge?.seedTraces).toBeUndefined();

    // Now enable probe and re-register
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    registerTraceBridge();

    expect(
      (window as Window & { __c64uTracing?: { seedTraces?: unknown } }).__c64uTracing?.seedTraces,
    ).toBeDefined();
  });

  it('seedTraces via existing-bridge path resets action trace and replaces events', () => {
    // First register without probe to create the bridge
    registerTraceBridge();
    // Enable probe and re-register to add seedTraces via the PATH A (existing bridge) branch
    (window as Window & { __c64uTestProbeEnabled?: boolean }).__c64uTestProbeEnabled = true;
    registerTraceBridge();

    const bridge = (
      window as Window & {
        __c64uTracing?: { seedTraces?: (e: ReturnType<typeof getTraceEvents>) => void };
      }
    ).__c64uTracing!;
    const fakeEvents = [{ id: 99 }] as unknown as ReturnType<typeof getTraceEvents>;
    bridge.seedTraces!(fakeEvents);

    expect(resetActionTrace).toHaveBeenCalledTimes(1);
    expect(replaceTraceEvents).toHaveBeenCalledWith(fakeEvents);
  });

  it('fires beforeunload to persist traces', () => {
    registerTraceBridge();
    vi.clearAllMocks();
    window.dispatchEvent(new Event('beforeunload'));

    expect(persistTracesToSession).toHaveBeenCalled();
  });

  it('registers seedTraces when VITE_ENABLE_TEST_PROBES process env is set', () => {
    const prev = process.env.VITE_ENABLE_TEST_PROBES;
    process.env.VITE_ENABLE_TEST_PROBES = '1';
    try {
      registerTraceBridge();
      const bridge = (
        window as Window & { __c64uTracing?: { seedTraces?: unknown } }
      ).__c64uTracing!;
      expect(bridge.seedTraces).toBeDefined();
    } finally {
      if (prev === undefined) {
        delete process.env.VITE_ENABLE_TEST_PROBES;
      } else {
        process.env.VITE_ENABLE_TEST_PROBES = prev;
      }
    }
  });
});
