# Production-Ready PR: 11 Requirements + Tests

Status: In progress. No item may be checked off until implemented + tested + tests pass.

## PHASE 0 – UNBLOCK: MERGE CONFLICTS
- [x] Check git status
- [x] No conflicts found - proceed

## PHASE 1 – IMPLEMENTATION + TESTS

### (1) Playwright E2E evidence folder duplication

- [x] Audit current evidence generation code
- [x] Remove flat filenames with device prefix
- [x] Keep only canonical: device as subfolder under test id
- [x] Add regression guard: script/test that fails if both formats appear
- [x] Verify evidence upload artifact contains only canonical structure
- [x] Tests pass

### (2) C64U Demo logo color
- [ ] Change demo logo from orange to golden/bronze
- [ ] Verify contrast in light/dark themes
- [ ] Update snapshots/golden tests if present
- [ ] Tests pass

### (3) "View All" modal list fast browsing (Play + Disks)
#### (3a) Text filter
- [ ] Add input above scrollable list
- [ ] Implement instant case-insensitive substring match
- [ ] Works in inline list AND "View All"
- [ ] Add Playwright tests for filtering behavior
- [ ] Add Playwright tests for no layout overflow
- [ ] Tests pass

#### (3b) A–Z overlay control
- [ ] Create pure semi-transparent overlay (absolute/fixed, high z-index)
- [ ] Hidden/low-opacity by default
- [ ] Appears during scroll or right-edge touch
- [ ] Auto-hides after inactivity
- [ ] Touch maps vertical position to A–Z plus "#"
- [ ] Precompute first indices per letter
- [ ] Jump via virtual list scrollToIndex (no animation)
- [ ] Feedback: highlight letter + transient centered badge
- [ ] Add Playwright test: overlay does not change list width/scroll container metrics
- [ ] Add Playwright test: dragging selects correct letter and jumps
- [ ] Add Playwright test: overlay auto-hides
- [ ] Tests pass

### (4) C64U host resolution issues
#### (4a) Remove "C64U Hostname / IP" input
- [ ] Remove hostname input, Base URL only
- [ ] Tests pass

#### (4b) Fix regression: valid Base URL must connect
- [ ] Ensure http://192.168.1.13 connects and exits demo mode
- [ ] Tests pass

#### (4c) Demo mode must NEVER overwrite user Base URL
- [ ] UI: Base URL input always shows user value
- [ ] Show Demo Base URL below it, smaller, only visible in demo mode
- [ ] Remove "Default/Local Proxy" irrelevant values
- [ ] Add unit tests for config persistence (Base URL unchanged)
- [ ] Add E2E: switching to demo mode does not mutate Base URL
- [ ] Add E2E: reconnect works
- [ ] Tests pass

### (5) Disks / Disk list
#### (5a) Remove nonresponsive blue rectangle
- [ ] Remove blue rectangle left of disk name
- [ ] Tests pass

#### (5b) Context menu shows size and date
- [ ] Size must be populated everywhere: Disk list, Play list, View All
- [ ] Works for FTP and local
- [ ] Extend file browser data model to always include byte size
- [ ] Add unit tests for model mapping
- [ ] Add E2E for context menu showing non-empty size
- [ ] Tests pass

### (6) Demo mode configuration realism
- [ ] Demo config populated from doc/c64u-config.yaml
- [ ] Read at runtime from APK assets
- [ ] No hard-coded demo menu
- [ ] Add unit test for YAML parsing and menu generation
- [ ] Add E2E: demo mode shows expected sections from YAML
- [ ] Tests pass

### (7) Settings layout reorder
- [ ] Order groups: 1-Connection 2-Diagnostics 3-Appearance 4-Play and Disk 5-Config 6-Experimental (rename from Developer) 7-About
- [ ] Add E2E test asserting order and headings
- [ ] Tests pass

### (8) Home build information layout
- [ ] Display build timestamp as yyyy-mm-dd HH:mm
- [ ] Fix truncation: widen or reflow for small screens
- [ ] Add E2E visual/layout assertion
- [ ] Tests pass

### (9) Play page UX and behavior fixes
#### (9a) Mute/Unmute must work
- [ ] Clicking Unmute unmutes
- [ ] Dragging volume slider also unmutes
- [ ] Add unit tests for state machine
- [ ] Add E2E tests
- [ ] Tests pass

