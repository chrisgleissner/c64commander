# Documentation Audit Report

Audit date: 2026-03-23

## Scope

- `README.md` (root)
- All top-level files in `doc/`: `index.md`, `developer.md`, `architecture.md`, `features-by-page.md`, `code-coverage.md`, `db.md`, `ux-guidelines.md`, `ux-interactions.md`

Subdirectories under `doc/` (e.g., `doc/c64/`, `doc/testing/`, `doc/diagnostics/`) were out of scope.

## Fixed Issues

### Broken links / image references

| File        | Issue                                                                                   | Fix                                                                                                                               |
| ----------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `README.md` | Diagnostics activity screenshot reference pointed at an outdated problems-only filename | Updated reference to the current canonical problems-only screenshot under `doc/img/app/diagnostics/activity/07-problems-only.png` |

### Incorrect content

| File                     | Issue                                                                                                                    | Fix                          |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ---------------------------- |
| `doc/ux-interactions.md` | Developer mode activation listed as "Secret Tap (5x)" but source code (`src/pages/SettingsPage.tsx:465`) requires 7 taps | Changed to "Secret Tap (7x)" |

### README.md rewrite

The README was rewritten for clarity, correctness, and conciseness:

- Removed emoji prefixes from all section headings
- Removed marketing language ("Your C64 Ultimate command center in your pocket", "Because it gives you full control")
- Removed manual table of contents (GitHub renders one automatically)
- Removed the "active development" note callout
- Removed the iOS CI runtime detail ("CI runtime selection validates iOS 26 -> 18 -> 17") which is internal CI behavior, not user-facing
- Consolidated "Why C64 Commander?" into a concise "Features" list
- Renamed "What You Can Do" to "Pages" for directness
- Tightened page descriptions to one-line summaries
- Consolidated "Web Server Details" subheadings into cleaner structure ("Authentication", "Security settings", "Logging", "Updating")
- Removed redundant `basic-ftp` runtime dependency note from "For Developers" (already covered in "Logging")
- Shortened acknowledgments prose
- Removed celebration emoji from first connection completion

## Validated (No Changes Needed)

### doc/index.md

All 16 referenced files verified to exist. Structure is clean and accurate.

### doc/developer.md

- Prerequisites: Node.js 24 matches `.nvmrc`; JDK 17 is correct for Android builds
- `.prettierrc.json` description (`printWidth: 120`, YAML `tabWidth: 2` override) matches actual config
- `./build` script flags verified against the actual script
- Maestro flow files (`smoke-launch.yaml`, `smoke-file-picker.yaml`, `smoke-playback.yaml`) confirmed to exist in `.maestro/`
- Subflow files (`launch-and-wait.yaml`, `common-navigation.yaml`) confirmed in `.maestro/subflows/`
- Mock server path (`tests/mocks/mockC64Server.ts`) confirmed
- FTP fixtures path (`playwright/fixtures/ftp-root/`) confirmed
- Developer mode activation (7 taps) matches code
- Project structure listing matches actual `src/` layout
- All Mermaid diagrams reference correct module paths

### doc/architecture.md

- Runtime stack versions (React 18, Router 6, Vite 5, Capacitor 6) match `package.json`
- Native path `android/app/src/main/java/uk/gleissner/c64commander/` confirmed
- All domain module paths (`src/lib/c64api.ts`, `src/lib/playback/`, `src/lib/hvsc/`, `src/lib/sourceNavigation/`, etc.) confirmed
- Display profile resolution description matches `src/lib/displayProfiles.ts`
- Mermaid data flow and sequence diagrams are internally consistent

### doc/features-by-page.md

- Page inventory (routes, components) matches `src/pages/*.tsx` and `src/lib/navigation/tabRoutes.ts`
- Tab order (Home, Play, Disks, Config, Settings, Docs) matches code
- Coverage Probe and Not Found routes confirmed in code
- No broken links

### doc/code-coverage.md

- Coverage tools (Vitest V8, JaCoCo, Playwright NYC) match CI workflow
- 91% threshold matches `scripts/check-coverage-threshold.mjs`
- Codecov flags (web, android, python, swift) match CI upload steps
- File paths for coverage outputs are correct

### doc/db.md

- Schema is explicitly documented as target state (not current runtime)
- Reference to `../PLANS.md` verified: file exists
- SID terminology (file/track/song) is consistent with `doc/architecture.md` and `doc/ux-guidelines.md`

### doc/ux-guidelines.md

- Source model (Local, C64U, HVSC) matches code and UI
- Component names (SelectableActionList, ItemSelectionDialog, QuickActionCard) match `src/components/`
- Page structure descriptions match actual page implementations
- Terminology is internally consistent

### doc/ux-interactions.md

- CTA inventory references correct Playwright spec files
- Test coverage status classifications are plausible (not exhaustively re-verified)
- All referenced spec file names exist in `playwright/`

## Validated Image References

All 39 image references in README.md were verified against the filesystem. 38 existed; 1 was broken and fixed (see above).

## Out-of-Scope Observations

These are not documentation bugs but are noted for awareness:

- `CLAUDE.md` (project agent instructions) claims `.prettierrc.json` sets `singleQuote: true`. The actual `.prettierrc.json` does not contain `singleQuote`. Prettier's default (`false`, double quotes) applies. This is consistent with the source code which uses double quotes.
- `CLAUDE.md` references Android native code at `android/app/src/main/java/com/c64/commander/hvsc/`. The actual path is `android/app/src/main/java/uk/gleissner/c64commander/`. This is an agent instruction file, not user-facing documentation.
- `package.json` version (`0.6.4-rc7`) differs from `src/version.ts` (`0.6.4-rc8-60266`). This is expected behavior: `version.ts` is auto-generated during builds.

## Assumptions

- HTML tables in README.md are intentional for multi-column screenshot grids. The MD033 linter warnings for inline HTML are accepted.
- The `features-by-page.md` file (47.7K) was spot-checked rather than exhaustively line-audited; its structure and sample entries are accurate.
- Test coverage percentages in `ux-interactions.md` section 9 were not re-counted against the individual CTA tables; they are approximate.
