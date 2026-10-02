/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { QueryClient } from "@tanstack/react-query";
import { getC64API } from "@/lib/c64api";
import { getHttpStatusFromError, isAuthRequiredHttpStatus } from "@/lib/c64api/transportErrors";
import { addLog } from "@/lib/logging";

export const HOME_CONFIG_QUERY_PREFIX = "c64-config-items";

/** Hosts whose firmware rejected `GET /v1/configs/*` this session; Home refreshes them per category. */
const wildcardUnsupportedBaseUrls = new Set<string>();

export type HomeConfigReadGuards = {
  /** True while applying device values would fight the user (drag, text entry, write burst). */
  isInteracting: () => boolean;
  /** True while a write to this item is pending; its cached value must not be replaced. */
  isWritePending: (category: string, item: string) => boolean;
};

export type HomeConfigReadOutcome =
  | { kind: "wildcard"; requests: 1; updatedKeys: number; skippedKeys: number }
  | { kind: "per-category"; requests: number };

type ConfigItemsQueryKey = readonly [string, string, string, ...unknown[]];

const isConfigItemsQueryKey = (key: readonly unknown[]): key is ConfigItemsQueryKey =>
  key[0] === HOME_CONFIG_QUERY_PREFIX && typeof key[1] === "string" && typeof key[2] === "string";

const isWildcardUnsupported = (error: unknown) => {
  const status = getHttpStatusFromError(error);
  return status !== null && status >= 400 && status < 500 && !isAuthRequiredHttpStatus(status);
};

const markWildcardUnsupported = (baseUrl: string, detail: Record<string, unknown>) => {
  if (wildcardUnsupportedBaseUrls.has(baseUrl)) return;
  wildcardUnsupportedBaseUrls.add(baseUrl);
  addLog("info", "Device does not answer the config wildcard read; Home refreshes per category", {
    baseUrl,
    ...detail,
  });
};

const refetchPerCategory = async (queryClient: QueryClient): Promise<HomeConfigReadOutcome> => {
  const active = queryClient.getQueryCache().findAll({ queryKey: [HOME_CONFIG_QUERY_PREFIX], type: "active" });
  // cancelRefetch: false joins a read already on the wire instead of aborting and re-sending it.
  await queryClient.refetchQueries({ queryKey: [HOME_CONFIG_QUERY_PREFIX], type: "active" }, { cancelRefetch: false });
  return { kind: "per-category", requests: active.length };
};

/**
 * Reads every config category Home shows with one `GET /v1/configs/*` and writes each category's
 * slice into the mounted Home queries, in the shape `getConfigItems` gives them. Falls back to one
 * refetch per query, for the rest of the session, on a device whose firmware rejects the wildcard.
 */
export const readHomeConfig = async (
  queryClient: QueryClient,
  guards: HomeConfigReadGuards,
  timeoutMs: number,
): Promise<HomeConfigReadOutcome> => {
  const api = getC64API();
  const baseUrl = api.getBaseUrl();
  if (wildcardUnsupportedBaseUrls.has(baseUrl)) return refetchPerCategory(queryClient);

  let allCategories: Record<string, unknown>;
  try {
    allCategories = await api.getAllConfigCategories({
      __c64uIntent: "background",
      __c64uExpectedMissing: true,
      timeoutMs,
    });
  } catch (error) {
    if (!isWildcardUnsupported(error)) throw error;
    markWildcardUnsupported(baseUrl, { status: getHttpStatusFromError(error), error: (error as Error).message });
    return refetchPerCategory(queryClient);
  }

  const queries = queryClient
    .getQueryCache()
    .findAll({ queryKey: [HOME_CONFIG_QUERY_PREFIX], type: "active" })
    .filter((query) => isConfigItemsQueryKey(query.queryKey));
  if (queries.length > 0 && !queries.some((query) => Object.hasOwn(allCategories, query.queryKey[1] as string))) {
    markWildcardUnsupported(baseUrl, { reason: "no mounted category in the response" });
    return refetchPerCategory(queryClient);
  }
  if (guards.isInteracting()) {
    addLog("debug", "Home config refresh discarded: the user started interacting while it was in flight");
    return { kind: "wildcard", requests: 1, updatedKeys: 0, skippedKeys: queries.length };
  }

  let updatedKeys = 0;
  let skippedKeys = 0;
  queries.forEach((query) => {
    const [, category, itemKey] = query.queryKey as ConfigItemsQueryKey;
    const items = itemKey.split("|");
    const data = api.selectConfigItems(allCategories, category, items);
    if (!data || items.some((item) => guards.isWritePending(category, item))) {
      skippedKeys += 1;
      return;
    }
    queryClient.setQueryData(query.queryKey, data);
    updatedKeys += 1;
  });
  return { kind: "wildcard", requests: 1, updatedKeys, skippedKeys };
};
