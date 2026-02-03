# Codebase Concerns

**Analysis Date:** 2026-02-02

## Tech Debt

**Lax Type Safety:**
- Issue: TypeScript strictness is explicitly disabled (`noImplicitAny: false`, `strictNullChecks: false`, `noUnusedLocals: false`).
- Files: `tsconfig.json`, `eslint.config.js`
- Impact: "Any" types are widespread (e.g., `src/components/ConfigItemRow.tsx`), hiding potential runtime errors and null pointer exceptions.
- Fix approach: Enable `strict: true` incrementally.

**Monolithic Components:**
- Issue: `PlayFilesPage.tsx` is over 3,200 lines long. `SettingsPage.tsx` is 1,600+ lines.
- Files: `src/pages/PlayFilesPage.tsx`, `src/pages/SettingsPage.tsx`, `src/components/disks/HomeDiskManager.tsx`
- Impact: extremely difficult to read, maintain, or refactor. Violates Single Responsibility Principle.
- Fix approach: Extract sub-components (e.g., `Playlist`, `FileBrowser`, `TransportControls`) and custom hooks.

**Test Coverage Gaps (UI):**
- Issue: While `c64api` has unit tests, complex UI pages like `PlayFilesPage` have placeholder unit tests (`expect(true).toBe(true)`).
- Files: `tests/unit/pages/PlayFilesPage.test.tsx`
- Impact: UI logic relies entirely on E2E tests (`playwright/`), making feedback loops slower and edge cases harder to test.
- Fix approach: Write real component tests using React Testing Library.

**Implicit Dependencies:**
- Issue: `axios` and `basic-ftp` are in `devDependencies` but appearing to be used in production code paths or types.
- Files: `package.json`
- Impact: Potential runtime crashes in production builds if these are actually needed.
- Fix approach: Audit dependencies; move required libs to `dependencies` or remove if unused.

## Known Bugs

**Potential Race Conditions:**
- Description: Comments indicate potential race conditions in API handling.
- Files: `src/lib/c64api.ts`
- Trigger: Rapid concurrent requests (e.g., playback control).
- Workaround: None explicit.

## Security Considerations

**Strict Null Checks Disabled:**
- Risk: High probability of "Cannot read property of undefined" crashes.
- Files: Entire codebase (`tsconfig.json`)
- Current mitigation: E2E tests catch happy paths, but edge cases may crash app.
- Recommendations: Enable `strictNullChecks`.

**Type Assertions (as any):**
- Risk: Bypassing type checker hides security flaws or data structure mismatches.
- Files: `src/components/ConfigItemRow.tsx`, `src/hooks/useAppConfigState.ts`
- Current mitigation: None.
- Recommendations: Define proper interfaces for Config payloads.

## Performance Bottlenecks

**Large Component Re-renders:**
- Problem: `PlayFilesPage` being monolithic likely re-renders excessively on small state changes.
- Files: `src/pages/PlayFilesPage.tsx`
- Cause: Single state tree for a massive component.
- Improvement path: Component composition and memoization.

## Fragile Areas

**Disk Management:**
- Files: `src/components/disks/HomeDiskManager.tsx`
- Why fragile: High complexity (1200+ lines), managing filesystem and remote device state simultaneously.
- Safe modification: Rely heavily on E2E tests in `playwright/`.

**UI State Logic:**
- Files: `src/pages/PlayFilesPage.tsx`
- Why fragile: Complex state interactions (playback, playlist, file browsing) all in one file with no unit tests.
- Safe modification: Must run full E2E suite after any change.

---

*Concerns audit: 2026-02-02*
