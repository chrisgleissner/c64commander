/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
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
