# Review 12 — Deep Product, Diagnostics, and HVSC Audit

Status: COMPLETE
Date: 2026-03-24

## Executive Summary

This audit found that the current codebase is materially healthier than the previous review lineage suggested, but the repo still contains a small set of high-leverage inconsistencies that affect product trust, developer workflow, and maintenance clarity.

The most important verified product issue is that web builds still present HVSC as an available workflow even though the browser runtime cannot complete it honestly. In a live preview build, the Play page exposed an enabled Download HVSC action, then failed with generic fetch/CORS errors instead of presenting HVSC as unsupported in browsers. That is a user-facing capability bug, not just a documentation issue.

The most important verified developer-workflow issue is that the local Vite dev server currently crashes on startup because a recursive symlink loop under `test-data/sid/hvsc/hvsc` is traversed during file watching. This blocks normal web investigation and makes the local development path less reliable than the production build path.

The strongest documentation issues are now about drift rather than missing coverage. Several old review-11 defects appear fixed in code, but public and internal documentation still describes older diagnostics/HVSC behavior. The most severe internal example is the iOS parity matrix, which still claims HVSC is shared TypeScript with no native iOS implementation even though a native iOS `HvscIngestionPlugin` and `SWCompression` integration are present and registered.

The real-device Android audit progressed further than the earlier blocked pass. On the unlocked Pixel 4, the live diagnostics overlay rendered directly on-device and exposed a more serious issue than the lockscreen blocker: the app reported `C64U · 127.0.0.1:<port>` and action rows such as `GET 127.0.0.1:<port> /v1/configs/...` on physical hardware. That strongly suggests the runtime had entered demo/mock routing on a real handset, which makes diagnostics and connection state harder to trust.

The follow-up pass also confirmed a mobile diagnostics usability defect and fixed it in code during this session. On small screens, the diagnostics overflow menu sat too close to the sheet close button. The header actions were repositioned so the menu remains clearly to the left of the close control, and a Playwright regression now checks the separation on a phone-sized viewport.

Important non-findings from this audit:

- The old diagnostics cold-start health regression appears fixed by current `useHealthState()` gating.
- Action labels are more specific than before and now include path detail instead of collapsing to generic `rest.get` labels.
- The diagnostics evidence list is no longer capped at eight rows; current code uses a 20-row slice.
- HVSC cache readiness is now gated on successful extraction instead of download completion alone.
- Android chunked HVSC reads now parse `offsetBytes` explicitly.
- iOS now has a native HVSC ingestion implementation and registration path.

## Scope and Method

This was a repo-and-runtime audit, not a code-change task. The work focused on current behavior and current documentation instead of assuming prior review findings were still valid.

Method used:

1. Read the current planning lineage and prior review material under `doc/research/`.
2. Inspected current implementation for diagnostics, tracing, health, HVSC, routing, Android, and iOS bridge code.
3. Read the most relevant product and internal documentation, especially `README.md`, `doc/ux-interactions.md`, `doc/developer.md`, `doc/internals/ios-parity-matrix.md`, and `doc/internals/module-boundary-inventory.md`.
4. Read focused tests, especially diagnostics and HVSC Playwright coverage.
5. Exercised the live web product where practical using a production build plus preview server.
6. Exercised the Android app on the attached Pixel 4 directly once the device was unlocked, captured live screenshots, and correlated the on-device diagnostics state with the connection-management code.
7. Verified C64U reachability from the host with direct HTTP requests by hostname and IP.
8. Implemented and validated a diagnostics header layout fix for the overflow-menu/close-button hit-target conflict on small screens.

This audit intentionally separates:

- verified runtime issues
- verified documentation drift
- verified fixes relative to earlier review findings
- blocked or inferred areas that still need a future live pass

## Environment and Devices

Audit date: 2026-03-24

- Host OS: Linux
- Repository: `c64commander`
- Branch: `main`
- Workspace path: `/home/chris/dev/c64/c64commander`
- Attached Android device: Pixel 4, serial `9B081FFAZ001WX`
- Target C64 Ultimate hostname: `c64u`
- Target C64 Ultimate IP: `192.168.1.167`

Key validation commands and investigations used during this audit:

