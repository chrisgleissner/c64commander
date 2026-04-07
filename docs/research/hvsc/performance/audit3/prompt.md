# HVSC Playlist Performance Implementation Prompt

Date: 2026-04-07
Type: Strict execution prompt
Primary inputs:

- `docs/research/hvsc/performance/audit3/hvsc-playlist-catalog-architecture.md`
- `docs/research/hvsc/performance/audit3/audit3.md`
  Classification: `CODE_CHANGE`

## ROLE

You are a senior performance engineer implementing the ranked findings from the HVSC Playlist Performance Audit (audit3). You must execute in strict priority order, proving each change with measured evidence before advancing.

## MISSION

Make HVSC add-to-playlist and large-playlist interaction production-grade at 100k scale.

**Hard targets:**

- HVSC add-to-playlist (60k songs): < 2 seconds from tap to functional playlist on Pixel 4
- Playlist filter (100k items): < 300ms per keystroke on Pixel 4
- Playlist render (100k items): no jank on scroll
- No user-visible workflow step > 2s without feedback

## MANDATORY FIRST STEPS

1. Read and internalize `docs/research/hvsc/performance/audit3/hvsc-playlist-catalog-architecture.md` — this is the required and authoritative source of truth for the target data model, ingest flow, filtering flow, storage model, and metadata hydration flow.
2. Read and internalize `docs/research/hvsc/performance/audit3/audit3.md` — this is the required source of truth for bottleneck analysis, scored approaches, and benchmark evidence, but it is subordinate to the architecture document if any wording differs.
3. Create or update `PLANS.md` with the implementation plan derived from the architecture spec and audit rankings.
4. Create or update `WORKLOG.md` for timestamped progress entries.
5. Do not skip ahead. Each task must be completed and verified before starting the next.

## EXECUTION ORDER

Execute in exactly this order. Do not reorder. Do not skip.

### Task 1: HVSC-A01 — Songlengths.md5-seeded SQLite catalog and in-memory browse projection

**What:** Replace the current browse-index-dependent recursive enumeration path with a Songlengths.md5-seeded SQLite-first HVSC catalog plus an in-memory browse projection loaded from that catalog on app start and refreshed after HVSC ingestion.

**Where:**

- New SQLite-first catalog layer in `src/lib/hvsc/` plus an in-memory browse projection loader
- `src/lib/sourceNavigation/hvscSourceAdapter.ts` — `listFilesRecursive()` and any related browse/list mapping
- `src/lib/hvsc/hvscSongLengthService.ts` or the HVSC bootstrap path that runs after ingestion / on cold start
- `src/lib/sid/songlengths.ts` — reuse or extend parsing primitives where appropriate

**Why:** Songlengths.md5 parsing plus folder-hierarchy build completes in ~177ms desktop / ~709ms Pixel 4 estimate and avoids the fragile browse-index activation chain entirely. The architecture spec requires one Android-first persistent catalog format, not separate platform-specific cache formats. Performance is paramount, so Android's best-performing storage model becomes the canonical catalog model for all platforms wherever possible.

**How:**

1. Parse `Songlengths.md5` comment lines and durations into seed catalog rows containing virtual path, file name, seed display title, seed display author where available, durations, subsong count, and derived folder hierarchy.
2. Persist those rows in the canonical SQLite-first HVSC catalog format.
3. On app start, load the catalog and build a compact in-memory browse projection from it.
4. Route HVSC recursive enumeration and folder listing through that in-memory browse projection instead of the current browse snapshot fast path.
5. Do not keep the current browse index as an enumeration dependency and do not introduce a second catalog format for other platforms unless there is no viable alternative.
6. If web cannot use native SQLite directly, preserve the same schema, keys, and query semantics through the closest compatible layer available.

**Regression test:** Parsing a representative Songlengths.md5 fragment must produce the expected seed catalog rows, durations, subsong counts, and folder rows.

**Proof required:** Benchmark showing Songlengths parse + catalog materialization + browse-projection build + recursive listing stays within the audit budget. Demonstrate that add-to-playlist no longer depends on browse-index rebuilds or BFS traversal, and that the same catalog model is used across Android, iOS, and web with minimal divergence.

### Task 2: HVSC-A03 — Single bulk playlist state set

**What:** Replace the batched `setPlaylist(prev => [...prev, ...batch])` pattern for HVSC with a single `setPlaylist(allItems)` call.

**Where:**

- `src/pages/playFiles/handlers/addFileSelections.ts` — the `appendPlaylistBatch` function and the `HVSC_BULK_BATCH_THRESHOLD` constant

**Why:** Audit measured O(n²) quadratic cost: 86ms desktop / 430–690ms Pixel 4 for 60k items at batch=250. A single set costs 0.3ms. This also eliminates 240 intermediate React re-renders.

**How:**

1. For HVSC source: collect all `PlaylistItem` objects into a local array without calling `setPlaylist` during iteration.
2. After all items are collected, call `setPlaylist(prev => [...prev, ...allHvscItems])` once.
3. Update progress display to show item count during collection phase without triggering React state updates.
4. Keep the existing batched pattern for non-HVSC sources (they have legitimate per-item async work).

