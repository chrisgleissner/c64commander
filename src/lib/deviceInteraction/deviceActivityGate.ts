/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

type DeviceActivitySnapshot = Readonly<{
  machineTransitionCount: number;
  machineTransitionCooldownUntilMs: number;
  playbackWriteCount: number;
  playbackWriteCooldownUntilMs: number;
}>;

const listeners = new Set<() => void>();

let machineTransitionCount = 0;
let machineTransitionCooldownUntilMs = 0;
let playbackWriteCount = 0;
let playbackWriteCooldownUntilMs = 0;
let expiryTimer: ReturnType<typeof setTimeout> | null = null;

const now = () => Date.now();

const getNextExpiryMs = () => {
  const currentMs = now();
  const candidates = [machineTransitionCooldownUntilMs, playbackWriteCooldownUntilMs].filter(
    (value) => value > currentMs,
  );
  if (!candidates.length) return null;
  return Math.min(...candidates);
};

const emit = () => {
  listeners.forEach((listener) => listener());
};

const syncExpiryTimer = () => {
  if (expiryTimer) {
    clearTimeout(expiryTimer);
    expiryTimer = null;
  }
  const nextExpiryMs = getNextExpiryMs();
  if (nextExpiryMs === null) return;
  expiryTimer = setTimeout(
    () => {
      expiryTimer = null;
      emit();
      syncExpiryTimer();
    },
    Math.max(0, nextExpiryMs - now()),
  );
};

const updateState = () => {
  emit();
  syncExpiryTimer();
};

export const resetDeviceActivityGate = () => {
  machineTransitionCount = 0;
  machineTransitionCooldownUntilMs = 0;
  playbackWriteCount = 0;
  playbackWriteCooldownUntilMs = 0;
  updateState();
};

export const subscribeDeviceActivityGate = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getDeviceActivitySnapshot = (): DeviceActivitySnapshot =>
  Object.freeze({
    machineTransitionCount,
    machineTransitionCooldownUntilMs,
    playbackWriteCount,
    playbackWriteCooldownUntilMs,
  });

export const isMachineTransitionActive = () => machineTransitionCount > 0 || machineTransitionCooldownUntilMs > now();

export const isPlaybackWriteBurstActive = () => playbackWriteCount > 0 || playbackWriteCooldownUntilMs > now();

export const areBackgroundReadsSuspended = () => isMachineTransitionActive() || isPlaybackWriteBurstActive();

const createActivityHandle = (
  cooldownMs: number,
  counters: { increment: () => void; decrement: () => void; applyCooldown: (untilMs: number) => void },
) => {
  counters.increment();
  updateState();
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    counters.decrement();
    if (cooldownMs > 0) {
      counters.applyCooldown(now() + cooldownMs);
    }
    updateState();
  };
};

export const beginMachineTransition = (cooldownMs = 250) =>
  createActivityHandle(cooldownMs, {
    increment: () => {
      machineTransitionCount += 1;
    },
    decrement: () => {
      machineTransitionCount = Math.max(0, machineTransitionCount - 1);
    },
    applyCooldown: (untilMs) => {
      machineTransitionCooldownUntilMs = Math.max(machineTransitionCooldownUntilMs, untilMs);
    },
  });

export const beginPlaybackWriteBurst = (cooldownMs = 150) =>
  createActivityHandle(cooldownMs, {
    increment: () => {
      playbackWriteCount += 1;
    },
    decrement: () => {
      playbackWriteCount = Math.max(0, playbackWriteCount - 1);
    },
    applyCooldown: (untilMs) => {
      playbackWriteCooldownUntilMs = Math.max(playbackWriteCooldownUntilMs, untilMs);
    },
  });

const waitFor = (predicate: () => boolean) => {
  if (predicate()) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const unsubscribe = subscribeDeviceActivityGate(() => {
      if (!predicate()) return;
      unsubscribe();
      resolve();
    });
  });
};

export const waitForMachineTransitionsToSettle = () => waitFor(() => !isMachineTransitionActive());

export const waitForBackgroundReadsToResume = () => waitFor(() => !areBackgroundReadsSuspended());
