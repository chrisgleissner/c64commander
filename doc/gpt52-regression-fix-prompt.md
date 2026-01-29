# GPT-5.2 Codex - C64 Commander Regression Fix (Plan-driven, do not stop)

You are GPT-5.2 Codex running in an agentic environment with access to this repository's working tree and the ability to run commands/tests. Your task is to fully fix the issues described below in the Capacitor-based Android app C64 Commander, and to do it via a strict plan tracked in `plansMD` (a file in the repo root named exactly `plansMD`).

## Absolute rules (non-negotiable)
1. Create/overwrite `plansMD` first, before making code changes. The plan must be detailed and checkbox-driven.
2. After writing `plansMD`, immediately execute the plan step-by-step. Keep `plansMD` updated (tick items, add short notes, add root-cause links).
3. Do not stop until:
   - All issues below are fixed.
   - Local checks are green (lint, unit tests, typecheck, and any E2E/smoke tests that exist).
   - Android build and app runtime sanity checks pass (at minimum: emulator run + manual smoke script if present).
4. Be fail-fast:
   - No long waits/timeouts. If any command hangs or takes too long, cancel, diagnose, and proceed with an alternative.
   - Prefer short timeouts and iterative fixes.
5. No speculative changes: if you are not sure, investigate with logs, tracing, and `git` history. Write down root cause in `plansMD`.
6. Keep changes minimal but correct. Avoid large refactors unless unavoidable.
7. Ensure UI changes remain accessible: touch targets must be tappable, but use minimal horizontal space in row layouts.

---

## Context
This is a Capacitor-based Android app built with React + Vite + TypeScript. Recent changes (most recent commit `2d18df3` on 2026-01-29) introduced support for "automatic connection to a mock C64 started on the device itself if no real C64 is available" via the connection manager (`src/lib/connection/connectionManager.ts`) and mock server (`src/lib/mock/mockServer.ts`). Since then, several regressions appeared in:
- Playlist item layout (Play page: `src/pages/PlayFilesPage.tsx`)
- Disk list layout (Disks page: `src/pages/DisksPage.tsx` → `src/components/disks/HomeDiskManager.tsx`)
- Mounting disks sourced from the Android device
- Playing files sourced from a real C64 (HTTP 400 "playback failed")
- Filtering logic for disk list (directories left behind, duplicates created after filter/unfilter)

## Repository structure (key files)

### UI pages
- **Play page**: `src/pages/PlayFilesPage.tsx` (main playlist UI)
- **Disks page**: `src/pages/DisksPage.tsx` → `src/components/disks/HomeDiskManager.tsx` (disk manager)

### Core components
- **SelectableActionList**: `src/components/lists/SelectableActionList.tsx`
  - Used by both PlayFilesPage (playlist items) and HomeDiskManager (disk list items)
  - Row rendering: lines 76-200+ (ActionListRow component)
  - Current layout issues: lines 116-130 show "Actions" text label + full "PLAY" button
- **DiskTree**: `src/components/disks/DiskTree.tsx`
  - Renders disk tree with filtering
  - DiskRow component: lines 80-194
  - FolderNode component: lines 196-250+
  - Current filtering logic may mutate the tree model instead of using immutable source

### Playback and mounting
- **Playback router**: `src/lib/playback/playbackRouter.ts`
  - `executePlayPlan()` function: lines 84-200+
  - Handles SID/MOD/PRG/CRT/disk playback
  - Likely regression in host selection for ultimate source playback (line 100: `await api.playSid(plan.path, plan.songNr)`)
- **Disk mount**: `src/lib/disks/diskMount.ts`
  - `mountDiskToDrive()` function: lines 37-64
  - Handles mounting from ultimate or local sources
  - Logs include baseUrl, deviceHost, endpoint (lines 53-61)
  - Likely regression in host selection for local disk mounting

### API client and connection
- **C64 API client**: `src/lib/c64api.ts`
  - Core REST client
  - `getBaseUrl()`, `getDeviceHost()` methods
  - Recent changes around line 1-100 for host/baseUrl handling
  - Default values: `DEFAULT_BASE_URL = 'http://c64u'`, `DEFAULT_DEVICE_HOST = 'c64u'`
- **Connection manager**: `src/lib/connection/connectionManager.ts`
  - Handles discovery and demo mode fallback
  - `probeOnce()`: lines 79-100+
  - Mock server integration: line 10 (`startMockServer`, `getActiveMockBaseUrl`)
