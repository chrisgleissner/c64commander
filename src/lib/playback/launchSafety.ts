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

// Launch Safety is a best-effort safety net, never a gate: bound the Cartridge
// read so a slow, retrying, or absent config item (e.g. firmware without the item)
// can't stall the launch it is protecting.
export const CART_READ_TIMEOUT_MS = 1500;
export const CART_WRITE_TIMEOUT_MS = 2000;

const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

/**
 * Read the CURRENT Cartridge config value, or `null` when it can't be resolved
 * (older firmware without the item, a read failure/timeout, etc.). A `null` result
 * means "don't park" — Launch Safety must never turn a read hiccup into a failed or
 * stalled launch. The read is a single, bounded, non-retrying attempt.
 */
export const readCartridgeValue = async (api: C64API): Promise<string | null> => {
  try {
    // The `withTimeout` race guarantees this resolves within the budget regardless
    // of gateway retries, so the launch is never stalled. (Gateway-internal circuit/
    // backoff bypass flags stay out of app code — see deviceGatewayGuard.)
    const response = await withTimeout(
      api.getConfigItem(CART_CATEGORY, CART_ITEM, { timeoutMs: CART_READ_TIMEOUT_MS }),
      CART_READ_TIMEOUT_MS + 250,
    );
    const category = response?.[CART_CATEGORY];
    if (!category || Array.isArray(category)) return null;
    const items = (category as { items?: Record<string, unknown> }).items ?? category;
    const raw = (items as Record<string, unknown>)?.[CART_ITEM];
    if (raw === undefined) return null;
    const value = extractConfigValue(raw);
    return String(value);
  } catch (error) {
    addLog("debug", "Launch Safety: could not read Cartridge value; skipping park", {
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

  const current = await readCartridgeValue(api);
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