- `npm run build`
- focused Playwright diagnostics/HVSC coverage (`playwright/settingsDiagnostics.spec.ts`, `playwright/homeDiagnosticsOverlay.spec.ts`, `playwright/hvsc.spec.ts`)
- production preview browser inspection on `/play` and `/settings`
- `curl http://c64u/v1/info`
- `curl http://192.168.1.167/v1/info`
- adb package/device checks and logcat capture on the attached Pixel 4

Observed results:

- `npm run build` succeeded.
- The focused Playwright diagnostics/HVSC suites passed (`24 passed`).
- Host-side HTTP requests to both `c64u` and `192.168.1.167` returned valid C64 Ultimate metadata.
- Android logs showed app startup and live requests aimed at `http://c64u/...`.
- On-device diagnostics screenshots on the unlocked Pixel 4 showed the app rendering a localhost device target (`127.0.0.1:<port>`) and action rows against that host on real hardware.
- `npm run dev -- --host 127.0.0.1 --port 4173` failed with `ELOOP: too many symbolic links encountered` on `test-data/sid/hvsc/hvsc`.
- The diagnostics header spacing fix passed targeted Playwright coverage on a 390x844 viewport.
- Validation after the follow-up code change completed with `npm run lint`, `npm run build`, targeted Playwright diagnostics coverage, and isolated unit coverage at 91.01% branch coverage.

## Audited Areas

The following areas were audited directly:

- Diagnostics overlay UI, filters, export paths, deep links, and evidence presentation
- Health-state derivation and health-check ownership
- HVSC availability gating, download/extraction/install state, and native bridge surfaces
- Android HVSC native bridge code and iOS HVSC native bridge code
- README, UX docs, internal parity docs, and module inventory docs
- Focused Playwright coverage for diagnostics and HVSC
- Host-side C64U reachability and browser runtime behavior
- Android startup/log evidence and direct on-device diagnostics UI on the attached Pixel 4

The audit also explicitly re-checked several former findings from the previous review lineage to determine whether they were still current.

## Areas Not Fully Audited

The following areas remain only partially verified:

- Android page coverage beyond diagnostics and Settings. The Pixel 4 was unlocked and the diagnostics overlay was exercised directly, but Home, Play, Disks, and Config were not all driven through deep scenario coverage in this pass.
- Android end-to-end HVSC ingestion on real hardware. The app was live on-device, but the session was already routing to a localhost/mock endpoint, so a trustworthy real-device HVSC flow could not be completed before first correcting the routing state.
- iOS live runtime behavior. iOS parity findings in this report are based on source inspection and supporting docs/tests, not a live iOS run.
- Full product-wide UI consistency outside the requested emphasis areas. Diagnostics and HVSC received the deepest review; broader page-by-page UI coverage was sampled, not exhaustively revalidated.

These gaps are reflected in the finding severities below. Runtime-verified web issues are treated as stronger evidence than inferred iOS parity concerns.

## Issue Prioritization Matrix

| ID    | Issue                                                                    | Severity | Platforms                           | Why it should move first                                                     |
| ----- | ------------------------------------------------------------------------ | -------- | ----------------------------------- | ---------------------------------------------------------------------------- |
| R12-1 | Browser HVSC is exposed as supported even though the live web path fails | High     | Web                                 | User-facing broken capability; existing tests miss the real unsupported path |
| R12-2 | Local Vite dev server crashes on recursive HVSC fixture symlink          | High     | Dev workflow / Web                  | Blocks normal local investigation and slows every future web fix             |
| R12-3 | Diagnostics docs and screenshots describe an older overlay model         | Medium   | Docs / Android / iOS / Web          | Support, QA, and future audits are guided by stale UI flows                  |
| R12-4 | Internal HVSC parity and module inventory docs are factually wrong       | Medium   | Internal docs / iOS / Web / Android | Creates false parity assumptions and sends contributors to dead paths        |
| R12-5 | “Share filtered” export path hard-codes `actions` scope                  | Medium   | Android / iOS / Web                 | Support exports can be mislabeled, which weakens triage and evidence quality |
| R12-6 | Real Android diagnostics surfaced a localhost/mock target on hardware    | High     | Android                             | Undermines trust in connection state and blocks trustworthy real-device HVSC |

## Findings

### R12-1. Browser HVSC is exposed as supported even though the live web path fails

