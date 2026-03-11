/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const READ_ONLY_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const tryBuildUrl = (pathOrUrl: string, baseUrl?: string) => {
  try {
    if (/^[a-z]+:\/\//i.test(pathOrUrl)) {
      return new URL(pathOrUrl);
    }
    return new URL(pathOrUrl, baseUrl ?? "http://c64u");
  } catch {
    return null;
  }
};

export const isReadOnlyRestMethod = (method: string) => READ_ONLY_METHODS.has(method.toUpperCase());

export const canonicalizeRestPath = (pathOrUrl: string, baseUrl?: string) => {
  const parsed = tryBuildUrl(pathOrUrl, baseUrl);
  if (!parsed) return pathOrUrl;
  const normalized = new URLSearchParams();
  Array.from(parsed.searchParams.entries())
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = leftKey.localeCompare(rightKey);
      if (keyOrder !== 0) return keyOrder;
      return leftValue.localeCompare(rightValue);
    })
    .forEach(([key, value]) => normalized.append(key, value));
  const query = normalized.toString();
  return `${parsed.pathname}${query ? `?${query}` : ""}`;
};

export const buildRestRequestIdentity = (params: { method: string; path: string; baseUrl: string }) => {
  const method = params.method.toUpperCase();
  const canonicalPath = canonicalizeRestPath(params.path, params.baseUrl);
  return `${method} ${params.baseUrl}${canonicalPath}`;
};

export const isMachineControlPath = (path: string) => {
  const canonicalPath = canonicalizeRestPath(path);
  const normalizedPath = canonicalPath.split("?")[0];
  return (
    normalizedPath.startsWith("/v1/machine:") ||
    normalizedPath.startsWith("/v1/runners:") ||
    /\/v1\/streams\/.+:(start|stop)$/.test(normalizedPath)
  );
};

export const isConfigMutationPath = (path: string) =>
  canonicalizeRestPath(path).split("?")[0].startsWith("/v1/configs");

export const isSerializedMutationRequest = (method: string, path: string) =>
  !isReadOnlyRestMethod(method) && (isMachineControlPath(path) || isConfigMutationPath(path));
