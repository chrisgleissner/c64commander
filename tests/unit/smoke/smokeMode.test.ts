/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeSmokeMode,
  getSmokeConfig,
  isSmokeModeEnabled,
  isSmokeReadOnlyEnabled,
  recordSmokeStatus,
} from "@/lib/smoke/smokeMode";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";
import { Capacitor } from "@capacitor/core";
import { addLog } from "@/lib/logging";
import { saveDebugLoggingEnabled } from "@/lib/config/appSettings";
import { FeatureFlags as FeatureFlagsPlugin } from "@/lib/native/featureFlags";

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: vi.fn(() => false),
    getPlatform: vi.fn(() => "web"),
  },
  registerPlugin: vi.fn(() => ({})),
}));

vi.mock("@capacitor/filesystem", () => ({
  Directory: { Data: "DATA" },
  Encoding: { UTF8: "utf8" },
  Filesystem: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

vi.mock("@/lib/config/appSettings", () => ({
  saveDebugLoggingEnabled: vi.fn(),
}));

vi.mock("@/lib/native/featureFlags", () => ({
  FeatureFlags: {
    setFlag: vi.fn(),
  },
}));

describe("smokeMode", () => {
  beforeEach(() => {
    localStorage.clear();
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = false;
    vi.mocked(addLog).mockClear();
    vi.mocked(saveDebugLoggingEnabled).mockClear();
    vi.mocked(FeatureFlagsPlugin.setFlag).mockClear();
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    vi.mocked(Filesystem.readFile).mockReset();
    vi.mocked(Filesystem.writeFile).mockReset();
    sessionStorage.clear();
  });

  it("initializes from storage and persists host + logging", async () => {
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "real",
        host: "http://Example.com",
        readOnly: false,
        debugLogging: true,
      }),
    );

    const config = await initializeSmokeMode();

    expect(config).toEqual({
      target: "real",
      host: "example.com",
      readOnly: false,
      debugLogging: true,
    });
    expect(getSmokeConfig()).toEqual(config);
    expect(isSmokeModeEnabled()).toBe(true);
    expect(isSmokeReadOnlyEnabled()).toBe(false);
    expect(localStorage.getItem("c64u_device_host")).toBe("example.com");
    expect(localStorage.getItem("c64u_smoke_mode_enabled")).toBe("1");
    expect(saveDebugLoggingEnabled).toHaveBeenCalledWith(true);
    expect(addLog).toHaveBeenCalledWith("info", "Smoke mode enabled", expect.any(Object));
  });

  it("loads config from native storage when local storage is empty", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    (window as Window & { __c64uReadSmokeConfigFromFilesystem?: boolean }).__c64uReadSmokeConfigFromFilesystem = true;
    vi.mocked(Filesystem.readFile).mockResolvedValue({
      data: JSON.stringify({
        target: "mock",
        readOnly: true,
        debugLogging: false,
      }),
    });

    const config = await initializeSmokeMode();

    expect(config).toEqual({
      target: "mock",
      host: undefined,
      readOnly: true,
      debugLogging: false,
    });
    expect(saveDebugLoggingEnabled).not.toHaveBeenCalled();
  });

  it("applies smoke feature flags to plugin and storage during initialization", async () => {
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "mock",
        featureFlags: {
          hvsc_enabled: true,
        },
      }),
    );

    const config = await initializeSmokeMode();

    expect(config?.featureFlags).toEqual({ hvsc_enabled: true });
    expect(FeatureFlagsPlugin.setFlag).toHaveBeenCalledWith({
      key: "hvsc_enabled",
      value: true,
    });
    expect(localStorage.getItem("c64u_feature_flag:hvsc_enabled")).toBe("1");
    expect(sessionStorage.getItem("c64u_feature_flag:hvsc_enabled")).toBe("1");
  });

  it("ignores unknown or invalid smoke feature flag values", async () => {
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "mock",
        featureFlags: {
          hvsc_enabled: "yes",
          unknown_flag: true,
        },
      }),
    );

    const config = await initializeSmokeMode();

    expect(config?.featureFlags).toBeUndefined();
    expect(FeatureFlagsPlugin.setFlag).not.toHaveBeenCalled();
  });

  it("logs warning when applying a smoke feature flag fails", async () => {
    vi.mocked(FeatureFlagsPlugin.setFlag).mockRejectedValueOnce(new Error("plugin write failed"));
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "mock",
        featureFlags: {
          hvsc_enabled: false,
        },
      }),
    );

    const config = await initializeSmokeMode();

    expect(config?.featureFlags).toEqual({ hvsc_enabled: false });
    expect(addLog).toHaveBeenCalledWith("warn", "Failed to apply smoke feature flag", expect.any(Object));
    expect(localStorage.getItem("c64u_feature_flag:hvsc_enabled")).toBe("0");
    expect(sessionStorage.getItem("c64u_feature_flag:hvsc_enabled")).toBe("0");
  });

  it("logs warning when persisting smoke feature flags to storage fails", async () => {
    const originalSetItem = Storage.prototype.setItem;
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (key, value) {
      if (key.startsWith("c64u_feature_flag:")) {
        throw new Error("storage quota exceeded");
      }
      return originalSetItem.call(this, key, value);
    });
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "mock",
        featureFlags: {
          hvsc_enabled: true,
        },
      }),
    );

    await initializeSmokeMode();

    expect(FeatureFlagsPlugin.setFlag).toHaveBeenCalledWith({
      key: "hvsc_enabled",
      value: true,
    });
    expect(addLog).toHaveBeenCalledWith("warn", "Failed to persist smoke feature flag in storage", expect.any(Object));

    setItemSpy.mockRestore();
  });

  it("records smoke status on native platforms", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "real",
        readOnly: true,
        debugLogging: false,
      }),
    );

    await initializeSmokeMode();
    await recordSmokeStatus({ state: "DEMO_ACTIVE", mode: "demo" });

    expect(Filesystem.writeFile).toHaveBeenCalledWith({
      path: "c64u-smoke-status.json",
      directory: Directory.Data,
      data: expect.stringContaining("DEMO_ACTIVE"),
      encoding: Encoding.UTF8,
    });
  });

  it("returns null for invalid config target", async () => {
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "invalid-target",
      }),
    );

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(isSmokeModeEnabled()).toBe(false);
  });

  it("returns null for non-object config", async () => {
    localStorage.setItem("c64u_smoke_config", '"not an object"');

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
  });

  it("handles malformed JSON in storage gracefully", async () => {
    localStorage.setItem("c64u_smoke_config", "{broken json");

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("parse"), expect.any(Object));
  });

  it("skips host persistence when host is absent", async () => {
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "mock",
      }),
    );

    const config = await initializeSmokeMode();
    expect(config?.host).toBeUndefined();
    expect(localStorage.getItem("c64u_device_host")).toBeNull();
  });

  it("defaults readOnly to true when not specified", async () => {
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "mock",
      }),
    );

    const config = await initializeSmokeMode();
    expect(config?.readOnly).toBe(true);
    expect(isSmokeReadOnlyEnabled()).toBe(true);
  });

  it("skips recordSmokeStatus when config not initialized", async () => {
    await recordSmokeStatus({ state: "DEMO_ACTIVE" });
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });

  it("skips recordSmokeStatus on non-native platform", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(false);
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "mock",
      }),
    );
    await initializeSmokeMode();
    await recordSmokeStatus({ state: "DEMO_ACTIVE" });
    expect(Filesystem.writeFile).not.toHaveBeenCalled();
  });

  it("logs warning when recordSmokeStatus write fails", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "mock",
      }),
    );
    vi.mocked(Filesystem.writeFile).mockRejectedValue(new Error("write error"));

    await initializeSmokeMode();
    await recordSmokeStatus({ state: "DEMO_ACTIVE" });
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("smoke status"), expect.any(Object));
  });

  it("handles filesystem read error for missing file", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem("c64u_smoke_mode_enabled", "1");
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("File does not exist"));

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(addLog).toHaveBeenCalledWith("debug", expect.stringContaining("not found"), expect.any(Object));
  });

  it("handles filesystem read error for generic error", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem("c64u_smoke_mode_enabled", "1");
    vi.mocked(Filesystem.readFile).mockRejectedValue(new Error("Permission denied"));

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(addLog).toHaveBeenCalledWith("warn", expect.stringContaining("read smoke"), expect.any(Object));
  });

  it("reads from filesystem via VITE_ENABLE_TEST_PROBES", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    const originalEnv = import.meta.env.VITE_ENABLE_TEST_PROBES;
    import.meta.env.VITE_ENABLE_TEST_PROBES = "1";
    vi.mocked(Filesystem.readFile).mockResolvedValue({
      data: JSON.stringify({ target: "mock" }),
    });

    const config = await initializeSmokeMode();
    expect(config?.target).toBe("mock");

    import.meta.env.VITE_ENABLE_TEST_PROBES = originalEnv;
  });

  it("normalizes host with empty string to undefined", async () => {
    localStorage.setItem(
      "c64u_smoke_config",
      JSON.stringify({
        target: "real",
        host: "  ",
      }),
    );

    const config = await initializeSmokeMode();
    expect(config?.host).toBeUndefined();
  });

  it("handles filesystem read error thrown as plain string", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem("c64u_smoke_mode_enabled", "1");
    // Use a plain string rejection — exercises typeof error === 'string' in getErrorMessage
    vi.mocked(Filesystem.readFile).mockRejectedValue("File does not exist");

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    // String 'File does not exist' matches isMissingFileError → debug log
    expect(addLog).toHaveBeenCalledWith("debug", expect.stringContaining("not found"), expect.any(Object));
  });

  it("handles filesystem read error as object with nested error string", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem("c64u_smoke_mode_enabled", "1");
    // Object without .message but with .error — exercises the 'error' in error branch
    vi.mocked(Filesystem.readFile).mockRejectedValue({
      error: "File not found",
    });

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    // 'not found' matches isMissingFileError → debug log
    expect(addLog).toHaveBeenCalledWith("debug", expect.stringContaining("not found"), expect.any(Object));
  });

  it("handles filesystem read error as object with nested error.message", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem("c64u_smoke_mode_enabled", "1");
    // Object with nested {error: {message: '...'}} — exercises the innermost message extraction
    vi.mocked(Filesystem.readFile).mockRejectedValue({
      error: { message: "no such file" },
    });

    const config = await initializeSmokeMode();
    expect(config).toBeNull();
    expect(addLog).toHaveBeenCalledWith("debug", expect.stringContaining("not found"), expect.any(Object));
  });

  it("handles filesystem read error using string fallback conversion", async () => {
    vi.mocked(Capacitor.isNativePlatform).mockReturnValue(true);
    localStorage.setItem("c64u_smoke_mode_enabled", "1");
    vi.mocked(Filesystem.readFile).mockRejectedValue(42);

    const config = await initializeSmokeMode();

    expect(config).toBeNull();
    expect(addLog).toHaveBeenCalledWith("warn", "Failed to read smoke config from filesystem", {
      error: undefined,
    });
  });
});
