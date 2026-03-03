/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { buildDiskTreeState, type DiskTreeNode } from '@/lib/disks/diskTree';
import { createDiskEntry } from '@/lib/disks/diskTypes';

const collectFolderPaths = (node: DiskTreeNode, acc: string[] = []) => {
  if (node.type === 'folder' && node.id !== 'root') {
    acc.push(node.path);
  }
  node.children?.forEach((child) => collectFolderPaths(child, acc));
  return acc;
};

describe('diskTree filtering', () => {
  const disks = [
    createDiskEntry({ location: 'local', path: '/Games/A/One.d64' }),
    createDiskEntry({ location: 'local', path: '/Games/B/Two.d64' }),
    createDiskEntry({ location: 'local', path: '/Other/Three.d64' }),
  ];

  it('prunes empty directories when filtering', () => {
    const filtered = buildDiskTreeState(disks, 'Two');
    const paths = collectFolderPaths(filtered.root);

    expect(paths).toContain('/Games/');
    expect(paths).toContain('/Games/B/');
    expect(paths).not.toContain('/Games/A/');
    expect(paths).not.toContain('/Other/');
  });

  it('restores original structure after clearing filter', () => {
    const original = buildDiskTreeState(disks, '');
    const filtered = buildDiskTreeState(disks, 'Two');
    const restored = buildDiskTreeState(disks, '');

    expect(collectFolderPaths(filtered.root).length).toBeGreaterThan(0);
    expect(collectFolderPaths(restored.root).sort()).toEqual(collectFolderPaths(original.root).sort());
  });

  it('keeps filter/unfilter cycles idempotent', () => {
    const baseline = buildDiskTreeState(disks, '');
    const filteredOnce = buildDiskTreeState(disks, 'Two');
    const restored = buildDiskTreeState(disks, '');
    const filteredTwice = buildDiskTreeState(disks, 'Two');

    expect(collectFolderPaths(restored.root).sort()).toEqual(collectFolderPaths(baseline.root).sort());
    expect(collectFolderPaths(filteredTwice.root).sort()).toEqual(collectFolderPaths(filteredOnce.root).sort());
  });

  it('never duplicates root folders across builds', () => {
    const first = buildDiskTreeState(disks, '');
    const second = buildDiskTreeState(disks, '');
    const paths = collectFolderPaths(first.root);
    const unique = new Set(paths);

    expect(paths.length).toBe(unique.size);
    expect(collectFolderPaths(second.root).sort()).toEqual([...unique].sort());
  });
});

describe('diskTree hasMatch', () => {
  it('returns false for a disk node without diskId', () => {
    const disks = [
      createDiskEntry({ location: 'local', path: '/A/One.d64' }),
    ];
    const state = buildDiskTreeState(disks, '');
    // A disk-typed node with no diskId should return false in hasMatch
    const nodeWithoutDiskId: DiskTreeNode = { id: 'disk:orphan', name: 'Orphan', path: '/Orphan.d64', type: 'disk' };
    expect(state.hasMatch(nodeWithoutDiskId)).toBe(false);
  });

  it('returns false for a disk node that does not match the current filter', () => {
    const disks = [
      createDiskEntry({ location: 'local', path: '/A/One.d64' }),
      createDiskEntry({ location: 'local', path: '/B/Two.d64' }),
    ];
    const state = buildDiskTreeState(disks, 'Two');
    // Find the disk node for One.d64 in the original (unfiltered) tree
    const allState = buildDiskTreeState(disks, '');
    const folderA = allState.root.children?.find((c) => c.name === 'A');
    const diskOne = folderA?.children?.[0];
    expect(diskOne?.type).toBe('disk');
    // This disk should not match the 'Two' filter
    expect(state.hasMatch(diskOne!)).toBe(false);
  });

  it('returns true for a disk node that matches the current filter', () => {
    const disks = [
      createDiskEntry({ location: 'local', path: '/A/One.d64' }),
      createDiskEntry({ location: 'local', path: '/B/Two.d64' }),
    ];
    const state = buildDiskTreeState(disks, 'Two');
    const allState = buildDiskTreeState(disks, '');
    const folderB = allState.root.children?.find((c) => c.name === 'B');
    const diskTwo = folderB?.children?.[0];
    expect(diskTwo?.type).toBe('disk');
    expect(state.hasMatch(diskTwo!)).toBe(true);
  });

  it('returns false for a folder node with no children', () => {
    const disks = [createDiskEntry({ location: 'local', path: '/A/One.d64' })];
    const state = buildDiskTreeState(disks, '');
    const emptyFolder: DiskTreeNode = { id: 'folder:empty/', name: 'empty', path: '/empty/', type: 'folder', children: [] };
    expect(state.hasMatch(emptyFolder)).toBe(false);
  });

  it('returns true for a folder node that contains a matching disk', () => {
    const disks = [
      createDiskEntry({ location: 'local', path: '/A/One.d64' }),
      createDiskEntry({ location: 'local', path: '/B/Two.d64' }),
    ];
    const state = buildDiskTreeState(disks, 'Two');
    // The root itself should have a match (contains /B/Two.d64 which matches)
    expect(state.hasMatch(state.root)).toBe(true);
  });
});

describe('diskTree sort — mixed folder/disk siblings', () => {
  it('sorts folders before disks and disks before folders in reversed input', () => {
    // Place a disk directly at root alongside a subdirectory.
    // /A.d64 goes to root directly (no subfolder segment).
    // /B/Two.d64 creates folder B at root.
    const mixed = [
      createDiskEntry({ location: 'local', path: '/B/Two.d64' }),
      createDiskEntry({ location: 'local', path: '/A.d64' }),
    ];
    const state = buildDiskTreeState(mixed, '');
    const rootChildren = state.root.children ?? [];
    // After sort: folder 'B' should come before disk 'A.d64'
    expect(rootChildren[0]?.type).toBe('folder');
    expect(rootChildren[1]?.type).toBe('disk');
  });
});