**Regression test:** Benchmark test that verifies HVSC add-to-playlist with 60k items completes with exactly 1 `setPlaylist` call (not 240).

**Proof required:** Before/after timing measurement for 60k HVSC add-to-playlist. Must show >90% reduction in React state update overhead.

### Task 3: HVSC-A04 — Skip config discovery for HVSC source

**What:** Bypass `discoverConfigCandidates()` for HVSC items.

**Where:**

- `src/pages/playFiles/handlers/addFileSelections.ts` — inside `appendPlayableFile()` around lines 497–515

**Why:** HVSC songs never have associated `.cfg` files. The current code correctly returns `null` for HVSC config, but the surrounding code path still executes unnecessary operations.

**How:**

1. In `appendPlayableFile()`, add an early branch: if `source.type === "hvsc"`, construct the `playbackConfig` object directly with null values, skipping `discoverConfigCandidates()`.
2. Ensure the resulting `PlaylistItem` is identical to what the current code produces for HVSC items.

**Regression test:** Unit test verifying HVSC playlist items have null config fields.

**Proof required:** Verify identical playlist items before/after.

### Task 4: LIST-A03 — Debounce filter input

**What:** Add 200ms debounce to the playlist filter query.

**Where:**

- The component that provides the `query` value to `useQueryFilteredPlaylist`. Likely in `PlaylistPanel.tsx` or the parent page component.

**Why:** At 100k, each filter invocation costs ~35ms desktop / ~140ms Pixel 4. Debouncing reduces keystrokes that trigger re-filter from every character to final intent.

**How:**

1. Wrap the filter input's `onChange` handler with a 200ms debounce.
2. Show the typed text immediately in the input (controlled component) but defer the `query` prop update.
3. Consider using `useDeferredValue` or a simple `useRef` + `setTimeout` pattern.

**Regression test:** Test that rapid typing triggers filter at most once per 200ms interval.

**Proof required:** Measure filter invocations per second before/after at 100k.

### Task 5: HVSC-A02 — Background SID metadata hydration with heuristic author inference

**What:** Populate the metadata that Songlengths.md5 does not contain lazily in the background. Eagerly seed a presentable title from the file name and a provisional author from reliable folder hierarchy such as `MUSICIANS`, then replace those provisional values with canonical SID header metadata when hydrated. This work must update the same SQLite-first HVSC catalog, must run on a background worker/thread rather than the UI thread, must have explicit user-visible progress, must be resource-throttled so it never harms responsiveness, and should surface in the same HVSC progress/status area already used for ingest.

**Where:**

- New metadata cache/hydrator in `src/lib/hvsc/`
- `src/lib/sourceNavigation/hvscSourceAdapter.ts` or adjacent browse/list mapping code
- Any playlist-item construction path that currently depends on eager SID metadata for `songNr`, `subsongCount`, or display fields
- The existing HVSC ingest/status progress surface and its backing state/events, extended rather than replaced

**Why:** Songlengths.md5 gives the maximum-performance path for enumeration, durations, and subsong counts, but it does not provide canonical author/title/released/start-song metadata. Users should still see immediately useful labels before hydration completes, so display metadata must be seeded eagerly from path/file-name data and then upgraded in background work, not by keeping the browse index on the critical path.

**How:**

1. Eagerly seed display title from the file name using presentation-safe normalization. At minimum replace `_` with spaces; preserve any existing title-formatting convention such as stripping the `.sid` extension if the current UI already does so.
2. Infer provisional author from reliable taxonomy segments such as `/MUSICIANS/<author>/...`, again normalizing display text by replacing `_` with spaces.
3. Leave author unset outside reliable folder taxonomies rather than guessing.
4. Hydrate canonical SID header metadata (title, author, released, startSong, optional clock/model fields) lazily in a background worker/thread or equivalent non-UI execution context.
5. Persist hydrated metadata back into the same SQLite-first HVSC catalog so the next app start reuses it instead of repeating SID-header discovery.
6. Replace provisional metadata with canonical values as hydration completes.
7. Default early playlist items to `songNr=1` unless canonical metadata is already known; do not overwrite explicit user song selections when a lazy start-song value arrives later.
8. Reuse the existing HVSC ingest/status area for visibility. Do not introduce a second disconnected progress surface if the current one can be extended.
9. Use concise, consistent status text in that shared surface. Prefer a short machine-like format such as `HVSC META 12,340/60,572` plus a brief state token like `queued`, `running`, `paused`, `done`, or `error`.
10. Report at minimum: processed count, total count, percent complete, current state, and last meaningful update time. Error counts may be shown only if non-zero.
11. Keep the hydrator off the critical path and rate-limited. Process in small chunks with explicit yielding between chunks, cap concurrent file reads/parses, and pause or downshift when the app is busy so scrolling, typing, playback controls, and folder navigation remain responsive.
12. Make hydration resumable. If the app restarts or the user leaves and returns, progress state should recover cleanly from the persisted catalog state rather than restarting blindly unless invalidation requires it.
13. Ensure the shared HVSC progress surface distinguishes ingest from metadata hydration clearly but with the same visual grammar and terse formatting.

