/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveDeviceBoundSliderWatchdogMs } from "@/hooks/useDeviceBoundSlider";

export type AuthoritativeConfigValue = string | number;

export type AuthoritativeConfigValueEntry = {
  value: AuthoritativeConfigValue;
};

export type AuthoritativeConfigValueEquality = (
  pending: AuthoritativeConfigValue,
  device: AuthoritativeConfigValue,
) => boolean;

const tryParseNumeric = (value: AuthoritativeConfigValue): number | null => {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  // Single-token only — "1 2 3" must not coerce to NaN.
  if (/\s/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
};

/**
 * Default equality used to decide when the device echo has caught up to the
 * pending optimistic value. Trim-aware for strings and coerces single-token
 * numerics across number ↔ string so the override clears even when the
 * device returns " 4" for our committed `4` (R-RT-6).
 */
export const isAuthoritativeConfigValueEqual: AuthoritativeConfigValueEquality = (pending, device) => {
  if (Object.is(pending, device)) return true;
  const pendingNumber = tryParseNumeric(pending);
  const deviceNumber = tryParseNumeric(device);
  if (pendingNumber !== null && deviceNumber !== null) {
    return Object.is(pendingNumber, deviceNumber);
  }
  return String(pending).trim() === String(device).trim();
};

export function useAuthoritativeConfigValueState(options: { equals?: AuthoritativeConfigValueEquality } = {}) {
  const equals = options.equals ?? isAuthoritativeConfigValueEqual;
  const [entries, setEntries] = useState<Record<string, AuthoritativeConfigValueEntry>>({});
  const entriesRef = useRef(entries);
  const queuedClearsRef = useRef<Set<string>>(new Set());
  // A pin whose write succeeded at the HTTP level but whose value never
  // echoes back (device reboots/drops before persisting, or the
  // reconciliation refetch never lands) would otherwise stay latched
  // forever - resolveValue only self-clears on an exact device echo, and
  // routing-epoch changes (see clearAll's own doc) only cover a device
  // switch/reconnect, not a same-device write that silently never takes.
  // Reuses the slider watchdog's timing so the two "how long do we trust an
  // unconfirmed device write" windows stay in sync. See HARD9-052.
  const watchdogTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const clearWatchdogTimer = useCallback((key: string) => {
    const timer = watchdogTimersRef.current.get(key);
    if (timer !== undefined) {
      clearTimeout(timer);
      watchdogTimersRef.current.delete(key);
    }
  }, []);

  const clearWatchdogTimers = useCallback((keys: Iterable<string>) => {
    for (const key of keys) {
      const timer = watchdogTimersRef.current.get(key);
      if (timer !== undefined) {
        clearTimeout(timer);
        watchdogTimersRef.current.delete(key);
      }
    }
  }, []);

  useEffect(() => {
    return () => {
      watchdogTimersRef.current.forEach((timer) => clearTimeout(timer));
      watchdogTimersRef.current.clear();
    };
  }, []);

  const replaceEntry = useCallback(
    (key: string, value: AuthoritativeConfigValue) => {
      setEntries((previous) => ({
        ...previous,
        [key]: {
          value,
        },
      }));
      clearWatchdogTimer(key);
      const timer = setTimeout(() => {
        watchdogTimersRef.current.delete(key);
        setEntries((previous) => {
          if (!Object.prototype.hasOwnProperty.call(previous, key)) return previous;
          const next = { ...previous };
          delete next[key];
          return next;
        });
      }, resolveDeviceBoundSliderWatchdogMs());
      watchdogTimersRef.current.set(key, timer);
    },
    [clearWatchdogTimer],
  );

  const restoreEntry = useCallback(
    (
      key: string,
      previousEntry: AuthoritativeConfigValueEntry | undefined,
      expectedCurrentValue: AuthoritativeConfigValue,
    ) => {
      // Rapid A-then-B writes to the same item can both be in flight at once:
      // if A fails first, its own rollback must not resurrect/clobber a pin
      // that a newer write (B) has since taken over. Only apply the rollback
      // if the store's current entry still equals the value THIS write
      // pinned - otherwise a newer write is now in charge of this key and
      // its own success/failure handling owns the outcome. See HARD9-086.
      let applied = false;
      setEntries((previous) => {
        const current = previous[key];
        if (!current || current.value !== expectedCurrentValue) return previous;
        applied = true;
        const next = { ...previous };
        if (previousEntry) {
          next[key] = previousEntry;
        } else {
          delete next[key];
        }
        return next;
      });
      if (applied) {
        clearWatchdogTimer(key);
      }
    },
    [clearWatchdogTimer],
  );

  const clearEntry = useCallback(
    (key: string) => {
      clearWatchdogTimer(key);
      setEntries((previous) => {
        if (!Object.prototype.hasOwnProperty.call(previous, key)) return previous;
        const next = { ...previous };
        delete next[key];
        return next;
      });
    },
    [clearWatchdogTimer],
  );

  // Drop every optimistic override so the next render reveals the authoritative
  // device value. Used when the user explicitly re-syncs from the device
  // (Refresh) or applies a batch reset (Audio Mixer Reset): an override that
  // will never echo back its pinned value — because the device value changed
  // out-of-band to something else — would otherwise stay latched until unmount
  // (BUG-033), since resolveValue only self-clears on an exact device echo.
  const clearAll = useCallback(() => {
    setEntries((previous) => {
      clearWatchdogTimers(Object.keys(previous));
      return Object.keys(previous).length === 0 ? previous : {};
    });
  }, [clearWatchdogTimers]);

  // Drop only the optimistic overrides whose key starts with `prefix`. Used when the
  // store is shared across the whole Config page (canonical `category::item` keys) so a
  // per-category Refresh/Reset clears ONLY that category's pins, never a pending write in
  // another expanded section (the scoped sibling of `clearAll`, same BUG-033 rationale).
  const clearMatching = useCallback(
    (prefix: string) => {
      setEntries((previous) => {
        const keys = Object.keys(previous).filter((key) => key.startsWith(prefix));
        if (keys.length === 0) return previous;
        clearWatchdogTimers(keys);
        const next = { ...previous };
        for (const key of keys) delete next[key];
        return next;
      });
    },
    [clearWatchdogTimers],
  );

  const scheduleClearEntry = useCallback(
    (key: string) => {
      if (queuedClearsRef.current.has(key)) return;
      queuedClearsRef.current.add(key);
      queueMicrotask(() => {
        queuedClearsRef.current.delete(key);
        clearEntry(key);
      });
    },
    [clearEntry],
  );

  const resolveValue = useCallback(
    <T extends AuthoritativeConfigValue>(key: string, deviceValue: T | undefined, fallback: T): T => {
      const resolvedDeviceValue = (deviceValue ?? fallback) as T;
      const entry = entries[key];
      if (!entry) return resolvedDeviceValue;
      if (equals(entry.value, resolvedDeviceValue)) {
        scheduleClearEntry(key);
        return resolvedDeviceValue;
      }
      return entry.value as T;
    },
    [entries, equals, scheduleClearEntry],
  );

  const values = useMemo(
    () =>
      Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, entry.value])) as Record<
        string,
        AuthoritativeConfigValue
      >,
    [entries],
  );

  const pending = useMemo(
    () => Object.fromEntries(Object.keys(entries).map((key) => [key, true])) as Record<string, boolean>,
    [entries],
  );

  return {
    entries,
    entriesRef,
    values,
    pending,
    replaceEntry,
    restoreEntry,
    clearEntry,
    clearAll,
    clearMatching,
    resolveValue,
  };
}

/**
 * Canonical optimistic/pending key for the (page-shared) authoritative value store.
 * Keyed by REST `{category, item}` so the SAME item shown in two menu locations
 * (aliases) shares one pending cell, and same-named items from different REST
 * categories on one menu page (e.g. LED Strip Settings vs Keyboard Lighting both
 * exposing "LedStrip Mode") never collide.
 */
export const canonicalConfigKey = (category: string, item: string): string => `${category}::${item}`;

/** The shape returned by {@link useAuthoritativeConfigValueState} (for prop threading). */
export type AuthoritativeConfigValueState = ReturnType<typeof useAuthoritativeConfigValueState>;
