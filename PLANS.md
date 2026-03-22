# Deep Dive Audit — Execution Plan

**Started:** 2026-03-22
**Target output:** `doc/research/review-11/findings.md`

## Phase 0 — Setup and Discovery

- [x] Scan existing research docs (review-1 through review-10) for numbering and style
- [x] Catalog all screenshot PNGs (173 files across 8 top-level folders)
- [ ] Validate Pixel 4 ADB connectivity
- [ ] Validate hostname `c64u` resolution; fallback to IP 192.168.1.167 if needed
- [ ] Create temporary directory for scaled screenshots (`tmp/llm-image-scaling/`)
- [ ] Preprocess oversized screenshots into scaled copies

## Phase 1 — Repository and Feature Scan

- [ ] Read `doc/ux-guidelines.md`, `doc/ux-interactions.md`, `doc/architecture.md`
- [ ] Read `doc/features-by-page.md` fully
- [ ] Scan all page components: HomePage, PlayFilesPage, DisksPage, ConfigBrowserPage, SettingsPage, DocsPage
- [ ] Review HVSC module: `src/lib/hvsc/`, `src/pages/playFiles/hooks/useHvscLibrary.ts`
- [ ] Review connection management: `src/lib/connection/`, hostname resolution
- [ ] Review native bridges: `src/lib/native/`, `src/lib/hvsc/native/`
- [ ] Review Android-specific code: `android/app/src/main/java/com/c64/commander/hvsc/`
- [ ] Catalog all hooks in `src/hooks/`

## Phase 2 — ADB Device Validation and HVSC Flow

- [ ] Verify Pixel 4 is connected and app is installed
- [ ] Configure C64U hostname/IP in the app on device
- [ ] Test connectivity to C64U from the app
- [ ] Execute HVSC download on device
- [ ] Execute HVSC ingestion on device
- [ ] Navigate HVSC library
- [ ] Play a SID file from HVSC
- [ ] Document timing, errors, and UI states at each step

## Phase 3 — Screenshot Analysis

- [ ] Scale all oversized screenshots to <2000px max dimension
- [ ] Analyze home page screenshots for UX consistency
- [ ] Analyze play page screenshots
- [ ] Analyze config page screenshots
- [ ] Analyze disks page screenshots
- [ ] Analyze settings page screenshots
- [ ] Analyze diagnostics page screenshots
- [ ] Analyze docs page screenshots
- [ ] Analyze display profile variations (compact/medium/expanded)
- [ ] Cross-reference with UX guidelines

## Phase 4 — Cross-Platform and Code Analysis

- [ ] Identify platform-specific code paths (Android vs iOS vs Web)
- [ ] Review iOS native plugin implementations for feature parity
- [ ] Review Web platform differences
- [ ] Identify feature gaps across platforms

## Phase 5 — Performance Audit

- [ ] Inspect code for blocking operations
- [ ] Review HVSC ingestion pipeline performance characteristics
- [ ] Review rendering patterns for large lists
- [ ] Review network call patterns and caching
- [ ] Check for unnecessary re-renders

## Phase 6 — Documentation Audit

- [ ] Review README.md accuracy
- [ ] Review in-app docs page content
- [ ] Review API documentation
- [ ] Review developer documentation
- [ ] Identify missing troubleshooting guidance

## Phase 7 — Edge Cases and Failure Modes

- [ ] Review error handling in connection management
- [ ] Review network failure handling
- [ ] Review HVSC partial download/interruption handling
- [ ] Review empty state handling across pages
- [ ] Review rapid navigation patterns

## Phase 8 — Research Document Production

- [ ] Create `doc/research/review-11/findings.md`
- [ ] Write all sections per the mandatory document structure
- [ ] Include consolidated issue list with IDs
- [ ] Include phased execution plan
- [ ] Include cross-platform gap matrix