- Severity: High
- Platforms: Web
- Files: `src/lib/hvsc/hvscService.ts`, `src/pages/playFiles/components/HvscControls.tsx`, `playwright/hvsc.spec.ts`
- Reproduction:
  1. Build the app with `npm run build`.
  2. Serve the production output with preview.
  3. Open `/play` in a desktop browser.
  4. Observe that the HVSC card renders with an enabled `Download HVSC` action.
  5. Trigger the download.
- Expected:
  - Browser builds should either hide HVSC download/install actions or clearly present HVSC as unavailable in browsers before the user starts the workflow.
- Actual:
  - The web UI exposes the workflow as if it is available.
  - Triggering it ends in generic `Failed to fetch`/CORS failures instead of a truthful unsupported-state explanation.
- Evidence:
  - Live preview-browser inspection showed the HVSC card with `Download HVSC` visible and enabled while the browser-unavailable copy was absent.
  - A live browser click path produced CORS/fetch failures against both `http://c64u/v1/info` and `https://hvsc.brona.dk/HVSC/`, after which the card reported `Status: Failed`, `HVSC download failed`, `Download error`, and `Failed to fetch`.
  - `src/lib/hvsc/hvscService.ts` currently treats `Capacitor.isPluginAvailable("Filesystem")` as sufficient for HVSC availability, which is too broad for browser builds.
- Root cause or hypothesis:
  - The capability gate conflates general Filesystem plugin presence with actual HVSC bridge/runtime support.
  - Browser builds therefore pass the availability gate even though the full workflow depends on native/device assumptions the browser path cannot honor reliably.
- Why it matters:
  - This is a user-facing false affordance.
  - It produces support noise and makes the web experience look broken rather than intentionally constrained.
  - Existing mocked HVSC tests can stay green while the real web runtime stays misleading.
- Fix guidance:
  - Gate HVSC availability on explicit native/runtime support, not general Filesystem availability.
  - Render browser-specific copy before the user can start the workflow.
  - Add a runtime-level web regression that asserts browser builds do not expose a fake-supported HVSC download path.
- Recommended tests:
  - Unit test for HVSC capability gating in `hvscService`.
  - Playwright coverage against the built web runtime that asserts browser HVSC controls are disabled or replaced with unsupported messaging.
- Regression risk:
  - Medium. Changing availability logic can affect native/web splits, so it needs explicit platform coverage.

### R12-2. Local Vite dev server crashes on a recursive HVSC fixture symlink

- Severity: High
- Platforms: Developer workflow / Web
- Files: `test-data/sid/hvsc/hvsc`, Vite watch configuration path (effective runtime surface), local startup workflow
- Reproduction:
  1. Run `npm run dev -- --host 127.0.0.1 --port 4173` from the repo root.
- Expected:
  - The local web dev server should start normally.
- Actual:
  - Startup fails with `ELOOP: too many symbolic links encountered, stat '/home/chris/dev/c64/c64commander/test-data/sid/hvsc/hvsc'`.
- Evidence:
  - The failure reproduced directly during this audit.
  - The production build path still succeeded, so this is specifically a local watch/startup defect rather than a general compile failure.
- Root cause or hypothesis:
  - The watch startup path is traversing a recursive fixture symlink under `test-data`, and the current config/fixture layout does not guard against it.
- Why it matters:
  - This blocks the fastest feedback loop for web work.
  - It raises the cost of reproducing browser issues and pushes contributors onto slower preview/build paths.
  - It makes the repository look less buildable than it actually is.
- Fix guidance:
  - Remove or break the recursive fixture link, or explicitly exclude the affected fixture subtree from Vite/chokidar watch traversal.
  - Add a narrow startup smoke check for the dev server so this cannot regress silently.
- Recommended tests:
  - A lightweight startup sanity check in CI or a repo helper script that verifies `npm run dev` can initialize without immediate watcher failure.
- Regression risk:
  - Medium. Watch exclusions can accidentally hide legitimate source changes if scoped too broadly.

### R12-3. Diagnostics documentation and screenshots describe an older overlay model

- Severity: Medium
- Platforms: Docs / Android / iOS / Web
- Files: `README.md`, `doc/ux-interactions.md`, `doc/img/app/diagnostics/*`, current implementation in `src/components/diagnostics/DiagnosticsDialog.tsx`
- Reproduction:
  1. Read the diagnostics guidance in `README.md` and `doc/ux-interactions.md`.
  2. Compare those instructions with the current diagnostics overlay implementation and current live preview behavior.
