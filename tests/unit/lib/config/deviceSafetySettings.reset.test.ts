import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { loadConfigWriteIntervalMs, saveConfigWriteIntervalMs } from "@/lib/config/appSettings";
import { resetDeviceSafetyOverrides } from "@/lib/config/deviceSafetySettings";

describe("resetDeviceSafetyOverrides (BUG-050 regression)", () => {
  const CONFIG_WRITE_INTERVAL_KEY = "c64u_config_write_min_interval_ms";

  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("clears the persisted Config write spacing so the next read returns the default", () => {
    saveConfigWriteIntervalMs(0);
    expect(window.localStorage.getItem(CONFIG_WRITE_INTERVAL_KEY)).toBe("0");
    expect(loadConfigWriteIntervalMs()).toBe(0);

    resetDeviceSafetyOverrides();

    expect(window.localStorage.getItem(CONFIG_WRITE_INTERVAL_KEY)).toBeNull();
    expect(loadConfigWriteIntervalMs()).toBe(200);
  });

  it("broadcasts a c64u-app-settings-updated event with the Config write spacing key so the UI can refresh", () => {
    const listener = vi.fn();
    window.addEventListener("c64u-app-settings-updated", listener);

    saveConfigWriteIntervalMs(1234);
    listener.mockClear();

    resetDeviceSafetyOverrides();

    const matched = listener.mock.calls.some(([event]) => {
      const detail = (event as CustomEvent<{ key?: string }>).detail;
      return detail?.key === CONFIG_WRITE_INTERVAL_KEY;
    });
    expect(matched).toBe(true);
    window.removeEventListener("c64u-app-settings-updated", listener);
  });
});
