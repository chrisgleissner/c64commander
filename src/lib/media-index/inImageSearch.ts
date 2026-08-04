/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * Content Explorer capability C — media index v2 with in-image child entries.
 *
 * A disk carries child program rows keyed by disk path + size + mtime, so a
 * rewritten disk supersedes its old children automatically. Children use a compound
 * path (`<diskPath>#<index>`) so the flat `entries` array and `queryByPath` keep
 * working unchanged, while `container` carries everything needed to launch
 * (capability A's disk-file launch) and to invalidate.
 *
 * v1 snapshots load losslessly (every entry becomes a top-level file with no
 * `container`); no disk gets children until it is re-scanned.
 */

import { foldForSearch } from "@/lib/hvsc/hvscBrowseIndexStore";
import type { MediaEntry, MediaIndexSnapshot, MediaType } from "./mediaIndex";
import type { C64FileType, DiskDirectoryEntry, DiskImageType } from "@/lib/disks/diskImage";

export interface MediaEntryContainer {
  diskPath: string;
  diskType: DiskImageType;
  /** Parent identity — with diskPath these three are the supersede key. */
  diskSize: number;
  diskMtime: string;
  /** Stable index into listDirectory(). */
  entryIndex: number;
  fileType: C64FileType;
  blocks?: number;
}

export interface MediaEntryV2 {
  path: string;
  name: string;
  type: MediaType;
  durationSeconds?: number | null;
  sizeBytes?: number | null;
  /** Present only on in-image CHILD entries. */
  container?: MediaEntryContainer;
  /**
   * Set on a DISK entry once its directory has been read, naming the version that was read.
   *
   * Freshness used to be inferred from a disk having children, which is the same answer as "this
   * disk was scanned" for every disk except an empty one — and an empty one then has no record at
   * all, so every scan read it again over the network for ever. Recording the scan rather than
   * inferring it from its output makes "scanned and found nothing" a fact the index can hold.
   */
  scannedContents?: { diskSize: number; diskMtime: string };
}

export interface MediaIndexSnapshotV2 {
  version: 2;
  updatedAt: string;
  entries: MediaEntryV2[];
}

export type AnyMediaIndexSnapshot = MediaIndexSnapshot | MediaIndexSnapshotV2;

export const isChildEntry = (entry: MediaEntryV2): entry is MediaEntryV2 & { container: MediaEntryContainer } =>
  entry.container != null;

/** Compound child path so the flat array + queryByPath keep working. */
export const childPath = (diskPath: string, entryIndex: number): string => `${diskPath}#${entryIndex}`;

/** Upgrade a v1 (or already-v2) snapshot to v2. Lossless: v1 entries gain no container. */
export const migrateSnapshotToV2 = (snapshot: AnyMediaIndexSnapshot): MediaIndexSnapshotV2 => {
  if (snapshot.version === 2) return snapshot;
  return {
    version: 2,
    updatedAt: snapshot.updatedAt,
    entries: snapshot.entries.map((entry: MediaEntry) => ({
      path: entry.path,
      name: entry.name,
      type: entry.type,
      durationSeconds: entry.durationSeconds ?? null,
      sizeBytes: entry.sizeBytes ?? null,
    })),
  };
};

/**
 * Map a listDirectory entry to an in-image child media entry. The top-level `type`
 * is "prg" (children are program-like and launch via run_prg); the exact CBM file
 * type is preserved in `container.fileType`.
 */
export const toChildEntry = (
  diskPath: string,
  diskType: DiskImageType,
  diskSize: number,
  diskMtime: string,
  entry: DiskDirectoryEntry,
): MediaEntryV2 => ({
  path: childPath(diskPath, entry.index),
  name: entry.name,
  type: "prg",
  sizeBytes: typeof entry.blocks === "number" ? entry.blocks * 254 : null,
  container: {
    diskPath,
    diskType,
    diskSize,
    diskMtime,
    entryIndex: entry.index,
    fileType: entry.type,
    blocks: entry.blocks,
  },
});

/**
 * True when this exact disk version (path + size + mtime) has already been read, so a re-scan can
 * skip it.
 *
 * Answered from the disk entry's own {@link MediaEntryV2.scannedContents} stamp where there is one,
 * and from the presence of children otherwise — which is what an index written before the stamp
 * existed carries. The stamp is what makes an EMPTY disk image skippable: it has no children to
 * infer from, so without it every scan re-read it.
 */
export const hasFreshChildren = (
  entries: MediaEntryV2[],
  diskPath: string,
  diskSize: number,
  diskMtime: string,
): boolean => {
  const stamped = entries.some(
    (entry) =>
      entry.path === diskPath &&
      entry.scannedContents?.diskSize === diskSize &&
      entry.scannedContents?.diskMtime === diskMtime,
  );
  if (stamped) return true;
  return entries.some(
    (entry) =>
      isChildEntry(entry) &&
      entry.container.diskPath === diskPath &&
      entry.container.diskSize === diskSize &&
      entry.container.diskMtime === diskMtime,
  );
};

/**
 * Drop every existing child of `diskPath` (any version) and append the new
 * children — the supersede-on-rewrite rule. Non-child and other-disk rows are
 * untouched. Returns a new array.
 *
 * The disk's own entry is stamped with the version that was read, so {@link hasFreshChildren} can
 * answer for a disk that legitimately contains no programs. Passing `scanned` is what records the
 * scan; omitting it leaves the stamp alone, which is what a caller that is only editing children
 * wants.
 */
export const replaceChildren = (
  entries: MediaEntryV2[],
  diskPath: string,
  children: MediaEntryV2[],
  scanned?: { diskSize: number; diskMtime: string },
): MediaEntryV2[] => {
  const kept = entries
    .filter((entry) => !(isChildEntry(entry) && entry.container.diskPath === diskPath))
    .map((entry) => (scanned && entry.path === diskPath ? { ...entry, scannedContents: { ...scanned } } : entry));
  return [...kept, ...children];
};

/**
 * Reconcile after a completed scoped scan: drop children whose parent disk is no
 * longer present in the scanned scope, so stale in-image hits don't linger.
 */
export const reconcileChildren = (entries: MediaEntryV2[], presentDiskPaths: Iterable<string>): MediaEntryV2[] => {
  const present = new Set(presentDiskPaths);
  return entries.filter((entry) => !(isChildEntry(entry) && !present.has(entry.container.diskPath)));
};

export interface SearchOptions {
  searchInsideDisks: boolean;
}

/**
 * Case-insensitive, accent-insensitive, multi-word AND search over entry names. With
 * `searchInsideDisks` off, child (in-image) entries are excluded — today's
 * top-level-only behaviour. An empty query matches nothing.
 *
 * Accents are folded the same way {@link foldForSearch} folds them for HVSC and for the
 * walk-the-source search, because the person typing does not know which index is answering.
 * Searching "bohme" found Böhme in HVSC and in a folder on the card, and nothing at all in the
 * media index — and this is the index holding European demo and game filenames, where the
 * accents actually are.
 */
export const searchMediaEntries = (
  entries: MediaEntryV2[],
  query: string,
  { searchInsideDisks }: SearchOptions,
): MediaEntryV2[] => {
  const terms = foldForSearch(query.toLowerCase()).split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  return entries.filter((entry) => {
    if (isChildEntry(entry) && !searchInsideDisks) return false;
    const name = foldForSearch(entry.name.toLowerCase());
    return terms.every((term) => name.includes(term));
  });
};
