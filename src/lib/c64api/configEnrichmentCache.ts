/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { addErrorLog, addLog } from "@/lib/logging";

const CATEGORY_KEY_PREFIX = "c64u:configEnrichment:";
const HOST_NAMESPACE_KEY_PREFIX = "c64u:configEnrichmentHost:";
const ABSENT_DOMAIN_KEY_PREFIX = "c64u:configEnrichmentAbsent:";

type CategoryCacheValue = {
  namespaceKey: string;
  uniqueId: string;
  firmwareVersion: string;
  category: string;
  items: Record<string, unknown>;
};

type AbsentDomainCacheValue = {
  namespaceKey: string;
  uniqueId: string;
  firmwareVersion: string;
  keys: string[];
};

type HostNamespaceBinding = {
  host: string;
  namespaceKey: string;
  uniqueId: string;
  firmwareVersion: string;
};

const getStorage = () => {
  if (typeof localStorage === "undefined") {
    return null;
  }
  return localStorage;
};

const buildCategoryStorageKey = (namespaceKey: string, category: string) =>
  `${CATEGORY_KEY_PREFIX}${namespaceKey}|${category}`;
const buildHostBindingKey = (host: string) => `${HOST_NAMESPACE_KEY_PREFIX}${host}`;
const buildAbsentDomainStorageKey = (namespaceKey: string) => `${ABSENT_DOMAIN_KEY_PREFIX}${namespaceKey}`;

const listKeys = (prefix: string) => {
  const storage = getStorage();
  if (!storage) {
    return [];
  }

  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) {
      keys.push(key);
    }
  }
  return keys;
};

const readJson = <T>(key: string): T | null => {
  const storage = getStorage();
  if (!storage) {
    return null;
  }

  const rawValue = storage.getItem(key);
  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as T;
  } catch (error) {
    storage.removeItem(key);
    addErrorLog("Config enrichment cache read failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
};

const writeJson = (key: string, value: unknown) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(key, JSON.stringify(value));
  } catch (error) {
    addErrorLog("Config enrichment cache write failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

const removeKeys = (keys: string[]) => {
  const storage = getStorage();
  if (!storage) {
    return;
  }
  keys.forEach((key) => storage.removeItem(key));
};

export const buildConfigEnrichmentNamespaceKey = (uniqueId: string, firmwareVersion: string) =>
  `${uniqueId.trim()}|${firmwareVersion.trim()}`;

export const loadConfigEnrichmentNamespaceForHost = (host: string): string | null => {
  const binding = readJson<HostNamespaceBinding>(buildHostBindingKey(host));
  return binding?.namespaceKey ?? null;
};

const clearNamespacesForUniqueId = (uniqueId: string, keepNamespaceKey: string) => {
  const categoryKeysToDelete = listKeys(CATEGORY_KEY_PREFIX).filter((key) => {
    const value = readJson<CategoryCacheValue>(key);
    return value?.uniqueId === uniqueId && value.namespaceKey !== keepNamespaceKey;
  });
  removeKeys(categoryKeysToDelete);

  const absentKeysToDelete = listKeys(ABSENT_DOMAIN_KEY_PREFIX).filter((key) => {
    const value = readJson<AbsentDomainCacheValue>(key);
    return value?.uniqueId === uniqueId && value.namespaceKey !== keepNamespaceKey;
  });
  removeKeys(absentKeysToDelete);

  const hostKeysToDelete = listKeys(HOST_NAMESPACE_KEY_PREFIX).filter((key) => {
    const binding = readJson<HostNamespaceBinding>(key);
    return binding?.uniqueId === uniqueId && binding.namespaceKey !== keepNamespaceKey;
  });
  removeKeys(hostKeysToDelete);
};

export const rememberConfigEnrichmentNamespaceForHost = (host: string, uniqueId: string, firmwareVersion: string) => {
  const namespaceKey = buildConfigEnrichmentNamespaceKey(uniqueId, firmwareVersion);
  clearNamespacesForUniqueId(uniqueId, namespaceKey);
  writeJson(buildHostBindingKey(host), {
    host,
    namespaceKey,
    uniqueId,
    firmwareVersion,
  } satisfies HostNamespaceBinding);
  return namespaceKey;
};

export const loadConfigEnrichmentCategory = (
  namespaceKey: string | null,
  category: string,
): Record<string, unknown> | null => {
  if (!namespaceKey) {
    return null;
  }

  const value = readJson<CategoryCacheValue>(buildCategoryStorageKey(namespaceKey, category));
  if (!value || typeof value.items !== "object" || value.items === null || Array.isArray(value.items)) {
    return null;
  }
  return value.items;
};

export const saveConfigEnrichmentCategory = (
  namespaceKey: string | null,
  category: string,
  items: Record<string, unknown>,
) => {
  if (!namespaceKey || Object.keys(items).length === 0) {
    return;
  }

  const [uniqueId, firmwareVersion] = namespaceKey.split("|");
  if (!uniqueId || !firmwareVersion) {
    addLog("warn", "Skipping config enrichment cache write for malformed namespace", {
      namespaceKey,
      category,
    });
    return;
  }

  writeJson(buildCategoryStorageKey(namespaceKey, category), {
    namespaceKey,
    uniqueId,
    firmwareVersion,
    category,
    items,
  } satisfies CategoryCacheValue);
};

export const loadConfigEnrichmentAbsentDomains = (namespaceKey: string | null): string[] => {
  if (!namespaceKey) {
    return [];
  }
  const value = readJson<AbsentDomainCacheValue>(buildAbsentDomainStorageKey(namespaceKey));
  return Array.isArray(value?.keys) ? value.keys : [];
};

export const saveConfigEnrichmentAbsentDomains = (namespaceKey: string | null, keys: string[]) => {
  if (!namespaceKey) {
    return;
  }
  const [uniqueId, firmwareVersion] = namespaceKey.split("|");
  if (!uniqueId || !firmwareVersion) {
    addLog("warn", "Skipping config enrichment absence write for malformed namespace", { namespaceKey });
    return;
  }
  writeJson(buildAbsentDomainStorageKey(namespaceKey), {
    namespaceKey,
    uniqueId,
    firmwareVersion,
    keys,
  } satisfies AbsentDomainCacheValue);
};

export const clearConfigEnrichmentNamespace = (namespaceKey: string | null) => {
  if (!namespaceKey) {
    return;
  }
  removeKeys(listKeys(CATEGORY_KEY_PREFIX).filter((key) => key.startsWith(`${CATEGORY_KEY_PREFIX}${namespaceKey}|`)));
  removeKeys([buildAbsentDomainStorageKey(namespaceKey)]);
  removeKeys(
    listKeys(HOST_NAMESPACE_KEY_PREFIX).filter((key) => {
      const binding = readJson<HostNamespaceBinding>(key);
      return binding?.namespaceKey === namespaceKey;
    }),
  );
};

export const clearAllConfigEnrichmentCache = () => {
  removeKeys([
    ...listKeys(CATEGORY_KEY_PREFIX),
    ...listKeys(ABSENT_DOMAIN_KEY_PREFIX),
    ...listKeys(HOST_NAMESPACE_KEY_PREFIX),
  ]);
};