#### (9b) Remove Default duration description text
- [ ] Remove text
- [ ] Tests pass

#### (9c) Remove "Song picker enabled when subsongs are detected."
- [ ] Remove text
- [ ] Tests pass

#### (9d) File type filters as one-line checkbox row
- [ ] SID/MOD/PRG/CRT/DISK checkboxes
- [ ] Default all enabled
- [ ] Instant filtering
- [ ] Appears above inline playlist AND above View All list (non-scrollable header)
- [ ] Add E2E tests for filtering
- [ ] Tests pass

#### (9e) Recurse/Shuffle/Repeat side-by-side
- [ ] Layout Recurse/Shuffle/Repeat below Unmute+slider
- [ ] Reshuffle next to them
- [ ] Tests pass

#### (9f) "Played: mm:ss" prominent
- [ ] Right of progress bar
- [ ] Aligned with Default duration field
- [ ] Top-right near filename
- [ ] Updates in real time
- [ ] Tests pass

#### (9g) Remove "Playback controls" header
- [ ] Remove header
- [ ] Tests pass

#### (9h) Remove "Current duration" and its time
- [ ] Remove field
- [ ] Tests pass

#### (9i) Remove "SID options" header
- [ ] Remove header
- [ ] Add E2E tests for presence/absence and layout stability
- [ ] Tests pass

### (10) Songlengths.md5 discovery + display
#### (10a) On folder import, search for Songlengths.md5
- [ ] Upwards from selected folder (if possible) and downwards recursively
- [ ] Also check DOCUMENTS/Songlengths.md5
- [ ] Fix existing broken/unused code
- [ ] Ensure actually used
- [ ] Tests pass

#### (10b) Show discovered path on Play Files page
- [ ] Display path
- [ ] Clicking opens file picker to change it
- [ ] Tests pass

#### (10c) If Songlengths.md5 available
- [ ] Show SID song length as (m:ss) after filename in subtle gray
- [ ] Add unit tests for discovery and parsing
- [ ] Add E2E for UI
- [ ] Tests pass

### (11) Demo mode playback bugs
#### (11a) Stop must never autoresume after ~10s
- [ ] Fix autoresume bug
- [ ] Add unit test
- [ ] Add E2E test
- [ ] Tests pass

#### (11b) Fix sporadic rapid "Played" advancement
- [ ] Fix runaway song skipping
- [ ] Respect Default duration
- [ ] Add deterministic unit tests
- [ ] Add E2E tests
- [ ] Tests pass

## PHASE 2 – VERIFICATION AND FINALIZATION
- [ ] Run full local test suite: Web unit tests
- [ ] Run full local test suite: Playwright E2E
- [ ] Run full local test suite: Android unit tests
- [ ] Verify evidence artifact structure is canonical only
- [ ] Verify no UI overflow beyond device bounds (screenshots checks)
- [ ] Final commit hygiene: logical commits, no debug code, no TODOs
- [ ] Push branch and provide PR-ready summary

---

## PROGRESS LOG

### 2026-01-24 Initial setup
- Read PLANS.md
- Checked git status: clean, no conflicts
- Populated PLANS.md with full task breakdown

### 2026-01-24 Task 1: Evidence folder duplication
- Removed testInfo.attach() call to prevent duplication in Playwright's outputDir
- All evidence now in canonical structure: test-results/evidence/<testId>/<deviceId>/
- Added validation check in scripts/validate-playwright-evidence.mjs to fail if flat structure folders exist
- Cleaned up 174 old flat structure folders
- Verified test runs create only canonical structure
- Modified files:
  - playwright/testArtifacts.ts: removed testInfo.attach() call
  - scripts/validate-playwright-evidence.mjs: added flat structure detection
- Ran test: npm run test:e2e -- playwright/demoMode.spec.ts --grep "real connection shows green"
- Result: PASS, evidence created in canonical structure only
- npm run validate:evidence: PASS
- [ ] Add context menu flow to pick existing group or create inline
- [ ] Implement auto-grouping on scan for shared prefixes (case-insensitive, trailing nums/letters)
- [ ] Add unit tests for prefix grouping heuristics
- [ ] Add E2E coverage for group visibility + assignment + auto-grouping
