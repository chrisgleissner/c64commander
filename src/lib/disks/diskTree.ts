import type { DiskEntry } from './diskTypes';

export type DiskTreeNode = {
  id: string;
  name: string;
  path: string;
  type: 'folder' | 'disk';
  children?: DiskTreeNode[];
  diskId?: string;
};

export type DiskMatchInfo = {
  matches: boolean;
  matchedField: 'name' | 'path' | 'group' | null;
};

export type DiskTreeState = {
  root: DiskTreeNode;
  matches: Record<string, DiskMatchInfo>;
  hasMatch: (node: DiskTreeNode) => boolean;
};

const buildRoot = (): DiskTreeNode => ({
  id: 'root',
  name: '/',
  path: '/',
  type: 'folder',
  children: [],
});

const ensureFolder = (parent: DiskTreeNode, segment: string, currentPath: string) => {
  const existing = parent.children?.find((child) => child.type === 'folder' && child.name === segment);
  if (existing) return existing;
  const node: DiskTreeNode = {
    id: `folder:${currentPath}${segment}/`,
    name: segment,
    path: `${currentPath}${segment}/`,
    type: 'folder',
    children: [],
  };
  parent.children?.push(node);
  return node;
};

const buildTree = (disks: DiskEntry[]): DiskTreeNode => {
  const root = buildRoot();
  disks.forEach((disk) => {
    const parts = disk.path.split('/').filter(Boolean);
    let current = root;
    let currentPath = '/';
    parts.slice(0, -1).forEach((segment) => {
      current = ensureFolder(current, segment, currentPath);
      currentPath = current.path;
    });
    const node: DiskTreeNode = {
      id: `disk:${disk.id}`,
      name: disk.name,
      path: disk.path,
      type: 'disk',
      diskId: disk.id,
    };
    if (!current.children) current.children = [];
    current.children.push(node);
  });

  const sortNodes = (node: DiskTreeNode) => {
    if (!node.children) return;
    node.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    node.children.forEach(sortNodes);
  };
  sortNodes(root);
  return root;
};

export const buildDiskMatches = (disks: DiskEntry[], query: string): Record<string, DiskMatchInfo> => {
  const normalized = query.trim().toLowerCase();
  const matches: Record<string, DiskMatchInfo> = {};
  disks.forEach((disk) => {
    if (!normalized) {
      matches[disk.id] = { matches: true, matchedField: null };
      return;
    }
    const nameMatch = disk.name.toLowerCase().includes(normalized);
    const pathMatch = disk.path.toLowerCase().includes(normalized);
    const groupMatch = (disk.group || '').toLowerCase().includes(normalized);
    const matchedField = nameMatch ? 'name' : pathMatch ? 'path' : groupMatch ? 'group' : null;
    matches[disk.id] = { matches: Boolean(matchedField), matchedField };
  });
  return matches;
};

export const buildDiskTreeState = (disks: DiskEntry[], query: string): DiskTreeState => {
  const root = buildTree(disks);
  const matches = buildDiskMatches(disks, query);

  const filterTree = (node: DiskTreeNode): DiskTreeNode | null => {
    if (node.type === 'disk') {
      if (!node.diskId) return null;
      return matches[node.diskId]?.matches ? { ...node } : null;
    }
    const children = (node.children ?? [])
      .map((child) => filterTree(child))
      .filter((child): child is DiskTreeNode => Boolean(child));
    if (node.id === 'root') {
      return { ...node, children };
    }
    if (!children.length) return null;
    return { ...node, children };
  };

  const filteredRoot = query.trim() ? filterTree(root) ?? { ...root, children: [] } : root;

  const hasMatch = (node: DiskTreeNode): boolean => {
    if (node.type === 'disk' && node.diskId) {
      return matches[node.diskId]?.matches ?? false;
    }
    if (!node.children?.length) return false;
    return node.children.some(hasMatch);
  };

  return { root: filteredRoot, matches, hasMatch };
};