- Expected:
  - Public docs and screenshots should match the currently shipped diagnostics affordances and terminology.
- Actual:
  - The docs still describe older actions such as `Clear All`, `Share All`, `Filter entries`, and `Share active tab ZIP export` as the primary diagnostics interaction model.
  - The current overlay has evolved toward a unified evidence feed, a filter editor, detailed action row titles, a footer tool strip, and overflow-based sharing/maintenance actions.
  - README screenshots still point at earlier diagnostics captures that no longer communicate the current navigation model clearly.
- Evidence:
  - `doc/ux-interactions.md` still documents button-level flows around `Clear All`, `Share All`, `Filter entries`, and per-tab sharing.
  - `README.md` still embeds older diagnostics screenshots and describes diagnostics primarily through that older surface.
  - `src/components/diagnostics/DiagnosticsDialog.tsx` now exposes footer entry points for Config Drift, Latency, Health History, REST Heat Map, FTP Heat Map, and Config Heat Map, plus overflow actions such as `Share filtered`.
  - The diagnostics list now uses 20 visible entries and more descriptive action titles than earlier reviews reported.
- Root cause or hypothesis:
  - The diagnostics UI moved faster than its documentation and screenshot corpus.
  - Earlier review fixes were implemented in code without a full documentation refresh.
- Why it matters:
  - QA, support, and future audits will follow obsolete UI paths.
  - Users reading the README will develop the wrong mental model of where diagnostics tools live.
- Fix guidance:
  - Refresh the diagnostics documentation to describe the current overlay information architecture.
  - Replace only the stale diagnostics screenshots under `doc/img/app/diagnostics/` instead of bulk-regenerating unrelated image sets.
  - Align terminology across README, UX docs, and the live overlay.
- Recommended tests:
  - Regenerate only the impacted diagnostics screenshots.
  - Add a lightweight documentation review checkpoint when diagnostics UI affordances change.
- Regression risk:
  - Low for code, medium for operational clarity if left unresolved.

### R12-4. Internal HVSC parity and module inventory docs are factually wrong

- Severity: Medium
- Platforms: Internal docs / Android / iOS / Web
- Files: `doc/internals/ios-parity-matrix.md`, `doc/internals/module-boundary-inventory.md`, `ios/App/App/HvscIngestionPlugin.swift`, `ios/App/App/AppDelegate.swift`, `ios/App/Podfile`, `src/lib/native/hvscIngestion.ts`
- Reproduction:
  1. Read the HVSC row in `doc/internals/ios-parity-matrix.md`.
  2. Read the HVSC-related entries in `doc/internals/module-boundary-inventory.md`.
  3. Compare those claims against the current iOS native code and current source tree.
- Expected:
  - Internal architecture docs should reflect the actual native bridge layout and current ownership.
- Actual:
  - The parity matrix still says the HVSC module is shared TypeScript with no native code on iOS.
  - The module inventory still points readers at a nonexistent `src/lib/hvsc/native/hvscIngestion.ts` path and describes several bridge surfaces as deprecated shims even though the active bridge lives elsewhere.
  - Current source shows a native `HvscIngestionPlugin` on iOS, plugin registration in `AppDelegate`, and `SWCompression` declared in the Podfile.
- Evidence:
  - `doc/internals/ios-parity-matrix.md` states: `Shared TypeScript (no native code)` for HVSC.
  - `doc/internals/module-boundary-inventory.md` references `src/lib/hvsc/native/hvscIngestion.ts`, which is not the active runtime path.
  - `ios/App/App/HvscIngestionPlugin.swift` contains the native iOS implementation.
  - `ios/App/App/AppDelegate.swift` registers `HvscIngestionPlugin()`.
  - `ios/App/Podfile` includes `pod 'SWCompression', '~> 4.8'`.
- Root cause or hypothesis:
  - Internal docs were not updated after the iOS HVSC native implementation landed.
- Why it matters:
  - Contributors and future auditors get the wrong answer about platform parity.
  - It slows debugging and encourages edits in dead or misleading paths.
