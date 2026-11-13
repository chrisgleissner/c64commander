/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logging", () => ({ addLog: vi.fn(), addErrorLog: vi.fn() }));

const stubIndexedDbUpgrade = (storeExists: boolean) => {
  const createObjectStore = vi.fn();
  const database = { objectStoreNames: { contains: () => storeExists }, createObjectStore };
  vi.stubGlobal("indexedDB", {
    open: () => {
      const request: { result: unknown; error: Error; onupgradeneeded?: () => void; onerror?: () => void } = {
        result: database,
        error: new Error("open refused"),
      };
      queueMicrotask(() => {
        request.onupgradeneeded?.();
        request.onerror?.();
      });
      return request;
    },
  });
  return createObjectStore;
};

describe("the saved-device dependency scan opening the playlist database", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.resetModules();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("creates the playlist store when the upgrade finds it missing", async () => {
    const createObjectStore = stubIndexedDbUpgrade(false);
    const { getSavedDeviceDependencySummary } = await import("@/lib/savedDevices/deviceDependencies");

    await expect(getSavedDeviceDependencySummary("device-1")).rejects.toThrow("open refused");
    expect(createObjectStore).toHaveBeenCalledTimes(1);
  });

  it("leaves the playlist store alone when the upgrade finds it present", async () => {
    const createObjectStore = stubIndexedDbUpgrade(true);
    const { getSavedDeviceDependencySummary } = await import("@/lib/savedDevices/deviceDependencies");

    await expect(getSavedDeviceDependencySummary("device-1")).rejects.toThrow("open refused");
    expect(createObjectStore).not.toHaveBeenCalled();
  });
});
