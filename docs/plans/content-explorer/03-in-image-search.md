# 03 — In-Image Search (engineering deep-dive)

**Capability C** of the [Content Explorer](./overview.md) initiative.
**Feature flag:** `in_image_search_enabled`
**Status:** Implemented behind `in_image_search_enabled` (experimental, off by default).
**Depends on:** capability A (`diskImage.listDirectory`).

> **As-built (shipped).** `src/lib/media-index/inImageSearch.ts` implements media index v2:
> `MediaEntryV2` with a `container`, `migrateSnapshotToV2` (lossless v1 load), `toChildEntry`,
> `hasFreshChildren` / `replaceChildren` (supersede on `path + size + mtime`),
> `reconcileChildren`, and `searchMediaEntries` (case-insensitive, multi-word AND; child
> entries excluded when the toggle is off). Children use the compound path `<diskPath>#<index>`
> as planned. The **Search inside disk images** toggle ships in **Settings → Play and disk
> behaviour**; hits render as **DISK → PROGRAM** and reuse Disk Explorer's Run / Load.
> Matches the plan; a child's `sizeBytes` is derived as `blocks × 254`.

> Goal: find a program that only exists *inside* a `.d64` / `.d71` / `.d81`, then
> act on it directly. Search should descend into disk images, not stop at their
> filenames.

---

## 1. What's missing today

`src/lib/media-index/mediaIndex.ts` stores exactly one entry per file:

```ts
type MediaEntry = { path; name; type: "sid"|"mod"|"prg"|"crt"|"disk"; durationSeconds?; sizeBytes? };
```

A disk is a single `type: "disk"` row with no notion of its contents. So a scan of
storage can tell you "there are 300 `.d64` files" but never "the program you want
is the third file inside `GAMES/COMPILATION.D64`".

---

## 2. Data model — media index v2 (parent + children, keyed by path+size+mtime)

The right shape is a **parent disk row plus child program rows**, where each child
records the identity of the disk version it came from. When a disk is rewritten,
its `size`/`mtime` change, which supersedes its old children automatically. This
is a straightforward relational pattern; in the app's snapshot storage it becomes
two related record shapes.

```ts
export type MediaEntryV2 = {
  path: string;                 // for a child: "<diskPath>#<index>"
  name: string;                 // child: the in-disk program name
  type: "sid" | "mod" | "prg" | "crt" | "disk";
  durationSeconds?: number | null;
  sizeBytes?: number | null;

  // present only on in-image CHILD entries:
  container?: {
    diskPath: string;
    diskType: "d64" | "d71" | "d81";
    diskSize: number;           // parent identity …
    diskMtime: string;          // … the (path,size,mtime) supersede key
    entryIndex: number;         // stable index into listDirectory()
    fileType: "PRG" | "SEQ" | "USR" | "REL" | "CBM" | "DEL";
    blocks?: number;
  };
};

export type MediaIndexSnapshot =
  | { version: 1; updatedAt: string; entries: MediaEntry[] }              // legacy, still loadable
  | { version: 2; updatedAt: string; entries: MediaEntryV2[] };
```

Why a compound `path` (`"<diskPath>#<index>"`) for children: it keeps the existing
flat `entries: MediaEntryV2[]` array and the `queryByPath` primitive working
unchanged, while `container` carries everything needed to launch (capability A's
`disk-file` plan) and to invalidate.

**Supersede rule.** When scanning a disk whose `(diskPath)` already has children
but with a different `(diskSize, diskMtime)`, drop the stale children before
inserting the new ones. This mirrors a parent-keyed cascade: children are only
valid for the exact disk version that produced them.

### Migration v1 → v2

- v1 snapshots load as-is; every existing entry is a top-level file with no
  `container`. No disk has children until it is re-scanned. So the upgrade is
  lossless and lazy — nothing forces a re-scan.
- Bump the writer to emit `version: 2`. Keep a v1 reader for one release.

---

## 3. Scanning: populate children while indexing

Extend `MediaIndex.scan(paths)` (and the source-walk that feeds it):

```ts
// pseudo — inside the per-file step of a scan
if (isDiskFile(entry) && inImageSearchEnabled()) {
  const { size, mtime } = entry;                       // FTP MLSD facts / local stat
  if (!hasFreshChildren(entry.path, size, mtime)) {    // cache check on (path,size,mtime)
    const bytes = await fetchWithSafety(entry.path);   // Device Safety-throttled fetch (or local blob)
    const dir = listDirectory(bytes, diskTypeOf(entry));   // capability A
    replaceChildren(entry.path, size, mtime, dir.map(toChildEntry));
  }
}
```

Cost controls (all reuse existing machinery):

- **Cache on `(path, size, mtime)`.** Re-scanning an unchanged tree does no disk
  reads — the same key already available from FTP `MLSD` (`modify`, `size`) or a
  local `stat`. A rewritten disk (new mtime) is re-read; an unchanged one is not.
- **Device Safety throttle.** Route the fetch through the existing FTP concurrency
  limiter / cooldowns in `deviceSafetySettings.ts`. In-image indexing must never
  open un-governed connections.
- **Scoped + time-budgeted.** Scanning is always "from this folder down" with a
  running status (folders walked, images opened, current path) and a **Stop**
  control, so a phone never tries to index all of storage.
- **Bounded parse.** Skip images past a size cap (the parser only needs the
  directory, but the fetch is the cost); record a skip reason.

---

## 4. Search

- Add a "search inside disk images" toggle to the media/browse search.
- Off → search top-level entries only (today's behaviour, unchanged).
- On → also match child `name`. Matching is case-insensitive substring; for
  multi-word queries, AND the terms (`"turrican level"` matches an entry whose
  name contains both). Store a `nameLower` alongside each entry (or lower-case at
  query time for small indexes) to keep matching cheap.
- Results: child hits render as `DISKNAME → PROGRAM` with a disk glyph, and their
  actions are Disk Explorer's **Run** / **Load** / **jump to containing disk**,
  driven by `container` (capability A). No new launch code.

---

## 5. Consistency & lifecycle

- **Removed disks:** a completed scoped scan reconciles — children whose parent
  disk path no longer exists in the scanned scope are dropped, so stale in-image
  hits don't linger.
- **Storage identity:** children live under the same per-device index the app
  already keys media by; switching devices shows that device's in-image catalogue.
- **Snapshot size:** children multiply row counts (a full HVSC-style tree can be
  large, but disks are typically dozens of programs). Keep the flat array but
  consider chunked persistence if snapshot writes get heavy; not needed initially.

---

## 6. Test plan

- **Unit** — v1→v2 migration loads legacy snapshots; `toChildEntry` maps a
  `listDirectory` result correctly; the `(path,size,mtime)` cache returns fresh on
  identical facts and stale (triggering re-parse) when mtime changes;
  `replaceChildren` supersedes old children of a rewritten disk.
- **Unit** — search: toggle off ignores children; toggle on matches child names;
  multi-word AND; case-insensitive.
- **Playwright** — a new `inImageSearch.spec.ts`: scan a folder with a multi-file
  disk (mock), toggle on, search a name that only exists inside the disk, get a
  `DISK → PROGRAM` hit, Run it, assert the mock device receives the launch.
- **Mock** — reuse capability A's multi-file `.d64` fixture; assert child rows.