- Fix guidance:
  - Update the parity matrix and module inventory to reflect the actual native/plugin ownership.
  - Remove references to stale or nonexistent HVSC paths.
- Recommended tests:
  - No executable test is required, but this should be part of the next documentation/parity refresh.
- Regression risk:
  - Low for runtime behavior, medium for team coordination if it remains stale.

### R12-5. “Share filtered” export path hard-codes `actions` scope

- Severity: Medium
- Platforms: Android / iOS / Web
- Files: `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`, export helpers under `src/lib/diagnostics/`
- Reproduction:
  1. Open Diagnostics.
  2. Change the active evidence filter away from actions, for example to logs or problems.
  3. Trigger `Share filtered` from the overflow menu.
- Expected:
  - The exported bundle scope and naming should reflect the active filtered evidence set, or use a neutral `filtered` scope.
- Actual:
  - `GlobalDiagnosticsOverlay.tsx` calls `shareDiagnosticsZip("actions", filteredEntries)` unconditionally.
- Evidence:
  - Direct code inspection of the export call site verifies the hard-coded scope.
  - This means non-action filtered bundles can still be exported under an `actions` label.
- Root cause or hypothesis:
  - The export path was implemented against an earlier action-centric diagnostics model and not updated when the overlay moved to a mixed evidence feed.
- Why it matters:
  - Support bundles can be mislabeled.
  - Misnamed exports reduce trust in diagnostics evidence and make downstream triage harder.
- Fix guidance:
  - Derive the export scope from the active filter or rename the export mode to a neutral filtered-bundle concept.
  - Add regression coverage around the export metadata and file naming.
- Recommended tests:
  - Unit test for diagnostics export scope derivation.
  - UI-level regression using the share override/test probe path to assert filtered logs/problems do not export as `actions`.
- Regression risk:
  - Low to medium. The code change is small, but export compatibility and test assumptions should be checked.

### R12-6. Real Android diagnostics surfaced a localhost/mock target on physical hardware

- Severity: High
- Platforms: Android
- Files: `src/components/diagnostics/DiagnosticsDialog.tsx`, `src/lib/connection/connectionManager.ts`, Android runtime state on Pixel 4
- Reproduction:
  1. Unlock the attached Pixel 4 and launch the installed `uk.gleissner.c64commander` app.
  2. Open Diagnostics from Settings.
  3. Inspect the device line and the recent action rows.
- Expected:
  - On a real-device audit path, diagnostics should report the actual target host such as `c64u` or the configured LAN IP, or clearly indicate that demo/mock mode is active.
- Actual:
  - The on-device diagnostics header displayed `C64U · 127.0.0.1:<ephemeral-port>`.
  - Recent action rows also showed requests against `127.0.0.1:<port>` on the real handset.
  - This happened while the same host machine could still reach the real C64U at `http://c64u/v1/info` and `http://192.168.1.167/v1/info`.
- Evidence:
  - Pixel 4 screenshots captured during this follow-up showed the diagnostics sheet open on-device with the localhost target visible.
  - `DiagnosticsDialog.tsx` renders the device line directly from the active connection snapshot (`snapshot.deviceHost`).
  - `connectionManager.ts` has an explicit demo-mode path that rewrites the runtime API config to a mock server and logs `Demo mode using mock C64U`.
- Root cause or hypothesis:
  - The most likely explanation is that demo/mock routing remained active or reactivated on a real handset session, and the diagnostics surface did not make that state explicit enough for the user.
  - Even if intentional internally, surfacing a localhost endpoint as `C64U` on physical hardware is misleading in an audit/debug context.
- Why it matters:
  - Real-device diagnostics become harder to trust.
  - It blocks honest Android HVSC verification because download/playback may be exercising the mock server instead of the real device.
  - It increases the chance that users or developers misread demo-mode success as real-device success.
- Fix guidance:
  - Make demo/mock mode visually explicit in the diagnostics header and connection surfaces.
  - Audit the sticky real-device lock and demo-mode transition conditions in `connectionManager.ts` so a real-device session does not silently fall back to localhost once a real target has been established.
  - Add a deterministic Android/web test that asserts the diagnostics device line reports the actual configured host when real-device mode is active.
- Recommended tests:
  - Unit coverage around `transitionToRealConnected`, `transitionToDemoActive`, and sticky real-device lock behavior.
  - An Android or Playwright-visible diagnostics assertion that distinguishes real-device and demo/mock routing states.