- **Mock server**: `src/lib/mock/mockServer.ts`
  - Provides mock C64 API for offline/demo mode
  - Check if this is being incorrectly used when real device is available

### Disk filtering
- **Disk tree state**: Search for `DiskTreeState` type and filtering implementation
- **Disk tree component**: `src/components/disks/DiskTree.tsx` lines 196-250+
  - Filtering appears to iterate and render nodes directly
  - Root cause: likely mutates the original tree instead of deriving a filtered view
  - Look for tree construction/filtering in disk library hook or tree utility

### Build and test
- **Build script**: `npm run build` (Vite)
- **Lint**: `npm run lint`
- **Unit tests**: `npm run test` (Vitest)
- **E2E tests**: `npm run test:e2e` (Playwright in `playwright/` directory)
- **Android build**: `npm run cap:build` then `./local-build.sh --install`
- **Smoke tests**: `.maestro/` directory (Maestro flows)

---

## Issues to fix (functional + UX)

### 1) Playlist layout regression (Play page)
**File**: `src/pages/PlayFilesPage.tsx` → `src/components/lists/SelectableActionList.tsx`

**Current rendering** (lines 116-130 in SelectableActionList.tsx):
- Three-dots menu button shows icon AND "Actions" text label (line 128: `<span className="ml-1">Actions</span>`)
- Play action is a full button with "PLAY" text (lines 191-200)
- Per-item context menu includes "Remove from playlist" (lines 477-482 in PlayFilesPage.tsx)
- Row is cramped: checkbox + actions button + icon + text + play button takes too much horizontal space

**Expected rendering**:
Previously each playlist item showed (left-to-right, single line):
- Checkbox
- Three dots menu icon (no "Actions" text)
- Source icon (phone for device, C64 icon for C64)
- File name with duration appended (mm:ss)
- Small play icon (not a full "PLAY" button)

**Required changes**:
1. Remove "Actions" text label from three-dots button (line 128 in SelectableActionList.tsx)
2. Replace full "PLAY" button with a small play icon button (lines 191-200)
3. Remove "Remove from playlist" menu item from per-item context menu (only use "Remove selected items" bulk action)
4. Ensure single-line layout with minimal chrome:
   - Checkbox + context menu icon + source icon: minimal width, easy to tap
   - File name + duration: priority width (truncate gracefully only when necessary)
   - Play icon: far right, minimal width, easy to tap

**Acceptance criteria**:
- Playlist items render on a single line
- No "Actions" text visible on three-dots button
- Play control is a small icon (not a full "PLAY" button)
- Per-item context menu does NOT show "Remove item" or "Remove from playlist"
- Touch targets remain tappable (minimum 44x44 density-independent pixels on Android)

### 2) Disk list layout regression (Disks page)
**File**: `src/pages/DisksPage.tsx` → `src/components/disks/HomeDiskManager.tsx` → `src/components/disks/DiskTree.tsx`

**Current rendering** (lines 108-194 in DiskTree.tsx):
- DiskRow component uses similar cramped layout as playlist items
- Three-dots menu button shows icon AND text (if SelectableActionList pattern was applied)
- Mount button is full-size

**Expected rendering**:
Disk list rows should follow the same compact layout as playlist items:
- Checkbox + three-dots icon (no text) + location icon + disk name/path + small action icons

**Required changes**:
1. Apply same layout improvements as playlist items to DiskRow component
2. Ensure consistent styling between playlist and disk list

**Acceptance criteria**:
- Disk list items render compactly with minimal chrome
- Consistent with playlist item layout
- Touch targets remain tappable

### 3) Playback from real C64 regressed: "Playback failed, HTTP 400"
**File**: `src/lib/playback/playbackRouter.ts`, `src/lib/c64api.ts`

**Symptom**:
Clicking play on a file sourced from a real C64 shows: "Playback failed, HTTP 400".
This used to work ~4 days ago. Device reset still works, so REST calls generally work, but playback is broken.

**Strong suspicion**:
Recent changes around connection manager and mock server integration (commits around `4008fa9`, `a6f24c9`, `6e2caf3`, `d78b19d`) may have introduced a regression where:
1. The app sends play requests to the wrong host (mock host instead of real device)
2. Request payload/path/headers are incorrect
3. BaseUrl or deviceHost resolution is broken for playback specifically

**Investigation steps**:
1. Check git history for changes to `src/lib/c64api.ts` in last 7 days
2. Compare `executePlayPlan()` in `playbackRouter.ts` lines 84-200 with previous working version
3. Instrument `api.playSid()` call (line 100 in playbackRouter.ts) to log:
   - `api.getBaseUrl()`
   - `api.getDeviceHost()`
   - Request URL and headers