**Regression test:** Test filename-to-title normalization, test heuristic author extraction for `MUSICIANS` paths, test that hydrated metadata replaces provisional values without overwriting explicit user choices, and test that progress state transitions are emitted in the expected concise sequence.

**Proof required:** Demonstrate that provisional title/author values appear immediately, that canonical SID-derived metadata replaces them progressively, and that this enrichment happens without affecting add-to-playlist latency. Show that hydrated metadata survives app restart because it is persisted in the shared catalog. Show that the shared HVSC progress surface exposes the background job clearly throughout execution. Include evidence that worker/thread offload plus chunking/throttling keeps the app responsive during active scrolling/filtering/playback interaction.

### Task 6: HVSC-A05 — Defer IndexedDB commit

**What:** Move the `commitPlaylistSnapshot()` call to fire asynchronously after the playlist is marked ready.

**Where:**

- `src/pages/playFiles/handlers/addFileSelections.ts` — the commit sequence around lines 836–846

**Why:** IndexedDB commit costs ~3.2s at 60k scale, blocking the UI during "Validating playlist visibility." The playlist is already functional in React state.

**How:**

1. After the final `setPlaylist()` call, immediately set the progress to "ready" and show the toast.
2. Fire `commitPlaylistSnapshot()` as a fire-and-forget async operation.
3. Update `playlistRepositorySync` to mark the phase as "BACKGROUND_COMMITTING" during the async commit.
4. Ensure `useQueryFilteredPlaylist` gracefully handles `repositoryReady === false` by using in-memory filtering until the commit completes.
5. Add error logging if the background commit fails.

**Regression test:** Test that playlist is interactive immediately after add-to-playlist completes, even before IndexedDB commit finishes.

**Proof required:** Measure time from tap to interactive playlist before/after.

### Task 7: LIST-A01 — Virtual scrolling

**What:** Integrate `@tanstack/react-virtual` into the playlist view-all rendering path.

**Where:**

- `src/components/lists/SelectableActionList.tsx` — the main list render
- `src/pages/playFiles/hooks/usePlaylistListItems.tsx` — the item preparation hook

**Why:** Without virtualization, rendering 10k+ items creates thousands of DOM nodes. Virtual scrolling renders only ~30 visible rows regardless of total count.

**How:**

1. Install `@tanstack/react-virtual`.
2. In `SelectableActionList`, wrap the list body in a `useVirtualizer` that estimates row height.
3. Only render the items within the virtual window.
4. Handle variable heights (folder header rows vs song rows) with a `estimateSize` function.
5. Preserve selection, menu, and keyboard navigation behavior.
6. Apply this only when the list exceeds a threshold (e.g., >500 items) to avoid overhead on small lists.

**Regression test:** E2E test verifying scroll, selection, and playback work correctly with 1k+ items.

**Proof required:** Measure render time and DOM node count at 10k and 100k scale.

## VALIDATION REQUIREMENTS

After each task:

1. Run `npm run test` and ensure all tests pass.
2. Run `npm run test:coverage` and maintain >= 91% branch coverage.
3. Run `npm run lint` and ensure no new warnings.
4. Run `npm run build` and ensure it succeeds.
5. Add a dedicated regression test for the change.
6. Record the before/after measurement in `WORKLOG.md`.
7. Update `PLANS.md` with the current status.

## NON-NEGOTIABLE RULES

1. Do not skip tasks. Complete Task 1 before starting Task 2.
2. Do not merge tasks. Each task gets its own commit with its own proof.
3. Do not claim completion without measured evidence.
4. Do not refactor beyond the task scope.
5. Do not weaken existing tests to make new code pass.
6. Do not introduce silent exception handling.
7. Preserve all existing playlist correctness guarantees.
8. Keep the existing commit-barrier and repository-sync contracts intact.
9. If a task is blocked, stop, record the blocker in `WORKLOG.md`, and do not proceed.

## TERMINATION

You are done when:

1. Tasks 1–4 (Phase 1 quick wins) are complete with measured proof.
2. Tasks 5–7 (Phase 2 foundation) are complete or explicitly blocked with recorded evidence.
3. `PLANS.md` contains the final pass/fail matrix.
4. `WORKLOG.md` contains timestamped entries for each task.
5. All tests pass with >= 91% branch coverage.

## DEPENDENCY GRAPH

```
Task 1 (SQLite catalog) ─────┐
Task 2 (bulk state set) ──────┤──→ Task 5 (metadata hydration)
Task 3 (skip config) ─────────┤──→ Task 6 (defer IndexedDB commit)
Task 4 (debounce filter) ─────┘──→ Task 7 (virtual scrolling)
```

Tasks 1–4 are independent and may run in parallel.
Tasks 5–7 depend on Tasks 1–4 being complete.
