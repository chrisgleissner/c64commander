# PLANS.md — Local File Playback, System UI Overlap, Indicator Icons

## Goal
Fix local SID/SIT playback, Android status bar overlap, and indicator icon UX.

## Non-negotiables
- Follow `./build` as the authoritative local pipeline.
- Do not skip, disable, or weaken any test.
- Fix root causes; never patch around symptoms.

---

## Part A — Local File Playback Failure

### Root Cause Analysis

**Folder grouping "/" bug**: `createLocalSourceFromPicker` in `localSourcesStore.ts`
hardcodes `rootPath: '/'` for SAF sources regardless of the `rootName` received
from the Android picker. Fix: use `buildRootPath(rootName)` consistently.

**Playback failure "Local file unavailable"**: Two interrelated issues:
1. `playItem()` in `PlayFilesPage.tsx` pre-checks `item.request.file` and throws
   before attempting lazy resolution. After playlist hydration from localStorage,
   a race condition can leave `file` undefined when `localSourceTreeUris` is empty
   during first render.
2. No fallback resolution at play time: if the file ref is missing, the code does
   not attempt to rebuild it from the persisted sourceId + treeUri.

Fix: Add lazy file resolution in `playItem` that looks up the treeUri from
`localSourceTreeUris` and builds a file reference on-demand if
`item.request.file` is undefined.

### Tasks

- [ ] A1: Fix `rootPath` in `createLocalSourceFromPicker` to use `buildRootPath(rootName)`
- [ ] A2: Add lazy file resolution in `playItem` for local sources without file ref
- [ ] A3: Add unit tests for persistence correctness (rootPath, sourceId, treeUri)
- [ ] A4: Add unit test: hydration produces valid file ref when treeUri is available
- [ ] A5: Add unit test: playback router blob correctness matches scripts/ uploader
- [ ] A6: Add Playwright test: local file playback path does not throw unavailable error

## Part B — Android System UI Overlap

### Root Cause Analysis

`AppBar.tsx` header uses `fixed top-0` positioning without accounting for
`env(safe-area-inset-top)`. The CSS already has a `.pt-safe` utility class.

Fix: Add `padding-top: env(safe-area-inset-top)` to the AppBar header element.

### Tasks

- [ ] B1: Add safe-area top padding to AppBar header
- [ ] B2: Add/update Playwright test verifying top UI does not overlap status bar

## Part C — Indicator Icons UX

### Root Cause Analysis

`DiagnosticsActivityIndicator` always renders REST and FTP dots even at count 0.
Error dot is already conditionally hidden. Dots are `h-3.5 w-3.5` (~14px).

Fix: Conditionally render REST/FTP dots like error dot. Increase size ~40%.

### Tasks

- [ ] C1: Conditionally hide REST dot when restCount == 0
- [ ] C2: Conditionally hide FTP dot when ftpCount == 0
- [ ] C3: Increase indicator dot size by ~40% (h-3.5 -> h-5, w-3.5 -> w-5, text)
- [ ] C4: Update existing tests for new conditional visibility behavior

## Verification

- [ ] V1: `npm run test` green
- [ ] V2: `npm run lint` green
- [ ] V3: `npm run build` green
- [ ] V4: Full `./build` green

---

## Failure Log
_(entries added as issues are encountered and resolved)_
