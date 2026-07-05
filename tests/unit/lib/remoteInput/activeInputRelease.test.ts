/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addLogMock = vi.fn();

vi.mock("@/lib/logging", () => ({
  addLog: (...args: unknown[]) => addLogMock(...args),
  buildErrorLogDetails: (error: Error, context: Record<string, unknown>) => ({ error: error.message, ...context }),
}));

import {
  hasActiveInputRelease,
  registerActiveInputRelease,
  releaseActiveRemoteInput,
  resetActiveInputReleaseForTests,
  unregisterActiveInputRelease,
} from "@/lib/remoteInput/activeInputRelease";

describe("activeInputRelease", () => {
  beforeEach(() => {
    addLogMock.mockClear();
    resetActiveInputReleaseForTests();
  });

  afterEach(() => {
    resetActiveInputReleaseForTests();
  });

  it("keeps the surviving registrant releasable after a transient second registrant unregisters (HARD16-010)", async () => {
    const releaseA = vi.fn(async () => undefined);
    const releaseB = vi.fn(async () => undefined);

    registerActiveInputRelease(releaseA);
    registerActiveInputRelease(releaseB);
    unregisterActiveInputRelease(releaseB);

    expect(hasActiveInputRelease()).toBe(true);

    await releaseActiveRemoteInput();

    expect(releaseA).toHaveBeenCalledTimes(1);
    expect(releaseB).not.toHaveBeenCalled();
  });

  it("releases every registered session when more than one sheet is mounted (HARD16-010)", async () => {
    const releaseA = vi.fn(async () => undefined);
    const releaseB = vi.fn(async () => undefined);

    registerActiveInputRelease(releaseA);
    registerActiveInputRelease(releaseB);

    await releaseActiveRemoteInput();

    expect(releaseA).toHaveBeenCalledTimes(1);
    expect(releaseB).toHaveBeenCalledTimes(1);
  });

  it("does not let one rejecting release prevent the other from running (logged at WARN)", async () => {
    const releaseA = vi.fn(async () => {
      throw new Error("device unreachable");
    });
    const releaseB = vi.fn(async () => undefined);

    registerActiveInputRelease(releaseA);
    registerActiveInputRelease(releaseB);

    await releaseActiveRemoteInput();

    expect(releaseB).toHaveBeenCalledTimes(1);
    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Pre-switch active remote input release failed",
      expect.any(Object),
    );
  });

  it("reports no active release and is a no-op once the last registrant unregisters", async () => {
    const releaseA = vi.fn(async () => undefined);
    registerActiveInputRelease(releaseA);
    unregisterActiveInputRelease(releaseA);

    expect(hasActiveInputRelease()).toBe(false);
    await releaseActiveRemoteInput();
    expect(releaseA).not.toHaveBeenCalled();
  });
});
