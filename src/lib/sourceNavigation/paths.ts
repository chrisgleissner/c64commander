/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const normalizeSourcePath = (value: string) => {
  // Only structural normalization here (leading slash, collapse duplicate
  // "/"). Internal whitespace is part of the path (e.g. "My  Demos" is a
  // legal FAT directory name with a double space) - collapsing or trimming
  // it rewrites the request to a path that no longer exists. A blank (or
  // whitespace-only) value has no real path to preserve, so it still maps
  // to the root. See HARD9-045.
  if (!value || value.trim() === "") return "/";
  const leading = value.startsWith("/") ? value : `/${value}`;
  return leading.replace(/\/+/g, "/");
};

const normalizeRoot = (root: string) => {
  const normalized = normalizeSourcePath(root || "/");
  if (normalized === "/") return "/";
  return normalized.endsWith("/") ? normalized : `${normalized}/`;
};

export const isPathWithinRoot = (path: string, root: string) => {
  const normalizedRoot = normalizeRoot(root);
  const normalizedPath = normalizeSourcePath(path);
  if (normalizedRoot === "/") return normalizedPath.startsWith("/");
  return normalizedPath === normalizedRoot.slice(0, -1) || normalizedPath.startsWith(normalizedRoot);
};

export const getParentPathWithinRoot = (path: string, root: string) => {
  const normalizedRoot = normalizeRoot(root);
  const normalizedPath = normalizeSourcePath(path);
  if (!isPathWithinRoot(normalizedPath, normalizedRoot)) return normalizedRoot;
  if (normalizedPath === normalizedRoot || normalizedPath === normalizedRoot.slice(0, -1)) return normalizedRoot;
  const trimmed = normalizedPath.replace(/\/$/, "");
  const idx = trimmed.lastIndexOf("/");
  if (idx <= 0) return "/";
  const parent = `${trimmed.slice(0, idx)}/`;
  if (!isPathWithinRoot(parent, normalizedRoot)) return normalizedRoot;
  return parent;
};

export const ensureWithinRoot = (path: string, root: string) =>
  isPathWithinRoot(path, root) ? normalizeSourcePath(path) : normalizeRoot(root);
