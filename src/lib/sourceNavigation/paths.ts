/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const normalizeSourcePath = (value: string) => {
  // Structural normalization only (leading slash, collapse duplicate "/").
  // INTERNAL whitespace is part of the path (e.g. "My  Demos" is a legal FAT
  // directory name with a double space) and must be preserved - collapsing it
  // rewrites the request to a path that no longer exists (HARD9-045). We DO
  // trim leading/trailing whitespace of the whole value, though: FAT/exFAT
  // strip trailing spaces from names, and end whitespace on a user-entered
  // path ("  /USB0/Games  ") is an accidental artifact that would otherwise
  // produce a space-prefixed path that fails every lookup. A blank (or
  // whitespace-only) value has no real path to preserve, so it maps to root.
  const trimmed = value?.trim() ?? "";
  if (trimmed === "") return "/";
  const leading = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
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