4. Check if mock server is incorrectly activated when real device is connected
5. Review connection manager state when play is triggered

**Root cause (to be determined)**:
Document in `plansMD` after investigation:
- Which commit introduced the regression
- Exact code change that broke playback
- Whether baseUrl/deviceHost/request formatting changed

**Required fix**:
1. Ensure correct host is selected when real device is available and configured
2. Restore request formatting to match working version
3. Add test coverage to prevent regression

**Acceptance criteria**:
- Playing a file sourced from the real C64 works again
- Device reset continues to work
- Logs confirm correct baseUrl/deviceHost are used for playback

### 4) Mounting a disk sourced from the Android device fails: "Mount failed, host unreachable"
**File**: `src/lib/disks/diskMount.ts`, `src/lib/c64api.ts`

**Symptom**:
When mounting a disk that was sourced from the Android device (local source), it fails with "host unreachable", suggesting it is trying to connect to the wrong host (e.g., mock host when real should be used, or a stale host selection).

**Investigation steps**:
1. Check `mountDiskToDrive()` function in `diskMount.ts` lines 37-64
2. Review error logs (lines 53-61) to see what baseUrl/deviceHost are being used
3. Compare with playback regression investigation (likely same root cause)
4. Check if `api.mountDriveUpload()` is using correct host for local disk mounting

