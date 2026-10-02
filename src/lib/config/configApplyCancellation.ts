/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addLog } from "@/lib/logging";
import type { TelnetSessionApi } from "@/lib/telnet/telnetTypes";

/** How long the device menu may take to close after Stop cancelled a settings-file apply. */
export const CONFIG_APPLY_MENU_EXIT_TIMEOUT_MS = 750;

/**
 * How long Stop waits for a cancelled apply to leave the menu and close its Telnet session before it sends
 * its reset anyway. The firmware is documented to wedge under concurrent Telnet and REST traffic (HARD18-026).
 */
export const CONFIG_APPLY_UNWIND_TIMEOUT_MS = 1_500;

export class ConfigApplyCancelledError extends Error {
  constructor(step: string) {
    super(`Applying the settings file was canceled by Stop (at ${step})`);
    this.name = "ConfigApplyCancelledError";
  }
}

export const isConfigApplyCancelledError = (error: unknown): error is ConfigApplyCancelledError =>
  error instanceof ConfigApplyCancelledError || (error as Error | null)?.name === "ConfigApplyCancelledError";

export const throwIfConfigApplyCancelled = (signal: AbortSignal | undefined, step: string) => {
  if (signal?.aborted) throw new ConfigApplyCancelledError(step);
};

/**
 * Settles with the step, or rejects as soon as the signal aborts. A step abandoned this way keeps running
 * until its own timeout; its outcome is logged, because nobody awaits it any more.
 */
export const raceConfigApplyCancellation = <T>(
  signal: AbortSignal | undefined,
  step: string,
  run: () => Promise<T>,
): Promise<T> => {
  throwIfConfigApplyCancelled(signal, step);
  if (!signal) return run();
  const work = run();
  let onAbort: (() => void) | null = null;
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => {
      work.then(
        () => addLog("info", "A settings-file step finished after Stop cancelled it", { step }),
        (error: Error) =>
          addLog("warn", "A settings-file step failed after Stop cancelled it", {
            step,
            error: error.message,
            stack: error.stack,
          }),
      );
      reject(new ConfigApplyCancelledError(step));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
  return Promise.race([work, cancelled]).finally(() => {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  });
};

/** Every keystroke and screen read of the menu walk checks for Stop, so the walk ends between keystrokes. */
export const createCancellableTelnetSession = (session: TelnetSessionApi, signal: AbortSignal): TelnetSessionApi => ({
  ...session,
  connect: (host, port, password) => session.connect(host, port, password),
  disconnect: () => session.disconnect(),
  isConnected: () => session.isConnected(),
  sendKey: (key) => raceConfigApplyCancellation(signal, `key ${key}`, () => session.sendKey(key)),
  sendRaw: (data) => raceConfigApplyCancellation(signal, "raw input", () => session.sendRaw(data)),
  readScreen: (timeoutMs) => raceConfigApplyCancellation(signal, "screen read", () => session.readScreen(timeoutMs)),
});

/**
 * Back the device out of whatever menu the walk left open: ESCAPE closes a context menu, LEFT leaves a
 * directory. Bounded, so a device that stopped answering cannot hold up Stop.
 */
export const leaveDeviceMenu = async (session: TelnetSessionApi, reason: string) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      (async () => {
        await session.sendKey("ESCAPE");
        await session.sendKey("LEFT");
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Leaving the device menu took over ${CONFIG_APPLY_MENU_EXIT_TIMEOUT_MS} ms`)),
          CONFIG_APPLY_MENU_EXIT_TIMEOUT_MS,
        );
      }),
    ]);
    addLog("info", "Left the device menu after an interrupted settings-file apply", { reason });
  } catch (error) {
    addLog("warn", "Could not leave the device menu after an interrupted settings-file apply", {
      reason,
      error: (error as Error).message,
      stack: (error as Error).stack,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
};

type ActiveApply = { controller: AbortController; settled: Promise<void> };

let activeApply: ActiveApply | null = null;

/** Runs one settings-file apply that Stop can cancel. */
export const runCancellableConfigApply = async <T>(work: (signal: AbortSignal) => Promise<T>): Promise<T> => {
  const controller = new AbortController();
  const run = work(controller.signal);
  const entry: ActiveApply = {
    controller,
    // Only a completion signal for Stop; the outcome itself reaches the caller through `run`.
    settled: run.then(
      () => undefined,
      () => undefined,
    ),
  };
  activeApply = entry;
  try {
    return await run;
  } finally {
    if (activeApply === entry) activeApply = null;
  }
};

/**
 * Stop's half: cancel the apply in flight, then wait, at most `timeoutMs`, for it to leave the device menu
 * and close its Telnet session. Resolves at once when nothing is being applied.
 */
export const cancelActiveConfigApply = async (timeoutMs = CONFIG_APPLY_UNWIND_TIMEOUT_MS): Promise<void> => {
  const entry = activeApply;
  if (!entry) return;
  entry.controller.abort();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    entry.settled.then(() => false),
    new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(true), timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) {
    addLog("warn", "Stop did not wait any longer for the cancelled settings-file apply to close", { timeoutMs });
  } else {
    addLog("info", "Stop cancelled the settings-file apply in progress");
  }
};
