# HVSC Playlist Catalog Architecture

Date: 2026-04-07
Classification: `DOC_ONLY`
Status: Authoritative target architecture for audit3 implementation

## 1. Purpose

This document defines the target architecture for:

- HVSC discovery and add-to-playlist ingest
- playlist filtering at 60k-100k scale
- lazy SID header metadata enrichment

The core requirement is a clear progression from fast `Songlengths.md5` seed data to authoritative SID-header data, without paying the same discovery cost again on the next app start.

If this document conflicts with `audit3.md` or `prompt.md`, this document wins.

## 2. Core Decision

Use one logical **HVSC Catalog Store** as the source of truth for all HVSC-origin playlist rows.

- `Songlengths.md5` is the authoritative seed input for path discovery, durations, subsong counts, and folder hierarchy.
- SID headers are the authoritative source for canonical title, canonical author, released text/year, and default song.
- The merged result is persisted and reused on the next app start.
- The old browse index is not kept as a separate authority.

## 3. Storage Model

Use one **SQLite-first catalog format** across platforms.

- Android defines the canonical on-disk model because performance is paramount and Android is the primary performance target.
- iOS should use the same SQLite schema and query model.
- Web should also use the same SQLite schema and semantics whenever technically possible. If web cannot use native SQLite directly, it must still preserve the same table layout, row model, keys, and query behavior through the closest compatible SQLite-backed or SQLite-emulating layer available.

The architectural goal is to avoid platform-specific catalog variants. There should be one persistent merged catalog model, optimized first for Android, then carried across web and iOS with as little divergence as possible.

## 4. Catalog Schema

The catalog should store one row per HVSC SID path plus a small amount of derived indexing data.

### 4.1 Song Row

Recommended logical fields:

- `hvscVersion` or equivalent catalog generation key
- `virtualPath` as stable primary key
- `folderPath`
- `fileName`
- `displayTitleSeed`
- `displayAuthorSeed`
- `canonicalTitle`
- `canonicalAuthor`
- `released`
- `defaultSong`
- `subsongCount`
- `durationsSeconds` as compact serialized array
- `defaultDurationSeconds`
- `metadataStatus` with values such as `seeded`, `queued`, `hydrating`, `hydrated`, `error`
- `metadataUpdatedAt`
- `searchTextSeed`
- `searchTextFull`

### 4.2 Folder Row

Either persist folder rows directly or persist enough information to rebuild them quickly.

Recommended logical fields:

- `folderPath`
- `parentPath`
- `folderName`
- `childFolderCount`
- `songCount`

Persisting folder rows is preferred if startup cost must be minimized aggressively. Rebuilding them from persisted song rows is acceptable only if it remains comfortably below the startup budget.

### 4.3 Metadata Progress Row

Persist background hydration state so it survives app restarts.

Recommended logical fields:

- `hvscVersion`
- `totalSongs`
- `hydratedSongs`
- `errorSongs`
- `phase` such as `idle`, `queued`, `running`, `paused`, `done`, `error`
- `lastProcessedPath` or cursor
- `updatedAt`

## 5. Seed Data Rules

Seed data is derived eagerly from `Songlengths.md5` and path structure.

### 5.1 Seed Title

Seed title from the file name.

Normalization rules:

- strip the `.sid` extension if the UI convention expects display titles without extensions
- replace `_` with spaces
- collapse repeated whitespace
- preserve the underlying file name separately for exact path/file operations

Example:

- `Comic_Bakery.sid` -> `Comic Bakery`

### 5.2 Seed Author

Seed author only from reliable folder taxonomy.

Rule:

- for paths under `/MUSICIANS/<author>/...`, derive author from that folder name
- replace `_` with spaces
- do not guess author outside this taxonomy

Example:

- `/MUSICIANS/H/Hubbard_Rob/Comic_Bakery.sid` -> `Rob Hubbard`

### 5.3 Seed Playback Defaults

Before SID-header enrichment completes:

- `subsongCount` comes from `Songlengths.md5`
- `durationsSeconds` comes from `Songlengths.md5`
- `defaultSong` is `1`

That default may later be replaced by SID-header data, but never at the cost of overriding an explicit user song selection already stored in a playlist item.

## 6. Boot and Invalidation Flow

### 6.1 Cold Start

On app start:

1. Read installed HVSC version and catalog version.
2. If the persisted SQLite catalog matches the installed HVSC version, load it directly.
3. Build the in-memory browse projection from the persisted catalog.
4. Resume metadata hydration only for rows not yet in `hydrated` state.

The app must not re-parse all SID headers on every launch.

### 6.2 Missing or Stale Catalog

If no matching catalog exists:

1. Parse `Songlengths.md5`.
2. Materialize seed song rows and folder rows.
3. Persist the catalog in the canonical SQLite-first format.
4. Load the in-memory browse projection.
5. Queue background SID-header hydration.

### 6.3 HVSC Update

When a new HVSC version is installed:

1. invalidate the prior catalog by version
2. rebuild the seed catalog from the new `Songlengths.md5`
3. clear or version-scope stale metadata hydration state in the same catalog
4. start a fresh metadata hydration pass for the new version