**Root cause (to be determined)**:
Document in `plansMD` after investigation (may be same as issue #3)

**Required fix**:
1. Ensure correct host is selected for local disk mounting operations
2. Ensure `mountDriveUpload()` uses real device endpoint when available
3. Add test coverage

**Acceptance criteria**:
- Mounting a disk sourced from Android device works again
- Logs confirm correct baseUrl/deviceHost are used
- Error handling provides clear messages if real device is not available

### 5) Disk filter logic is corrupting the list (directories left behind + duplication)
**File**: `src/components/disks/DiskTree.tsx`, disk tree state management

**Symptom**:
When filtering disks:
1. Correctly hides non-matching files
2. **Incorrectly** leaves directory entries even when the directory becomes empty after filtering
3. After removing the filter, directory entries are duplicated (e.g., "/" repeats 3x, then 6x, etc.)

This indicates filtering is **mutating the underlying list/tree model** rather than using an immutable source and deriving a filtered view.

**Investigation steps**:
1. Find where disk tree state is constructed (search for `DiskTreeState` type definition)
2. Locate filtering implementation in DiskTree component or tree utility
3. Check if filtering modifies the original tree nodes array directly
4. Identify where directory nodes are added/removed during filter operations

**Root cause (to be determined)**:
Document in `plansMD` after investigation:
- Where tree mutation happens
- Why directories are duplicated on filter removal
- Whether tree is rebuilt from scratch each time or incrementally modified

**Required fix**:
1. Refactor filtering to use immutable source model:
   - Preserve original tree/list structure in state
   - Compute filtered view from original on each render
   - Never mutate original tree nodes
2. Filter implementation:
   - Directories are included only if they contain at least one visible descendant after filtering
   - Clearing the filter restores the exact original structure
   - Repeated filter/unfilter cycles are idempotent: no growth, no duplication
3. Add unit or component tests for filtering logic:
   - Filter removes empty directories
   - Clearing filter restores original structure
   - Repeating filter/unfilter does not change counts
   - Root "/" does not duplicate

**Acceptance criteria**:
- Filtering hides non-matching files and empty directories
- Clearing filter restores original tree structure exactly
- Repeated filter/unfilter cycles produce identical results
- No directory duplication ever occurs
- Tests cover filter idempotence and directory pruning

---

## Execution approach (you must do this)

### A) Planning in `plansMD`
Create a detailed plan with phases, each with checkboxes:

```markdown
# C64 Commander Regression Fix Plan

## Phase 0: Repo orientation + locate relevant components
- [ ] Verify repo structure matches documented paths
- [ ] Locate SelectableActionList component
- [ ] Locate PlayFilesPage playlist rendering
- [ ] Locate HomeDiskManager and DiskTree components
- [ ] Locate playbackRouter.ts and diskMount.ts
- [ ] Locate c64api.ts and connectionManager.ts
- [ ] Locate disk tree filtering logic
- [ ] Identify test files for each component

## Phase 1: Reproduce all issues
- [ ] Issue #1: Verify playlist layout regression (Actions text, PLAY button, Remove item menu)
- [ ] Issue #2: Verify disk list layout regression
- [ ] Issue #3: Verify playback from real C64 fails with HTTP 400 (if test env available)
- [ ] Issue #4: Verify mounting disk from Android device fails (if test env available)
- [ ] Issue #5: Reproduce disk filter duplication bug
  - [ ] Filter disk list to hide some files
  - [ ] Verify empty directories remain visible (BUG)
  - [ ] Clear filter
  - [ ] Verify directory duplication (BUG)
  - [ ] Repeat filter/unfilter cycle
  - [ ] Count directory entries (should not grow)

## Phase 2: Root-cause investigation
- [ ] Issue #1: Review SelectableActionList.tsx lines 116-130, 191-200
  - [ ] Document current rendering
  - [ ] Document expected rendering
- [ ] Issue #2: Review DiskTree.tsx DiskRow component
  - [ ] Compare with SelectableActionList pattern
- [ ] Issue #3: Investigate playback regression
  - [ ] Check git history for c64api.ts changes in last 7 days
  - [ ] Check git history for playbackRouter.ts changes
  - [ ] Check git history for connectionManager.ts changes
  - [ ] Identify commit that introduced mock server integration
  - [ ] Compare executePlayPlan() with previous working version
  - [ ] Instrument api.playSid() to log baseUrl/deviceHost
  - [ ] Root cause: [DOCUMENT EXACT CAUSE HERE]
- [ ] Issue #4: Investigate disk mounting regression
  - [ ] Check mountDiskToDrive() implementation
  - [ ] Check if same root cause as issue #3
  - [ ] Root cause: [DOCUMENT EXACT CAUSE HERE]
- [ ] Issue #5: Investigate disk filter logic
  - [ ] Find DiskTreeState type definition
  - [ ] Locate tree construction code
  - [ ] Locate filtering implementation
  - [ ] Identify where tree mutation occurs
  - [ ] Root cause: [DOCUMENT EXACT CAUSE HERE]

## Phase 3: Implement fixes
- [ ] Issue #1: Fix playlist layout
  - [ ] Remove "Actions" text from three-dots button (SelectableActionList.tsx line 128)
  - [ ] Replace PLAY button with small play icon (lines 191-200)
  - [ ] Remove "Remove from playlist" from per-item menu (PlayFilesPage.tsx lines 477-482)
  - [ ] Verify single-line layout with minimal chrome
  - [ ] Verify touch targets remain tappable
- [ ] Issue #2: Fix disk list layout
  - [ ] Apply same layout improvements to DiskRow component
  - [ ] Ensure consistency with playlist items
- [ ] Issue #3: Fix playback from real C64
  - [ ] Apply fix based on root cause analysis
  - [ ] Ensure correct host selection for ultimate source
  - [ ] Restore working request format
- [ ] Issue #4: Fix disk mounting from Android device
  - [ ] Apply fix based on root cause analysis
  - [ ] Ensure correct host selection for local disk mounting
- [ ] Issue #5: Fix disk filter logic
  - [ ] Refactor to use immutable source model
  - [ ] Implement filtered view derivation (do not mutate original)
  - [ ] Implement directory pruning (hide empty dirs after filtering)
  - [ ] Implement filter clearing (restore exact original structure)
  - [ ] Ensure idempotence (repeated filter/unfilter produces same result)

## Phase 4: Tests and regression coverage
- [ ] Issue #1: Add or update SelectableActionList tests
- [ ] Issue #2: Add or update DiskTree tests
- [ ] Issue #3: Add playback host selection test
- [ ] Issue #4: Add disk mounting host selection test
- [ ] Issue #5: Add disk filter idempotence tests
  - [ ] Test: Filter removes empty directories
  - [ ] Test: Clearing filter restores original structure
  - [ ] Test: Repeating filter/unfilter does not change counts
  - [ ] Test: Root "/" does not duplicate
- [ ] Run unit tests: `npm run test`
- [ ] Run lint: `npm run lint`
- [ ] Run typecheck: `npx tsc --noEmit`
- [ ] Fix any test failures or lint errors

## Phase 5: Final verification
- [ ] Run full build: `npm run build`
- [ ] Run E2E tests (if applicable): `npm run test:e2e`
- [ ] Android build (if applicable): `npm run cap:build`
- [ ] Verify all 5 issues are resolved
- [ ] Document final summary in plansMD

## Summary
[After completion, document here:]
- Issue #1 root cause: [...]
- Issue #2 root cause: [...]
- Issue #3 root cause: [...]
- Issue #4 root cause: [...]
- Issue #5 root cause: [...]
- Changes made: [...]
- Tests added: [...]
- Verification: [...]
```

### B) Use `git` to find the regression
Because the playback broke "about four days ago" (based on original prompt context), do not guess. Use:
- `git --no-pager log --since="7 days ago" --oneline`
- Check commits around `4008fa9`, `a6f24c9`, `6e2caf3`, `d78b19d` (identified in research)
- `git --no-pager show <commit>` to see exact changes
- `git bisect` (if necessary) to locate the offending commit quickly
- Compare request payload/URL host selection between good and bad commits

### C) Debug host selection rigorously
Instrument (temporarily if needed) the host resolution path used by:
- Play from C64 item (`api.playSid()` in playbackRouter.ts line 100)
- Mount disk (`api.mountDriveUpload()` in diskMount.ts line 52)

Ensure the chosen base URL/host is correct and consistent with the Home page reset behavior that still works.

### D) Fix filtering with immutable source model
Refactor filtering so that:
- Original list/tree is preserved (immutable or deep-copied snapshot)
- Filtered view is computed from the snapshot on each render
- Directories are included only if they contain at least one visible descendant after filtering
- Clearing the filter restores the exact snapshot view

Add tests that:
- Filter removes empty directories
- Clearing filter restores original structure
- Repeating filter/unfilter does not change counts
- Root "/" does not duplicate

### E) UI layout changes (playlist + disk list)
Ensure:
- No "Actions" text label on three-dots button
- Small icons for play/mount actions (not full buttons)
- Text (filename/disk name) takes priority width
- Touch targets remain adequate (44x44 dp minimum on Android)
- Consistent styling between playlist and disk list (they both use SelectableActionList or similar pattern)

---

## Deliverables (required)
1. **Updated `plansMD`** with all items checked, plus short notes and root-cause explanations.
2. **Code changes** implementing all fixes.
3. **Tests** added/updated to cover:
   - Filter idempotence and directory pruning
   - Host selection for playback and mounting (if feasible)
   - UI layout regressions (snapshot tests or component tests)
4. **Final short summary** in `plansMD`:
   - What was broken (root cause per issue)
   - What changed
   - How you verified it

---

## Important notes

### File paths (verified in research)
All paths are relative to repo root `/home/chris/dev/c64/c64commander.worktrees/copilot-worktree-2026-01-29T12-28-22`:
- `src/pages/PlayFilesPage.tsx`: Playlist UI (3157 lines)
- `src/pages/DisksPage.tsx`: Disks page wrapper (21 lines)
- `src/components/lists/SelectableActionList.tsx`: Shared list component
- `src/components/disks/HomeDiskManager.tsx`: Disk manager UI
- `src/components/disks/DiskTree.tsx`: Disk tree rendering with filtering
- `src/lib/playback/playbackRouter.ts`: Play execution
- `src/lib/disks/diskMount.ts`: Disk mounting
- `src/lib/c64api.ts`: REST API client
- `src/lib/connection/connectionManager.ts`: Connection and discovery
- `src/lib/mock/mockServer.ts`: Mock C64 API

### Recent commits (last 7 days)
- `2d18df3` (2026-01-29): "feat: add secondary action support to selectable action list" — MOST RECENT, likely introduced layout regression
- `a1abef5` (2026-01-29): "feat: enhance HVSC download settings"
- `4008fa9`: "feat(android-emulator): add smoke tests for connection and navigation"
- `a6f24c9`: "feat: add smoke test functionality for Android emulator"
- `6e2caf3`: "feat: enhance audio mixer functionality"
- `d78b19d`: "refactor: migrate legacy base URL handling to device host storage" — likely related to playback/mount regressions

### Build and test commands
- `npm run build`: Full Vite build
- `npm run lint`: ESLint
- `npm run test`: Vitest unit tests
- `npm run test:e2e`: Playwright E2E tests
- `npx tsc --noEmit`: TypeScript type check
- `npm run cap:build`: Build Capacitor Android assets
- `./local-build.sh --install`: Build and install Android APK to emulator

### Test locations
- Unit tests: `tests/unit/` and colocated `*.test.ts` files
- E2E tests: `playwright/`
- Smoke tests: `.maestro/`

### Do not skip or comment out failing tests
Fix root causes. If a test is unrelated to your changes and was already failing, document it but do not let it block your work.

---

Now begin: create `plansMD` at the repo root, then execute it step-by-step until everything is complete and green.
