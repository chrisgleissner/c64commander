export const normalizeScopedPath = (value: string) => {
  if (!value) return '/';
  const trimmed = value.replace(/\s+/g, ' ').trim();
  const leading = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return leading.replace(/\/+/g, '/');
};

const normalizeRoot = (root: string) => {
  const normalized = normalizeScopedPath(root || '/');
  if (normalized === '/') return '/';
  return normalized.endsWith('/') ? normalized : `${normalized}/`;
};

export const isPathWithinRoot = (path: string, root: string) => {
  const normalizedRoot = normalizeRoot(root);
  const normalizedPath = normalizeScopedPath(path);
  if (normalizedRoot === '/') return normalizedPath.startsWith('/');
  return normalizedPath === normalizedRoot.slice(0, -1) || normalizedPath.startsWith(normalizedRoot);
};

export const getParentPathWithinRoot = (path: string, root: string) => {
  const normalizedRoot = normalizeRoot(root);
  const normalizedPath = normalizeScopedPath(path);
  if (!isPathWithinRoot(normalizedPath, normalizedRoot)) return normalizedRoot;
  if (normalizedPath === normalizedRoot || normalizedPath === normalizedRoot.slice(0, -1)) return normalizedRoot;
  const trimmed = normalizedPath.replace(/\/$/, '');
  const idx = trimmed.lastIndexOf('/');
  if (idx <= 0) return '/';
  const parent = `${trimmed.slice(0, idx)}/`;
  if (!isPathWithinRoot(parent, normalizedRoot)) return normalizedRoot;
  return parent;
};

export const ensureWithinRoot = (path: string, root: string) =>
  (isPathWithinRoot(path, root) ? normalizeScopedPath(path) : normalizeRoot(root));