- Regression risk:
  - High. This affects audit confidence, user trust, and any feature path that depends on the active API target.

## Proposed Web HVSC Architecture

The current codebase already contains most of the domain logic needed for web HVSC support. The missing pieces are not SID parsing or archive extraction; they are the web download/storage pipeline and the availability gating around it.

### Current blockers

1. `src/lib/hvsc/hvscService.ts`

- `hasRuntimeBridge()` currently treats `Capacitor.isPluginAvailable("Filesystem")` as sufficient runtime support.
- That is why browser builds expose HVSC before a real web storage/download path exists.

1. `src/lib/hvsc/hvscBrowseIndexStore.ts` and related HVSC storage helpers

- HVSC browse-index persistence currently depends on `@capacitor/filesystem` and the app-data library root.
- There is no IndexedDB-backed web storage adapter yet.

1. Large archive delivery and resume semantics

- Native implementations can read cached archives in chunks.
- The browser path does not yet have an equivalent HTTP range/proxy strategy for a large 7z baseline/update archive.

### Reusable pieces already in the repo

1. `src/lib/hvsc/hvscArchiveExtraction.ts`

- Archive extraction is already implemented in shared TypeScript using `fflate` and `7z-wasm`.
- This is the core enabler for web support because it does not depend on Capacitor native code.

1. `src/lib/songlengths/songlengthService.ts` and related songlength parsing helpers

- Songlength parsing and resolution are already shared, storage-agnostic service code.
- A web HVSC path can reuse the same service once `Songlengths.txt` or `Songlengths.md5` content is loaded from browser storage.

1. `src/lib/playback/playbackRouter.ts`

- Local SID playback already routes through `api.playSidUpload()` with an uploaded SID blob and optional SSL payload.
- A web HVSC library only needs to supply the SID blob from browser storage instead of from native files or FTP.

1. `web/server/src/index.ts`

- The existing web server already owns authenticated/proxied device access patterns.
- It is the natural place to add an HVSC archive proxy so the browser does not depend on direct cross-origin downloads.

### Recommended implementation path

1. Add an IndexedDB-backed HVSC storage layer for web

- Introduce a web storage adapter for:
  - raw HVSC archive cache metadata
  - extracted SID blobs
  - browse index snapshots
  - songlength source text
- Keep the existing domain interfaces where possible so `hvscService` and `hvscIngestionRuntime` stay mostly unchanged above the storage boundary.

1. Add a web-server HVSC download proxy with range support

- Add a server endpoint under `web/server/src/` that downloads HVSC archives server-side and streams them to the browser.
- This avoids CORS issues and gives a place to support resumable/ranged requests.
- The browser should not fetch `https://hvsc.brona.dk/HVSC/` directly.

1. Reuse `hvscArchiveExtraction.ts` in the browser and write extracted artifacts to IndexedDB incrementally

- Keep extraction in shared TypeScript.
- During extraction, write SID files, browse-index rows, and songlength source files to IndexedDB incrementally rather than keeping the full extracted library in memory.

1. Reuse the existing songlength service for web-installed HVSC libraries

- When the extraction pipeline encounters songlength sources, feed them through the current songlength service facade and store the parsed state for later playback resolution.

1. Route web HVSC playback through blob upload, not FTP path playback

- For web-installed HVSC songs, load the SID blob from IndexedDB and reuse `api.playSidUpload()`.
- Preserve the existing SSL payload path so song-length metadata continues to work on uploaded playback.

1. Split capability gating into explicit native, mock, and web-installed modes

- `isHvscBridgeAvailable()` should no longer mean “Filesystem exists.”
- The UI needs a truthful distinction between:
  - native/device install path available
  - browser install path available
  - no install path available

### Performance and UX constraints

1. Archive size and startup time

- A full HVSC install on web will be slower than native and should be presented as a background-capable install with progress, resumability, and explicit storage messaging.

1. Browser storage quotas

- The UI needs to surface storage requirements before install and handle quota failures explicitly.

1. Memory pressure during extraction

- Extraction must remain incremental. The browser path should never require holding the full extracted library in RAM at once.

### Minimal validation plan for web HVSC

