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

export function useAuthoritativeConfigValueState() {
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
      if (Object.is(entry.value, resolvedDeviceValue)) {
        scheduleClearEntry(key);
        return resolvedDeviceValue;
      }
      return entry.value as T;
    },
    [entries, scheduleClearEntry],
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
    resolveValue,
  };
}
