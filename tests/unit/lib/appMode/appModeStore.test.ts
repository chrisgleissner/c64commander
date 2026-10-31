/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const addLog = vi.fn();
vi.mock("@/lib/logging", () => ({ addLog: (...args: unknown[]) => addLog(...args) }));

const loadStore = async (variantStartupMode: string) => {
  vi.resetModules();
  vi.doMock("@/generated/variant", () => ({ variant: { runtime: { startupMode: variantStartupMode } } }));
  return import("@/lib/appMode/appModeStore");
};

describe("appModeStore", () => {
  beforeEach(() => {
    localStorage.clear();
    addLog.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("SPM-ARCH-01 returns the variant start-up mode when the user has not chosen", async () => {
    const store = await loadStore("sid-player");
    expect(store.loadStartupMode()).toBe("sid-player");
    expect(store.getAppMode()).toBe("sid-player");
    expect(store.isSidPlayerActive()).toBe(true);
  });

  it("SPM-ARCH-01 SPM-VAR-02 a stored user choice wins over the variant start-up mode", async () => {
    localStorage.setItem("c64u_startup_mode", "default");
    const store = await loadStore("sid-player");
    expect(store.loadStartupMode()).toBe("default");
    expect(store.getAppMode()).toBe("full");
  });

  it("SPM-ARCH-01 ignores an unknown stored value and logs a warning", async () => {
    localStorage.setItem("c64u_startup_mode", "karaoke");
    const store = await loadStore("demo");
    expect(store.loadStartupMode()).toBe("demo");
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("unknown stored start-up mode"), {
      key: "c64u_startup_mode",
      stored: "karaoke",
    });
  });

  it("SPM-ARCH-01 storage that throws falls back to the variant value and logs", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    const store = await loadStore("sid-player");
    expect(store.loadStartupMode()).toBe("sid-player");
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("read the stored start-up mode"), {
      key: "c64u_startup_mode",
      error: "denied",
    });
  });

  it("SPM-ARCH-01 persists a user choice, keeps it when persisting fails, and logs the failure", async () => {
    const store = await loadStore("default");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("full");
    });
    store.saveStartupModeByUser("sid-player");
    expect(store.getAppMode()).toBe("sid-player");
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("persist the start-up mode"), {
      key: "c64u_startup_mode",
      mode: "sid-player",
      error: "full",
    });
  });

  it("SPM-ARCH-01 notifies subscribers once per change and announces it to the Settings page", async () => {
    const store = await loadStore("default");
    const listener = vi.fn();
    const settingsEvent = vi.fn();
    window.addEventListener("c64u-app-settings-updated", settingsEvent);
    const unsubscribe = store.subscribeAppMode(listener);
    store.saveStartupModeByUser("sid-player");
    store.saveStartupModeByUser("sid-player");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(settingsEvent).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("c64u_startup_mode")).toBe("sid-player");
    unsubscribe();
    store.saveStartupModeByUser("demo");
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener("c64u-app-settings-updated", settingsEvent);
  });

  it("SPM-ARCH-01 Demo Mode as a start-up mode is the Full App mode", async () => {
    const store = await loadStore("demo");
    expect(store.loadStartupMode()).toBe("demo");
    expect(store.getAppMode()).toBe("full");
  });
});