1. Unit-test the new web storage adapter and capability gate.
1. Add a web-runtime Playwright path that installs a mock HVSC archive through the proxy, ingests it into browser storage, browses it, and plays a SID via upload.
1. Keep the existing native HVSC tests intact so web support becomes additive rather than a rewrite.

## Follow-Up Fix Applied During This Session

The diagnostics header overflow menu was repositioned so it stays clearly to the left of the close button on small screens instead of overlapping its hit area.

- Files changed: `src/components/diagnostics/DiagnosticsDialog.tsx`, `playwright/modalConsistency.spec.ts`
- Validation: targeted Playwright coverage now includes a phone-sized regression asserting that the diagnostics overflow menu remains left of the close button with visible separation.

## Highest-Value Fix Sequence

1. Fix browser HVSC gating and add a real web-runtime regression.

- This is the highest user-facing defect found in this pass.
- It also closes the current gap between mocked Playwright confidence and the built browser experience.
- It should be implemented together with the IndexedDB-plus-proxy web HVSC architecture above, not as a message-only patch.

1. Fix the recursive symlink/watch startup failure for `npm run dev`.

- This restores the normal local feedback loop and reduces future debugging cost immediately.

1. Fix diagnostics filtered export scope.

- This is a small code change with clear support/debugging value.
- It should ship with focused test coverage because the UI already has a share override path suitable for regression testing.

1. Refresh diagnostics public docs and screenshots.

- Update only the diagnostics-related screenshots and text.
- Keep the refresh narrow so the docs become trustworthy again without unrelated churn.

1. Refresh internal HVSC parity/module docs.

- This has lower runtime urgency than the items above, but it removes false architecture signals before the next implementation cycle.

1. Make demo/mock routing explicit on Android and stop silently presenting localhost as `C64U` on physical hardware.

- The real-device audit found this issue directly on the Pixel 4.
- It needs to be corrected before any trustworthy Android HVSC audit can be considered complete.

## Appendix — Evidence Inventory

Runtime and tooling evidence gathered during this audit:

- Host-side C64U reachability
  - `curl http://c64u/v1/info`
  - `curl http://192.168.1.167/v1/info`
  - Both returned matching C64 Ultimate metadata including `product`, `firmware_version`, `fpga_version`, `core_version`, `hostname`, and an empty `errors` array.

- Web build/runtime evidence
  - `npm run build` succeeded.
  - `npm run dev -- --host 127.0.0.1 --port 4173` failed with `ELOOP: too many symbolic links encountered` on `test-data/sid/hvsc/hvsc`.
  - A production preview-browser inspection on `/play` showed the HVSC card rendering as available in the browser.
  - Triggering `Download HVSC` in that live browser path produced fetch/CORS failures and a failed HVSC status state.

- Focused automated coverage
  - `playwright/settingsDiagnostics.spec.ts`
  - `playwright/homeDiagnosticsOverlay.spec.ts`
  - `playwright/hvsc.spec.ts`
  - Result during this audit: `24 passed`.
  - Follow-up diagnostics layout regression: `playwright/modalConsistency.spec.ts` targeted tests passed (`2 passed`).

- Code-change validation
  - `npm run lint` passed for the modified source files; the only warnings came from pre-existing generated files under `android/coverage/`.
  - `npm run build` passed after the diagnostics layout fix.
  - Isolated unit coverage run completed with 91.01% overall branch coverage.

- Android evidence
  - `adb devices -l` confirmed the attached Pixel 4 (`9B081FFAZ001WX`).
  - After unlock, the diagnostics overlay was exercised directly on-device.
  - On-device diagnostics screenshots showed `C64U · 127.0.0.1:<port>` and localhost action rows on the real handset.
  - App logs still showed startup lifecycle activity and live requests to `http://c64u/v1/info` plus additional config endpoints.

- Source-inspection confirmations of prior fixes
  - `useHealthState.ts` now gates trace-derived health on first successful REST evidence.
  - `c64api.ts` now emits more specific implicit action names.
  - `DiagnosticsDialog.tsx` now uses `filteredEntries.slice(0, 20)`.
  - `useHvscLibrary.ts` now gates cache readiness on extraction success.
  - Android `HvscIngestionPlugin.kt` now reads `offsetBytes` correctly.
  - iOS native HVSC ingestion exists and is registered.
