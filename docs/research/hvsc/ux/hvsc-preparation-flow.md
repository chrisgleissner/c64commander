# HVSC Preparation Flow

## Goal

Make `Add items -> HVSC` the single first-use entry point for HVSC. Users should not need to discover or sequence separate manual download and ingest actions before they can browse the library.

## User journey

1. The user opens `Add items` from the Play page.
2. The chooser always shows `HVSC` when the native HVSC bridge is available, even if the library is not ready yet.
3. Selecting `HVSC` opens `Preparing HVSC library` instead of dropping the user into an empty browser.
4. The sheet starts preparation automatically and shows deterministic progress for download or indexing.
5. If preparation fails, the sheet keeps the failed phase and lets the user retry from the correct point:
   - download failures restart the full install path
   - ingest failures reuse the cached archive and restart indexing
6. When preparation completes, the user must press `Browse HVSC` to enter the library.

## User-facing states

- `NOT_PRESENT`: HVSC is not ready and no cached archive is available.
- `DOWNLOADING`: the archive download is in progress.
- `DOWNLOADED`: the archive is cached and can be indexed without downloading again.
- `INGESTING`: extraction, songlength processing, or metadata indexing is active.
- `READY`: the indexed library is available for browsing.
- `ERROR`: preparation failed; the sheet preserves the failed phase and reason.

## Play page controls

The Play page is no longer the primary first-use HVSC entry surface.

- The main HVSC card now shows summary information only:
  - current status label
  - progress or throughput while active
  - ready song count or failure reason
- Recovery controls remain available under `Advanced`:
  - `Reindex HVSC`
  - `Reset HVSC`

## Failure handling

- The sheet must stay explicit about which phase failed.
- Retry must resume from the failed phase instead of always starting over.
- `Reset HVSC` must clear the cached archives, indexed library, and persisted browse snapshots, not only the transient summary UI state.

## Chooser alignment follow-up

The source chooser uses a shared icon slot so all source labels line up on the same horizontal start edge. The `CommoServe` row keeps that alignment while rendering a larger CommoServe mark inside the slot.

## Evidence

Updated screenshots for this flow live under:

- `docs/img/app/play/import/`
- `docs/img/app/play/import/profiles/`
