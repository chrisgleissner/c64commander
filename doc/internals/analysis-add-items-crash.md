# Root Cause Analysis: Android SAF add-items crash

## Symptom
- Runtime exception on Android after returning from SAF picker:
  - `(intermediate value).entries.map is not a function`
- Exception was not recorded in Diagnostics logs.

## Call stack (add-items flow)
- `src/pages/PlayFilesPage.tsx` `handleAddFileSelections` (around lines 531-705)
  - Calls `source.listEntries(...)` while scanning selections.
- `src/lib/sourceNavigation/localSourceAdapter.ts` `createLocalSourceLocation().listEntries` (around lines 81-106)
  - For SAF-backed sources, delegates to `listSafEntries`.
- `src/lib/sourceNavigation/localSourceAdapter.ts` `listSafEntries` (around lines 43-73)
  - Calls `FolderPicker.listChildren(...)` and previously assumed `response.entries` is an array.
  - The crash occurred at `response.entries.map(...)` when `entries` was not an array.

## Old assumption
- SAF `listChildren` returns `{ entries: Entry[] }` and `entries` is always an array.

## New invariant
- SAF responses must be validated before mapping.
- `LocalSourceRecord.entries` must never be used on SAF sources.
- All SAF listing must go through `listEntries`, with strict shape checks and typed errors.

## Logging gap
- `handleAddFileSelections` caught errors but did not log them, so the failure never appeared in Diagnostics.
