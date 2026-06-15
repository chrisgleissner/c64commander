/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const replaceEntry = useCallback((key: string, value: AuthoritativeConfigValue) => {
    setEntries((previous) => ({
      ...previous,
      [key]: {
        value,
      },
    }));
  }, []);

  const restoreEntry = useCallback((key: string, previousEntry?: AuthoritativeConfigValueEntry) => {
    setEntries((previous) => {
      const next = { ...previous };
      if (previousEntry) {
        next[key] = previousEntry;
      } else {
        delete next[key];
      }
      return next;
    });
  }, []);

  const clearEntry = useCallback((key: string) => {
    setEntries((previous) => {
      if (!Object.prototype.hasOwnProperty.call(previous, key)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }, []);

  // Drop every optimistic override so the next render reveals the authoritative
  // device value. Used when the user explicitly re-syncs from the device
  // (Refresh) or applies a batch reset (Audio Mixer Reset): an override that
  // will never echo back its pinned value — because the device value changed
  // out-of-band to something else — would otherwise stay latched until unmount
  // (BUG-033), since resolveValue only self-clears on an exact device echo.
  const clearAll = useCallback(() => {
    setEntries((previous) => (Object.keys(previous).length === 0 ? previous : {}));
  }, []);

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
    resolveValue,
  };
}
