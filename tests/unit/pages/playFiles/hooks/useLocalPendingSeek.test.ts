/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createElement, type ReactNode } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingSeekState } from "@/lib/playback/pendingSeekStatus";

const engine = vi.hoisted(() => ({
  pending: null as PendingSeekState | null,
  rendered: null as number | null,
  reads: 0,
  seekListeners: new Set<() => void>(),
}));

vi.mock("@/lib/playback/localSidPlaybackController", () => ({
  getSharedLocalSidPlaybackController: () => ({
    renderedSeconds: () => {
      engine.reads += 1;
      return engine.rendered;
    },
    pendingSeek: () => (engine.pending ? { ...engine.pending } : null),
    debugState: () => ({}),
    onSeek: (listener: () => void) => {
      engine.seekListeners.add(listener);
      return () => engine.seekListeners.delete(listener);
    },
  }),
}));

import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { AWAITING_POLL_MS, IDLE_POLL_MS, useLocalPendingSeek } from "@/pages/playFiles/hooks/useLocalPendingSeek";

const waiting: PendingSeekState = {
  targetSeconds: 108,
  renderedAtRequestSeconds: 6,
  audibleAtRequestSeconds: 3,
  generation: 2,
  trackInstanceId: 4,
};

describe("useLocalPendingSeek", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    engine.pending = null;
    engine.rendered = 10;
    engine.reads = 0;
    engine.seekListeners.clear();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports the render head and the seek being waited for", () => {
    engine.pending = waiting;
    const { result } = renderHook(() => useLocalPendingSeek(true, "tune", vi.fn()));
    expect(result.current).toEqual({ renderedSeconds: 10, pendingSeekState: waiting });
  });

  it("keeps the same record while the engine reports the same seek, so the page does not re-render", () => {
    engine.pending = waiting;
    const { result } = renderHook(() => useLocalPendingSeek(true, "tune", vi.fn()));
    const first = result.current.pendingSeekState;
    act(() => vi.advanceTimersByTime(AWAITING_POLL_MS * 3));
    expect(result.current.pendingSeekState).toBe(first);
  });

  it("shows a seek that has to wait as soon as it is made, not on the next poll", () => {
    // Until the poll, the page showed the target as reached while the engine sat silent: the parity
    // HIL read that as a landing and listened through the whole wait.
    const { result } = renderHook(() => useLocalPendingSeek(true, "tune", vi.fn()));
    expect(result.current.pendingSeekState).toBeNull();
    engine.pending = waiting;
    act(() => engine.seekListeners.forEach((listener) => listener()));
    expect(result.current.pendingSeekState).toEqual(waiting);
  });

  it("stops listening for seeks once the engine is no longer playing here", () => {
    const { rerender } = renderHook(({ active }) => useLocalPendingSeek(active, "tune", vi.fn()), {
      initialProps: { active: true },
    });
    expect(engine.seekListeners.size).toBe(1);
    rerender({ active: false });
    expect(engine.seekListeners.size).toBe(0);
  });

  it("polls quickly only while a seek waits", () => {
    renderHook(() => useLocalPendingSeek(true, "tune", vi.fn()));
    engine.reads = 0;
    act(() => vi.advanceTimersByTime(IDLE_POLL_MS * 2));
    expect(engine.reads).toBe(2);

    engine.pending = waiting;
    act(() => vi.advanceTimersByTime(IDLE_POLL_MS));
    engine.reads = 0;
    act(() => vi.advanceTimersByTime(AWAITING_POLL_MS * 5));
    expect(engine.reads).toBe(5);
  });

  it("calls onLanded within one fast poll of the engine finishing the wait, and only then", () => {
    engine.pending = waiting;
    const onLanded = vi.fn();
    renderHook(() => useLocalPendingSeek(true, "tune", onLanded));
    act(() => vi.advanceTimersByTime(AWAITING_POLL_MS * 3));
    expect(onLanded).not.toHaveBeenCalled();

    engine.pending = null;
    act(() => vi.advanceTimersByTime(AWAITING_POLL_MS));
    expect(onLanded).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(IDLE_POLL_MS * 3));
    expect(onLanded).toHaveBeenCalledTimes(1);
  });

  it("reports nothing and stops polling while the tune is not playing on the phone", () => {
    engine.pending = waiting;
    const { result } = renderHook(() => useLocalPendingSeek(false, "tune", vi.fn()));
    engine.reads = 0;
    act(() => vi.advanceTimersByTime(IDLE_POLL_MS * 4));
    expect(result.current).toEqual({ renderedSeconds: null, pendingSeekState: null });
    expect(engine.reads).toBe(0);
  });

  it("does not poll the engine while the Play page is off screen, and reads it at once when it is shown again", () => {
    let onScreen = true;
    const { result, rerender } = renderHook(() => useLocalPendingSeek(true, "tune", vi.fn()), {
      wrapper: ({ children }: { children: ReactNode }) =>
        createElement(ScreenActivityProvider, { active: onScreen }, children),
    });
    expect(result.current.renderedSeconds).toBe(10);

    onScreen = false;
    rerender();
    engine.reads = 0;
    engine.rendered = 42;
    act(() => vi.advanceTimersByTime(IDLE_POLL_MS * 10));
    expect(engine.reads).toBe(0);
    expect(result.current.renderedSeconds).toBe(10);

    onScreen = true;
    rerender();
    expect(engine.reads).toBe(1);
    expect(result.current.renderedSeconds).toBe(42);
  });
});
