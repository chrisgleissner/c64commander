/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { pollingPauseRegistry } from "@/lib/query/c64PollingGovernance";

describe("pollingPauseRegistry", () => {
  afterEach(() => {
    pollingPauseRegistry.__resetForTest();
  });

  it("starts unpaused", () => {
    expect(pollingPauseRegistry.isPollingPaused()).toBe(false);
  });

  it("is paused while at least one handle is held", () => {
    const handle = pollingPauseRegistry.acquirePause();
    expect(pollingPauseRegistry.isPollingPaused()).toBe(true);
    handle.release();
    expect(pollingPauseRegistry.isPollingPaused()).toBe(false);
  });

  it("reference-counts overlapping pauses", () => {
    const a = pollingPauseRegistry.acquirePause();
    const b = pollingPauseRegistry.acquirePause();
    expect(pollingPauseRegistry.isPollingPaused()).toBe(true);
    a.release();
    expect(pollingPauseRegistry.isPollingPaused()).toBe(true);
    b.release();
    expect(pollingPauseRegistry.isPollingPaused()).toBe(false);
  });

  it("ignores double-release on the same handle", () => {
    const a = pollingPauseRegistry.acquirePause();
    a.release();
    a.release();
    expect(pollingPauseRegistry.isPollingPaused()).toBe(false);
  });

  it("notifies subscribers on edge transitions only", () => {
    const listener = vi.fn();
    const unsubscribe = pollingPauseRegistry.subscribe(listener);
    const a = pollingPauseRegistry.acquirePause();
    expect(listener).toHaveBeenCalledTimes(1); // 0 -> 1
    const b = pollingPauseRegistry.acquirePause();
    expect(listener).toHaveBeenCalledTimes(1); // 1 -> 2 (no edge)
    a.release();
    expect(listener).toHaveBeenCalledTimes(1); // 2 -> 1 (no edge)
    b.release();
    expect(listener).toHaveBeenCalledTimes(2); // 1 -> 0
    unsubscribe();
  });

  it("isolates listener crashes", () => {
    const good = vi.fn();
    pollingPauseRegistry.subscribe(() => {
      throw new Error("listener boom");
    });
    pollingPauseRegistry.subscribe(good);
    const a = pollingPauseRegistry.acquirePause();
    expect(good).toHaveBeenCalledTimes(1);
    a.release();
  });
});
