/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability B — Launch Safety.
 *
 * Two related correctness behaviours for launching software:
 *   1. Cartridge parking (default, invisible): before a direct-memory launch,
 *      set the `Cartridge` config item to empty so a configured freezer cartridge
 *      can't hijack the launch into its own menu; restore it afterwards. Config
 *      changes apply only at the next reset and never touch flash, so the launched
 *      program keeps running with the cartridge parked and a power-cycle undoes any
 *      worst case.
 *   2. Boot-menu answer (optional, off by default): after a Mount & Load reset,
 *      press a configured key so a cartridge boot menu doesn't swallow the typed
 *      LOAD. See `bootSettle`.
 */

import type { C64API } from "@/lib/c64api";
import { extractConfigValue } from "@/lib/config/configValueExtractor";
import { addLog } from "@/lib/logging";
import { featureFlagManager } from "@/lib/config/featureFlags";
import { enqueueKeyboardBufferInjection } from "@/lib/remoteInput/kernalFallbackInjector";
import {
  loadBootMenuAnswerEnabled,
  loadBootMenuKey,
  loadBootSettleMs,
  type BootMenuKey,
} from "@/lib/config/appSettings";

export const CART_CATEGORY = "C64 and Cartridge Settings";
export const CART_ITEM = "Cartridge";

// Values that mean "no cartridge" and therefore need no parking. Compared
// case-insensitively so firmware variance ("None"/"none"/"") is covered.
const NONE_VALUE_SET = new Set(["", "none"]);

export const launchSafetyEnabled = (): boolean => Boolean(featureFlagManager.getSnapshot().flags.launch_safety_enabled);

// Best-effort restore write budget (park/restore are mutations, not the hot read).
export const CART_WRITE_TIMEOUT_MS = 2000;

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  // If the timeout wins, the original request is still in flight and no longer observed by the
  // race. Attach a handler now so its eventual rejection is logged rather than surfacing as an
  // unhandled promise rejection after the launch has already continued.
  promise.catch((error) => {
    addLog("debug", "Launch Safety: cartridge write rejected (best-effort; may have lost a timeout race)", {
      error: (error as Error)?.message ?? String(error),
    });
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Read the current Cartridge value from the config CACHE only (synchronous, no
 * network). Returns `null` when it isn't cached.
 *
 * Deliberately cache-only: a live `GET` issued in the middle of a launch competes
 * with the launch's own device traffic (the read blocks on the interaction gate and
 * a raced timeout would leave the request holding a lane slot, stalling the launch —
 * this exact hang was caught by the coverage-probe E2E). The app reads config
 * extensively (Home/Config), so a configured cartridge is normally cached; when it
 * isn't, we simply skip parking — parking is a best-effort safety net, never a gate.
 * Config writes keep the cache fresh, so an app-driven cartridge change is reflected.
 */
export const readCartridgeValue = (api: C64API): string | null => {
  try {
    const cached = api.getCachedConfigItem?.(CART_CATEGORY, CART_ITEM);
    if (cached === undefined || cached === null) return null;
    return String(extractConfigValue(cached));
  } catch (error) {
    addLog("debug", "Launch Safety: could not read cached Cartridge value; skipping park", {
      error: (error as Error)?.message ?? String(error),
    });
    return null;
  }
};

const isNoneValue = (value: string) => NONE_VALUE_SET.has(value.trim().toLowerCase());

/**
 * Run `run` with the configured cartridge parked (set to empty) for its duration,
 * restoring the original value in a `finally`. A no-op when the flag is off or
 * when there is no cartridge configured. The restore is best-effort: a failed
 * restore is logged but never masks the run's own result.
 */
export const withCartridgeParked = async <T>(api: C64API, run: () => Promise<T>): Promise<T> => {
  if (!launchSafetyEnabled()) return run();

  const current = readCartridgeValue(api);
  const shouldPark = current != null && !isNoneValue(current);

  if (!shouldPark) return run();

  try {
    await withTimeout(api.setConfigValue(CART_CATEGORY, CART_ITEM, ""), CART_WRITE_TIMEOUT_MS);
    addLog("info", "Launch Safety: parked cartridge for direct launch", { previous: current });
  } catch (error) {
    // If we couldn't park, run anyway — parking is a best-effort safety net, not a gate.
    addLog("warn", "Launch Safety: failed to park cartridge; launching unparked", {
      error: (error as Error)?.message ?? String(error),
    });
    return run();
  }

  try {
    return await run();
  } finally {
    try {
      await withTimeout(api.setConfigValue(CART_CATEGORY, CART_ITEM, current), CART_WRITE_TIMEOUT_MS);
      addLog("info", "Launch Safety: restored cartridge value", { restored: current });
    } catch (error) {
      addLog("error", "Launch Safety: failed to restore cartridge value after launch", {
        intended: current,
        error: (error as Error)?.message ?? String(error),
      });
    }
  }
};

// PETSCII codes for the answerable boot-menu keys.
export const BOOT_MENU_KEY_PETSCII: Record<BootMenuKey, number> = {
  F1: 133,
  F2: 137,
  F3: 134,
  F4: 138,
  F5: 135,
  F6: 139,
  F7: 136,
  F8: 140,
  RETURN: 13,
  SPACE: 32,
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Press a single key via the shared keyboard-buffer injector, retrying for a
 * short window because the input path can be briefly unavailable right after a
 * reset. Best-effort: after the last attempt it gives up quietly (the LOAD that
 * follows still has a chance of landing).
 */
export const pressKeyWithRetry = async (
  api: C64API,
  petscii: number,
  { attempts = 4, intervalMs = 300 }: { attempts?: number; intervalMs?: number } = {},
): Promise<boolean> => {
  const payload = new Uint8Array([petscii]);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await enqueueKeyboardBufferInjection(api, payload);
      return true;
    } catch (error) {
      addLog("debug", "Launch Safety: boot-menu key press retry", {
        attempt: attempt + 1,
        error: (error as Error)?.message ?? String(error),
      });
      if (attempt < attempts - 1) await delay(intervalMs);
    }
  }
  addLog("warn", "Launch Safety: boot-menu key press did not land after retries", { petscii });
  return false;
};

export type BootSettleOptions = {
  bootMenuAnswerEnabled?: boolean;
  bootMenuKey?: BootMenuKey;
  bootSettleMs?: number;
  /** Test seam so unit tests can assert timing without real waits. */
  delayFn?: (ms: number) => Promise<void>;
};

/**
 * Wait for BASIC to become ready after a Mount & Load reset. With the boot-menu
 * answer enabled, press the configured key ~1 s in (once the menu is up), then
 * wait out the remainder plus a small menu-handoff margin. With it off, just wait
 * the full settle time (stock BASIC is ready in ~2.5 s).
 *
 * Settings default to the persisted app settings so callers can invoke
 * `bootSettle(api)` and get the user's configured behaviour.
 */
export const bootSettle = async (api: C64API, options: BootSettleOptions = {}): Promise<void> => {
  const wait = options.delayFn ?? delay;
  const total = options.bootSettleMs ?? loadBootSettleMs();
  const answerEnabled = options.bootMenuAnswerEnabled ?? loadBootMenuAnswerEnabled();

  if (!answerEnabled) {
    await wait(total);
    return;
  }

  const key = options.bootMenuKey ?? loadBootMenuKey();
  const preDelay = Math.min(1000, total);
  await wait(preDelay);
  await pressKeyWithRetry(api, BOOT_MENU_KEY_PETSCII[key]);
  await wait(Math.max(0, total - 1000) + 600);
};
