# Release Pipeline, Telemetry, and Bottom-Sheet Plan

Status: IN_PROGRESS
Classification: DOC_PLUS_CODE, CODE_CHANGE, UI_CHANGE
Date: 2026-03-22

## Objective

Resolve three linked release-quality issues without regressions:

- Git tag propagation must be deterministic from GitHub release tag to runtime UI and native version metadata.
- iOS telemetry gating must distinguish real app disappearance from simulator-monitor false positives and fail deterministically.
- All bottom sheets must reserve the same bottom clearance contract as the main navigation baseline across Android, iOS, and Web.

## Phase 1 - Repository and Pipeline Analysis

Findings recorded from the current repository state:

- Source of truth is currently fragmented.
  - `src/lib/buildVersion.ts` already resolves build version from explicit env, then GitHub tag context, then `package.json`.
  - `vite.config.ts` injects `__APP_VERSION__`, but `deriveVersionLabel()` can still surface `git describe` output rather than the exact injected release tag.
  - `web.yaml` strips a leading `v` from `GITHUB_REF_NAME`, while iOS and Android do not. This creates cross-platform inconsistency for tags created in GitHub UI.
  - Local build paths and Android Gradle still fall back to `package.json` or `git describe`, which permits stale-version leakage when CI injection is missing or partial.

- Native injection is not yet enforced as a single invariant.
  - Android resolves `versionName` from env, then `GITHUB_REF_NAME`, then exact git tag, then `package.json`.
  - iOS passes `MARKETING_VERSION` and `CURRENT_PROJECT_VERSION` at build time, but the version resolution logic is duplicated in multiple workflow jobs.
  - No shared guard currently proves `injected version == exact release tag` for release builds.

- Homepage version display reads `buildInfo.versionLabel`, not raw `appVersion`.
  - This permits display drift if label derivation prefers `git describe` or fallback formatting over the exact injected tag.

- iOS telemetry monitor already uses lifecycle flag files.
  - `ci/telemetry/ios/monitor_ios.sh` sets exit code `3` for confirmed disappearance during active flow.
  - Exit code `4` is already treated as reduced-reliability infra behavior when `simctl` is unavailable.
  - Workflow lifecycle signaling currently wraps the entire grouped Maestro run, which may be too broad if app teardown/relaunch happens between flows inside a still-active group.

- Bottom sheets currently reserve only raw safe-area inset.
  - Main page content clears the fixed tab bar with `calc(5rem + env(safe-area-inset-bottom))` in `src/index.css`.
  - The shared bottom-sheet primitive in `src/components/ui/app-surface.tsx` only applies `env(safe-area-inset-bottom)` in sheet footers and no shared body/end-cap contract.
  - Several sheet bodies also add their own bottom padding, so the global fix must be centralized and then audited to avoid double-padding regressions.

Acceptance criteria for Phase 1:

- Impact map is complete for web, Android, iOS, homepage runtime UI, telemetry gate, and shared sheet primitives.
- Root-cause hypotheses are explicit before code changes start.

## Phase 2 - Fix Tag Propagation

Implementation targets:

- Create or refine a single shared version-resolution utility for build/runtime use.
- Make workflows resolve a single canonical build version from tag context using `GITHUB_REF_TYPE`, `GITHUB_REF_NAME`, and `GITHUB_REF`.
- Ensure web, Android, iOS, and homepage runtime all consume the same canonical version.
- Remove release-path fallback behavior that can surface stale `package.json` values on tagged builds.
- Add explicit CI/build guards so tagged builds fail if the injected version diverges from the release tag.

Acceptance criteria:

- Tag `0.6.4-rc6` displays exactly `0.6.4-rc6` in the homepage UI.
- Tagged builds cannot silently reuse the previous tag.
- Android `versionName`, iOS `CFBundleShortVersionString`, web runtime version, and homepage display all match.

## Phase 3 - Fix iOS Telemetry Gate

Implementation targets:

- Tighten monitor classification so active-flow disappearance is only reported when it occurs inside the real flow window that should be crash-free.
- Narrow the lifecycle window in workflow orchestration if grouped Maestro execution leaves false-positive gaps between flows.
- Add structured classification coverage for stable tag flow, RC flow, release branch flow, and simctl-unavailable cases.
- Preserve the invariant that unexpected disappearance on stable tags remains blocking.

Acceptance criteria:

- Stable tag flow fails only on real unexpected disappearance.
- RC and infra-degraded cases remain clearly classified.
- Unit coverage locks the lifecycle and workflow rules.

## Phase 4 - Global Bottom-Sheet Safe-Area Fix