## 7. In-Memory Browse Projection

The UI should not query the persistent catalog row-by-row for every folder open or recursive add.

Instead, load a compact in-memory projection from the persisted catalog containing:

- path -> song projection
- folder -> child folders
- folder -> child songs

Minimum song projection fields:

- `virtualPath`
- `fileName`
- `displayTitle`
- `displayAuthor`
- `defaultDurationSeconds`
- `durationsSeconds`
- `subsongCount`
- `defaultSong`
- `metadataStatus`

This replaces the current browse-index role without reintroducing a second authority.

## 8. HVSC to Playlist Ingest

### 8.1 Entry Path

The entry path remains the playlist add handler, but HVSC selection enumeration must come from the in-memory browse projection seeded from the catalog.

### 8.2 Ingest Flow

1. User selects HVSC folder or library.
2. Source adapter performs recursive enumeration from the in-memory projection.
3. Each song already has path, duration, subsong count, seed title, and optional seed author.
4. Playlist items are constructed in one bulk collection pass.
5. React playlist state is updated once.
6. Repository persistence runs after the playlist becomes usable.

### 8.3 Playlist Item Contract

For HVSC items, playlist rows should reference catalog data rather than duplicating a second metadata authority.

Recommended identity:

- `trackId = hvscVersion + virtualPath`
- `songNr = explicit selection or catalog defaultSong`

The playlist item may cache display fields for convenience, but the SQLite-first catalog remains authoritative for HVSC metadata.

## 9. Background SID Metadata Hydration

### 9.1 Goal

Upgrade seeded metadata to authoritative metadata without blocking import, browse, filter, or playback.

### 9.2 Execution Model

Run hydration on a background worker/thread or equivalent non-UI execution context.

Rules:

- process in small chunks
- yield between chunks
- cap concurrent SID reads/parses
- downshift or pause under UI pressure
- persist progress after each chunk or small batch

### 9.3 Hydration Steps

For each queued song row:

1. read SID header
2. parse canonical title
3. parse canonical author
4. parse released text/year
5. parse default song
6. update the catalog row
7. rebuild `searchTextFull`
8. mark row `hydrated`

If parsing fails:

- keep seed title/author
- keep `defaultSong = 1`
- mark row `error`
- continue

### 9.4 Progress Visibility

Use the same HVSC status surface already used for ingest.

Formatting should be concise and consistent, for example:

- `HVSC META 12,340/60,572 running`
- `HVSC META 60,572/60,572 done`

Required fields:

- processed count
- total count
- percent complete
- state token
- last update time

## 10. Filtering Architecture

Filtering currently has two modes and the target architecture should preserve that shape.

### 10.1 Before Repository Ready

Use in-memory filtering over the React playlist array.

Current search fields are roughly:

- label
- path
- request path
- source
- category

For HVSC-origin items, `label` should already contain the best currently-known title.

That means filtering improves automatically as metadata hydration upgrades seed labels to canonical labels.

### 10.2 After Repository Ready

Use repository-backed filtering.

The repository query should eventually operate over catalog-backed searchable fields rather than only the playlist row text snapshot.

Recommended rule:

- search canonical metadata when available
- fall back to seed metadata otherwise

This is why `searchTextSeed` and `searchTextFull` belong in the catalog.

### 10.3 Search Text Strategy

Recommended searchable text composition:

- seed phase: normalized title seed + normalized author seed + virtual path + file name
- hydrated phase: canonical title + canonical author + released + virtual path + file name

Updating one stored normalized search field per row is cheaper than recomputing normalization on every filter query.

## 11. Next-Start Behavior

The SQLite-first catalog must eliminate repeated expensive work.

On the next app start:

- do not re-parse `Songlengths.md5` if a matching catalog version already exists
- do not re-parse SID headers for rows already marked `hydrated`
- resume hydration only for `queued`, `hydrating`, or retryable `error` rows
- restore the in-memory browse projection from the persisted catalog

This is the central reason to use one persistent merged catalog rather than a transient Songlengths cache plus a separate transient metadata cache.

## 12. Recommended Ownership Boundaries

- `Songlengths.md5` parser: seed-only importer
- catalog store: persistent merged authority
- in-memory browse projection: fast read model for UI and recursive add
- metadata hydrator: background upgrader from seed fields to canonical fields
- playlist repository: playlist order/state, referencing catalog-backed track identity

## 13. Non-Negotiable Invariants

- No separate browse index authority once the catalog exists.
- Seed data must be usable immediately after `Songlengths.md5` import.
- Canonical SID metadata must overwrite seed metadata only for display/search fields, not for explicit user song choices.
- Metadata hydration must remain visible.
- Metadata hydration must remain resumable.
- Startup must reuse persisted merged data whenever the HVSC version matches.

## 14. Summary

The intended progression is:

1. parse `Songlengths.md5`
2. create seed catalog rows
3. persist the catalog
4. build in-memory browse projection
5. ingest HVSC selections into playlist from that projection
6. hydrate SID headers in the background
7. persist canonical metadata back into the same catalog
8. reuse the merged catalog on the next app start

That gives fast first-use behavior, authoritative eventual metadata, and no repeated full-cost discovery on later launches.
