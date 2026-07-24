/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  BOOT_MENU_KEY_PETSCII,
  CART_CATEGORY,
  CART_ITEM,
  bootSettle,
  launchSafetyEnabled,
  pressKeyWithRetry,
  readCartridgeValue,
  withCartridgeParked,
} from "@/lib/playback/launchSafety";
import { featureFlagManager } from "@/lib/config/featureFlags";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";

vi.mock("@/lib/remoteInput/kernalFallbackInjector", () => ({
  enqueueKeyboardBufferInjection: vi.fn(async () => ({ dropped: false })),
}));

const setFlag = (value: boolean) => {
  vi.spyOn(featureFlagManager, "getSnapshot").mockReturnValue({
    flags: { launch_safety_enabled: value },
  } as never);
};

const makeApi = (cartridgeValue: string | undefined = "Final Cartridge III") => ({
  getCachedConfigItem: vi.fn(() => (cartridgeValue === undefined ? undefined : { selected: cartridgeValue })),
  setConfigValue: vi.fn(async () => ({ errors: [] })),
});

describe("launchSafety — withCartridgeParked", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    setFlag(true);
  });

  it("runs untouched when the flag is off", async () => {
    setFlag(false);
    const api = makeApi();
    const run = vi.fn(async () => "ok");
    await expect(withCartridgeParked(api as never, run)).resolves.toBe("ok");
    expect(api.getCachedConfigItem).not.toHaveBeenCalled();
    expect(api.setConfigValue).not.toHaveBeenCalled();
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("reports the flag state via launchSafetyEnabled()", () => {
    setFlag(true);
    expect(launchSafetyEnabled()).toBe(true);
    setFlag(false);
    expect(launchSafetyEnabled()).toBe(false);
  });

  it("parks then restores the cartridge around a resolving run", async () => {
    const api = makeApi("Retro Replay");
    const order: string[] = [];
    api.setConfigValue.mockImplementation(async (_c: string, _i: string, v: string) => {
      order.push(`set:${v === "" ? "<empty>" : v}`);
      return { errors: [] };
    });
    const run = vi.fn(async () => {
      order.push("run");
      return 42;
    });

    await expect(withCartridgeParked(api as never, run)).resolves.toBe(42);

    expect(order).toEqual(["set:<empty>", "run", "set:Retro Replay"]);
    expect(api.setConfigValue).toHaveBeenNthCalledWith(1, CART_CATEGORY, CART_ITEM, "");
    expect(api.setConfigValue).toHaveBeenNthCalledWith(2, CART_CATEGORY, CART_ITEM, "Retro Replay");
  });

  it("restores the cartridge even when the run throws", async () => {
    const api = makeApi("Action Replay");
    const run = vi.fn(async () => {
      throw new Error("launch boom");
    });
    await expect(withCartridgeParked(api as never, run)).rejects.toThrow("launch boom");
    // parked then restored
    expect(api.setConfigValue).toHaveBeenNthCalledWith(1, CART_CATEGORY, CART_ITEM, "");
    expect(api.setConfigValue).toHaveBeenNthCalledWith(2, CART_CATEGORY, CART_ITEM, "Action Replay");
  });

  it.each(["", "None", "none", "  none  "])("does not write when the value means none (%j)", async (value) => {
    const api = makeApi(value);
    const run = vi.fn(async () => "done");
    await expect(withCartridgeParked(api as never, run)).resolves.toBe("done");
    expect(api.setConfigValue).not.toHaveBeenCalled();
  });

  it("does not write when the cartridge value is not cached", async () => {
    const api = {
      getCachedConfigItem: vi.fn(() => undefined),
      setConfigValue: vi.fn(async () => ({ errors: [] })),
    };
    const run = vi.fn(async () => "done");
    await expect(withCartridgeParked(api as never, run)).resolves.toBe("done");
    expect(api.setConfigValue).not.toHaveBeenCalled();
  });

  it("launches unparked when the park write fails, without a restore", async () => {
    const api = makeApi("Super Snapshot");
    api.setConfigValue.mockRejectedValueOnce(new Error("park failed"));
    const run = vi.fn(async () => "ran anyway");
    await expect(withCartridgeParked(api as never, run)).resolves.toBe("ran anyway");
    expect(run).toHaveBeenCalledTimes(1);
    // only the failed park attempt; no restore write
    expect(api.setConfigValue).toHaveBeenCalledTimes(1);
  });

  it("does not let a failing restore mask a successful run", async () => {
    const api = makeApi("Final Cartridge III");
    api.setConfigValue
      .mockImplementationOnce(async () => ({ errors: [] })) // park ok
      .mockRejectedValueOnce(new Error("restore failed")); // restore fails
    const run = vi.fn(async () => "result");
    await expect(withCartridgeParked(api as never, run)).resolves.toBe("result");
  });
});