Implementation targets:

- Define a shared bottom-sheet clearance token matching the main-navigation clearance contract.
- Apply it in the shared sheet primitive so sheet bodies and footers end above the unsafe OS-reserved zone.
- Audit all `AppSheet` consumers and normalize any local bottom padding that conflicts with the shared contract.
- Preserve existing expanded-modal behavior while fixing compact/mobile sheets globally.

Acceptance criteria:

- Scrollable content ends above the unsafe zone.
- No bottom-sheet interactive element sits inside the OS gesture/navigation area.
- Compact and expanded layouts remain visually consistent.

## Phase 4a - Diagnostics Detail Interactions

Implementation targets:

- Make activity rows in the diagnostics activity list toggle expanded details on tap and collapse on a second tap.
- Hide row expand affordances when expanded content would add no information beyond the collapsed summary.
- Reuse the existing detailed health-check surface inside the top diagnostics panel so the latest probe-by-probe result is reachable.
- Auto-expand the health detail panel when a new health check starts and keep live probe progress visible while the run is in flight.

Acceptance criteria:

- Activity items with extra detail expand and collapse deterministically on repeated taps.
- Activity items without extra detail show no expand icon.
- The health panel exposes REST, FTP, CONFIG, RASTER, and JIFFY detail for the latest run.
- Clicking Run health check opens the detailed panel immediately and keeps progress visible during execution.

## Phase 4b - Swipe Page Navigation

Implementation targets:

- Restore horizontal swipe navigation between primary app pages on touch devices.
- Keep the primary page order aligned with the authoritative tab route list so tab taps and swipes always land on the same destination.
- Preserve wrap-around behavior so swiping left on the last page lands on the first page, and swiping right on the first page lands on the last page.
- Add real gesture-path regression coverage at the hook and app/runtime layers so touch-specific regressions are caught before release.

Acceptance criteria:

- A touch swipe left advances to the next primary page.
- A touch swipe right returns to the previous primary page.
- Swipe navigation wraps from the last page to the first and from the first to the last.
- Existing mouse click behavior for buttons and tabs remains intact.

## Phase 4c - Diagnostics Screenshot Evidence

Implementation targets:

- Extend the diagnostics screenshot flow so the existing gallery proves activity-row expansion and second-tap collapse.
- Capture an expanded activity row that shows the full internally available detail in the same compact overlay layout used at runtime.
- Capture both the completed health-check detail state and an in-flight health-check progress state so the gallery shows probe order, per-probe outcomes, durations, pending/running status, and overall latency/result detail.
- Keep the screenshot set minimal by adding only the diagnostics images made inaccurate or incomplete by the new diagnostics interaction behavior.

Acceptance criteria:

- The diagnostics activity gallery includes a collapsed baseline, an expanded-detail state, and a recollapsed state after the second tap.
- The diagnostics header gallery includes a completed health-check detail screenshot showing REST, FTP, CONFIG, RASTER, and JIFFY plus latency and overall result.
- The diagnostics header gallery includes a live progress screenshot showing the same probe order with completed, running, and pending states.
- Screenshot file names and documentation index entries match the generated `doc/img/app/diagnostics/**` output.

## Phase 5 - Regression Coverage

Required additions or updates:

- Build-version unit tests for exact tag propagation and tagged-build mismatch handling.
- Homepage/runtime version display tests for exact-tag rendering.
- iOS telemetry monitor and workflow tests covering stable-tag, RC, release-branch, and lifecycle-window cases.
- Shared sheet primitive tests proving bottom clearance contract on sheet presentation.
- Diagnostics dialog tests covering activity expansion, hidden expand icons, and health-detail auto-expansion.
- Swipe navigation tests covering touch-origin gestures and wrap-around between the first and last pages.
- Diagnostics screenshot generation covering expanded activity detail, second-tap collapse, completed health-check detail, and live health-check progress.

## Phase 6 - Validation

Required validation for this change set:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Targeted validation as needed:

- Focused unit tests for build version, telemetry workflow, telemetry lifecycle, app-surface, and affected sheet consumers.
- If visible sheet layout changes require documentation screenshot refresh, regenerate only the minimal affected screenshot set.

Completion criteria:

- Exact release tag is visible in UI and wired through native/web build metadata.
- Android tagged build path is consistent with injected version.
- iOS telemetry gate logic is deterministic and no longer misclassifies expected lifecycle behavior as stable-tag disappearance.
- Shared bottom-sheet safe-area contract is applied across all bottom sheets.
- Coverage remains at or above repository threshold.
