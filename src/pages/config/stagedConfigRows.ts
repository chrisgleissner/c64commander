/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useLayoutEffect, useMemo, useRef } from "react";
import { useDemandedConfigItem } from "@/lib/search/configDeepLink";
import { useStagedRows, type StagedRows } from "@/lib/ui/stagedRows";

/** A config list's rows built in stages, with the item a search result is landing on built at once. */
export const useStagedConfigRows = <T>(
  category: string | null | undefined,
  items: readonly T[],
  nameOf: (item: T) => string,
): StagedRows => {
  const demandedItem = useDemandedConfigItem(category);
  return useStagedRows(items.length, demandedItem ? items.findIndex((item) => nameOf(item) === demandedItem) : -1);
};

type RowHandlers = Record<string, (itemName: string, value: string | number) => unknown>;

/**
 * One change callback per row and handler for the life of the list, calling the latest handler.
 * Rows are memoized, and a new closure per render re-rendered every built row whenever rows were added.
 */
export const useRowChangeCallbacks = <H extends RowHandlers>(handlers: H) => {
  const handlersRef = useRef(handlers);
  useLayoutEffect(() => {
    handlersRef.current = handlers;
  });
  const callbacks = useMemo(() => new Map<string, (value: string | number) => unknown>(), []);
  return (handler: keyof H & string, itemName: string) => {
    const key = `${handler}:${itemName}`;
    let callback = callbacks.get(key);
    if (!callback) {
      callback = (value) => handlersRef.current[handler](itemName, value);
      callbacks.set(key, callback);
    }
    return callback;
  };
};