describe("launchSafety — readCartridgeValue (cache-only, synchronous)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("extracts the selected value from the cached item", () => {
    const api = makeApi("Kung Fu Flash");
    expect(readCartridgeValue(api as never)).toBe("Kung Fu Flash");
  });

  it("handles a { value } shaped cached item", () => {
    const api = { getCachedConfigItem: vi.fn(() => ({ value: "EasyFlash" })) };
    expect(readCartridgeValue(api as never)).toBe("EasyFlash");
  });

  it("returns null when the item is not cached", () => {
    const api = { getCachedConfigItem: vi.fn(() => undefined) };
    expect(readCartridgeValue(api as never)).toBeNull();
  });

  it("returns null when the API has no cache accessor", () => {
    expect(readCartridgeValue({} as never)).toBeNull();
  });

  it("returns null on a cache-read failure", () => {
    const api = {
      getCachedConfigItem: vi.fn(() => {
        throw new Error("boom");
      }),
    };
    expect(readCartridgeValue(api as never)).toBeNull();
  });

  it("does not issue any network read", () => {
    const api = makeApi("Retro Replay");
    readCartridgeValue(api as never);
    expect(api.getCachedConfigItem).toHaveBeenCalledWith(CART_CATEGORY, CART_ITEM);
    expect((api as Record<string, unknown>).getConfigItem).toBeUndefined();
  });
});

describe("launchSafety — bootSettle & pressKeyWithRetry", () => {
  beforeEach(() => {
    vi.mocked(enqueueKeyboardBufferInjection).mockReset();
    vi.mocked(enqueueKeyboardBufferInjection).mockResolvedValue({ dropped: false });
  });

  it("waits the full settle time with the answer disabled", async () => {
    const waits: number[] = [];
    const delayFn = async (ms: number) => {
      waits.push(ms);
    };
    await bootSettle({} as never, { bootMenuAnswerEnabled: false, bootSettleMs: 2800, delayFn });
    expect(waits).toEqual([2800]);
    expect(enqueueKeyboardBufferInjection).not.toHaveBeenCalled();
  });

  it("presses the mapped key once and respects timing with the answer enabled", async () => {
    const waits: number[] = [];
    const delayFn = async (ms: number) => {
      waits.push(ms);
    };
    await bootSettle({} as never, {
      bootMenuAnswerEnabled: true,
      bootMenuKey: "F7",
      bootSettleMs: 2800,
      delayFn,
    });
    // pre-delay (min(1000, total)), then remainder+margin
    expect(waits).toEqual([1000, 2400]);
    expect(enqueueKeyboardBufferInjection).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(enqueueKeyboardBufferInjection).mock.calls[0][1] as Uint8Array;
    expect(payload[0]).toBe(BOOT_MENU_KEY_PETSCII.F7);
  });

  it("clamps the pre-delay when the total settle is short", async () => {
    const waits: number[] = [];
    const delayFn = async (ms: number) => {
      waits.push(ms);
    };
    await bootSettle({} as never, {
      bootMenuAnswerEnabled: true,
      bootMenuKey: "RETURN",
      bootSettleMs: 500,
      delayFn,
    });
    expect(waits).toEqual([500, 600]);
  });

  it("retries the key press when the first attempts fail", async () => {
    vi.mocked(enqueueKeyboardBufferInjection)
      .mockRejectedValueOnce(new Error("no input path"))
      .mockResolvedValueOnce({ dropped: false });
    const ok = await pressKeyWithRetry({} as never, 13, { attempts: 3, intervalMs: 0 });
    expect(ok).toBe(true);
    expect(enqueueKeyboardBufferInjection).toHaveBeenCalledTimes(2);
  });

  it("gives up after exhausting attempts", async () => {
    vi.mocked(enqueueKeyboardBufferInjection).mockRejectedValue(new Error("dead"));
    const ok = await pressKeyWithRetry({} as never, 32, { attempts: 2, intervalMs: 0 });
    expect(ok).toBe(false);
    expect(enqueueKeyboardBufferInjection).toHaveBeenCalledTimes(2);
  });
});
