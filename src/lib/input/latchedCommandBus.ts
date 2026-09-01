/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * A window-event command bus that also latches, for a command raised on one page and consumed on
 * another (spec.md section 9.5).
 *
 * `keypadCommands.ts` dispatches and forgets, which is right for a consumer that is already
 * mounted. It is wrong for F1 on Home: the transport lives on Play, so publishing and then
 * navigating drops the command before Play subscribes. The command is therefore also written to a
 * module-level slot that a consumer drains on mount, and the slot expires so a key press cannot
 * fire minutes later on an unrelated navigation.
 */

export interface LatchedCommandBus<T> {
  /** Dispatch now for a mounted consumer, and latch for one that mounts within the TTL. */
  publish: (command: T) => void;
  /** Take the latched command if there is one and it has not expired. Claimed exactly once. */
  takePending: () => T | null;
  subscribe: (handler: (command: T) => void) => () => void;
  /** Test seam: drops any latched command without delivering it. */
  reset: () => void;
}

export const createLatchedCommandBus = <T>(eventName: string, ttlMs: number): LatchedCommandBus<T> => {
  let pending: { command: T; atMs: number } | null = null;

  return {
    publish: (command) => {
      pending = { command, atMs: Date.now() };
      if (typeof window === "undefined") return;
      window.dispatchEvent(new CustomEvent<T>(eventName, { detail: command }));
    },
    takePending: () => {
      if (pending === null) return null;
      const claimed = pending;
      pending = null;
      return Date.now() - claimed.atMs > ttlMs ? null : claimed.command;
    },
    subscribe: (handler) => {
      if (typeof window === "undefined") return () => undefined;
      const listener = (event: Event) => handler((event as CustomEvent<T>).detail);
      window.addEventListener(eventName, listener);
      return () => window.removeEventListener(eventName, listener);
    },
    reset: () => {
      pending = null;
    },
  };
};

/** How long an unclaimed command waits for its consumer to mount (spec.md section 9.5). */
export const LATCHED_COMMAND_TTL_MS = 5_000;

export type TransportCommand = "playPause" | "next" | "play" | "stop";

/**
 * F1 and F3, and the Android media buttons. Consumed in place when Play is mounted; otherwise the
 * app navigates to Play and the latch delivers on arrival.
 */
export const transportCommandBus = createLatchedCommandBus<TransportCommand>(
  "c64u-transport-command",
  LATCHED_COMMAND_TTL_MS,
);

/**
 * "Open Remote Input", from search. Home and Play each own a sheet; whichever is mounted claims the
 * request, and a request raised elsewhere survives the navigation to the page that has one.
 */
export const remoteInputRequestBus = createLatchedCommandBus<"open">(
  "c64u-remote-input-open-request",
  LATCHED_COMMAND_TTL_MS,
);
