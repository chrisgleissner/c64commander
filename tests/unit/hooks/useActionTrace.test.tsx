/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const createActionContext = vi.fn();
const runWithActionTrace = vi.fn();
const runActionScope = vi.fn();

vi.mock('@/lib/tracing/actionTrace', () => ({
  createActionContext: (...args: unknown[]) => createActionContext(...args),
  runWithActionTrace: (...args: unknown[]) => runWithActionTrace(...args),
  runActionScope: (...args: unknown[]) => runActionScope(...args),
}));

import { useActionTrace } from '@/hooks/useActionTrace';

describe('useActionTrace', () => {
  it('wraps actions with inferred names', async () => {
    createActionContext.mockReset();
    runWithActionTrace.mockReset();
    createActionContext.mockReturnValue({ correlationId: 'COR-1' });
    runWithActionTrace.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());

    const { result } = renderHook(() => useActionTrace('Widget'));
    const doThing = (value: number) => value + 1;
    const handler = result.current(doThing);

    let output = 0;
    act(() => {
      output = handler(2);
    });

    expect(output).toBe(3);
    expect(createActionContext).toHaveBeenCalledWith('Widget.doThing', 'user', 'Widget');
    expect(runWithActionTrace).toHaveBeenCalled();
  });

  it('exposes action scope helper', async () => {
    const { result } = renderHook(() => useActionTrace('Widget'));

    await result.current.scope('scope', async () => undefined);

    expect(runActionScope).toHaveBeenCalledWith('scope', expect.any(Function));
  });

  it('infers component name from stack when not provided', () => {
    createActionContext.mockReset();
    runWithActionTrace.mockReset();
    createActionContext.mockReturnValue({ correlationId: 'COR-2' });
    runWithActionTrace.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());

    class MockError extends Error {
      constructor() {
        super('stack');
        this.stack = 'Error\n  at FakeComponent (fake.tsx:1:1)\n  at useActionTrace (hook.ts:1:1)';
      }
    }

    vi.stubGlobal('Error', MockError as unknown as typeof Error);

    const { result } = renderHook(() => useActionTrace());
    const handler = result.current(function doThing() {
      return 42;
    });

    let output = 0;
    act(() => {
      output = handler();
    });

    expect(output).toBe(42);
    expect(createActionContext).toHaveBeenCalledWith('Error.doThing', 'user', 'Error');

    vi.unstubAllGlobals();
  });

  it('falls back to anonymous action naming', () => {
    createActionContext.mockReset();
    runWithActionTrace.mockReset();
    createActionContext.mockReturnValue({ correlationId: 'COR-3' });
    runWithActionTrace.mockImplementation((_ctx: unknown, fn: () => unknown) => fn());

    const { result } = renderHook(() => useActionTrace('Widget'));
    const fn = () => 7;
    Object.defineProperty(fn, 'name', { value: '' });
    const handler = result.current(fn);

    let output = 0;
    act(() => {
      output = handler();
    });

    expect(output).toBe(7);
    expect(createActionContext).toHaveBeenCalledWith('Widget.anonymousAction', 'user', 'Widget');
  });
});
