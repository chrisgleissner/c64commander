# Refactoring Plan: Modularize Core Pages

## Objective
Modularize `HomePage.tsx`, `PlayFilesPage.tsx`, and `SettingsPage.tsx` to improve maintainability reliability, and testability without altering behavior.

## Phases

### Phase 1: HomePage
**Target File**: `src/pages/HomePage.tsx` (Logic moves to `src/pages/home/*`)

- [x] **Step 1: Constants Extraction**
  - Create `src/pages/home/constants.ts`
  - Move static command strings, configuration defaults, and magic numbers.
  - Verify: Build & Test
- [x] **Step 2: Utilities Extraction**
  - Create `src/pages/home/utils/`
  - Move pure helper functions (e.g., formatting, parsing).
  - Verify: Build & Test
- [x] **Step 3: Component Extraction**
  - Create `src/pages/home/components/`
  - Extract inline UI components (headers, action cards not yet separated).
  - Verify: Build & Test
- [x] **Step 4: Hooks Extraction**
  - Create `src/pages/home/hooks/`
  - Extract `useHomeState`, `use...` logic modules.
  - Verify: Build & Test
- [x] **Step 5: Dialogs Extraction**
  - Create `src/pages/home/dialogs/`
  - Extract Modal/Dialog components.
  - Verify: Build & Test
- [ ] **Step 6: Final Review**
  - Ensure main file < 600 lines.
  - Ensure no circular deps.
  - Verify: Full Test Suite

### Phase 2: PlayFilesPage
**Target File**: `src/pages/PlayFilesPage.tsx` (Logic moves to `src/pages/playFiles/*`)

- [ ] **Step 1: Constants Extraction**
  - Create `src/pages/playFiles/constants.ts`
  - Verify: Build & Test
- [ ] **Step 2: Utilities Extraction**
  - Create `src/pages/playFiles/utils/`
  - Verify: Build & Test
- [ ] **Step 3: Component Extraction**
  - Create `src/pages/playFiles/components/`
  - Verify: Build & Test
- [ ] **Step 4: Hooks Extraction**
  - Create `src/pages/playFiles/hooks/`
  - Verify: Build & Test
- [ ] **Step 5: Dialogs Extraction**
  - Create `src/pages/playFiles/dialogs/`
  - Verify: Build & Test
- [ ] **Step 6: Final Review**
  - Verify: Full Test Suite

### Phase 3: SettingsPage
**Target File**: `src/pages/SettingsPage.tsx` (Logic moves to `src/pages/settings/*`)

- [ ] **Step 1: Constants Extraction**
  - Create `src/pages/settings/constants.ts`
  - Verify: Build & Test
- [ ] **Step 2: Utilities Extraction**
  - Create `src/pages/settings/utils/`
  - Verify: Build & Test
- [ ] **Step 3: Component Extraction**
  - Create `src/pages/settings/components/`
  - Verify: Build & Test
- [ ] **Step 4: Hooks Extraction**
  - Create `src/pages/settings/hooks/`
  - Verify: Build & Test
- [ ] **Step 5: Dialogs Extraction**
  - Create `src/pages/settings/dialogs/`
  - Verify: Build & Test
- [ ] **Step 6: Final Review**
  - Verify: Full Test Suite

## Definition of Done
- No behavior changes.
- All tests pass (`npm run test`).
- Type check passes (`npm run build` / `tsc`).
- Files follow strict strict separation of concerns.

## Verification Commands
- `npm run typecheck` (if available) or `npx tsc --noEmit`
- `npm run test`

## Progress Log
