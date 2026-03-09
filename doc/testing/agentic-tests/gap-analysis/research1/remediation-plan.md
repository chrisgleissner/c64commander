# Remediation Plan

## Prioritized Recommendations

| Priority | Type | Change | Expected benefit | Cost | Risks / tradeoffs | Acceptance criteria |
| --- | --- | --- | --- | --- | --- | --- |
| P0 | Architecture | Reclassify `c64scope` direct-control validation code as infrastructure-only calibration, or remove it from product-validation paths entirely | stops false product-coverage claims immediately | M | existing reports/cases will need relabeling | no product-validation case in `c64scope` directly runs PRGs, reads memory as primary control, or browses FTP as the main workflow |
| P0 | Tooling | Wire `droidmind` MCP into the validation pipeline (it is already configured in `.vscode/mcp.json`; `droidmind/` exists as a gitignored symlink with tools for `android_ui`, `android_app`, `screenshot`, `android_log`) and contract-test it against the controller contract | creates a real app-driving path; `.vscode/mcp.json` already configures the server | M | MCP integration work; potential latency vs direct ADB | repo contains a validation adapter that uses `droidmind` MCP (or equivalent) to launch app, navigate, tap, type, capture screenshots, capture logcat, and lock/unlock the device |
| P0 | Policy / tooling | Enforce `c64bridge` use policy in runtime code and session schema | turns prose rules into hard constraints | M | some existing cases will fail or become blocked | every `c64bridge` step in product runs requires an allowed reason enum and is rejected otherwise |
| P0 | Session model | Make `scope_session` provenance authoritative, not caller-declared | restores trust in artifacts | M | requires tighter integration with actual tool calls | session artifacts can distinguish controller actions, `c64bridge` calls, and `c64scope` operations from recorded invocation metadata rather than free text |
| P1 | State/reset | Build a deterministic reset harness for app state, playlists, disk library, HVSC state, screen/device state, and C64 baseline | improves repeatability for long runs | M | reset mistakes can hide bugs if overused | each case declares reset needs and cleanup verifies resulting baseline state |
| P1 | Case execution | Implement metadata-driven executors for high-value journeys starting with playlist, disk list, HVSC, and lock-screen playback | aligns executable coverage with intended coverage | L | more up-front modeling work | catalog cases for these journeys become runnable through the mobile controller without bypass |
| P1 | Observability | Wire app-native diagnostics, traces, playlist state, HVSC status, and Android logs into session attachments by default | stronger oracles and faster triage | M | more artifact volume | every guarded or long-running case attaches at least one app-native artifact plus one corroborating runtime or `c64scope` artifact |
| P1 | Classification | Fix `oraclePolicy.ts` pass/failure-class semantics and tighten inconclusive rules | prevents misleading summaries | S | may reduce apparent pass counts | passing runs serialize `failureClass: inconclusive` or null-equivalent, never `product_failure` |
| P2 | App | Add explicit test-owned namespace support and reset endpoints or UI affordances for HVSC, playlists, and disk collections | reduces cleanup ambiguity | M | adds app complexity | test-owned data can be created and removed deterministically without touching user-owned state |
| P2 | App | Add richer inspectable state for playback provenance, current source, and cached-HVSC status | improves end-to-end proof quality | M | instrumentation maintenance | agent can prove that the A/V artifact corresponds to the app-selected playlist item/source |
| P2 | Docs | Collapse the architecture to one source of truth and remove contradictory examples | reduces drift | S | documentation churn | docs, prompts, case catalogs, and runnable examples describe the same control path |

## Proposed Testability Improvements

### Droidmind controllability

Facts:

- `droidmind` is already configured in `.vscode/mcp.json` and provides `android_ui` (tap, swipe, input_text, press_key), `android_app` (start, stop, clear), `android_device`, `android_log`, `screenshot`, `file_operations`, and `shell_command`.
- A second mobile controller, `mobile-mcp` (`@mobilenext/mobile-mcp`), is also configured.
- The validation pipeline currently bypasses both, using direct ADB.

Recommendations:

- For LLM-orchestrated sessions: strengthen app-driving examples and playbooks that use `droidmind` MCP tools. Add concrete examples showing how to navigate tabs, tap selectors, add items to playlists, and lock/unlock.
- For scripted validation: either refactor to use `droidmind` MCP as an MCP client, or create a thin ADB adapter layer that mirrors the `droidmind` tool API shape.
- Support explicit device selection, app launch/stop, app clear-state, lock/unlock, system back/home, screenshots, and bounded logcat capture.
- Support stable selector lookup by `data-testid`, `aria-label`, visible text, and route-aware fallback.
- Emit timestamps and action IDs that `c64scope` can correlate.

Acceptance criteria:

- A controller smoke suite can complete launch, tab navigation, Play add-items, Settings diagnostics open, and lock/unlock on a real Android target.

### `c64scope` assertions and session modeling

Recommendations:

- Treat `c64scope` as evidence-only in product validation.
- Reserve capture endpoints and record A/V windows, but do not synthesize peer usage.
- Add required fields for `controlPath`, `bridgeJustification`, `appActionId`, and `artifactCorrelation`.

Acceptance criteria:

- A session artifact can prove whether a played track came from an app playlist action, a direct bridge call, or a calibration run.

### App instrumentation and selectors

Facts:

- The app already provides rich stable selectors for the 7 required deep-dive flows:
  - Disk list: `[data-testid="disk-list"]`, `[data-testid="disk-row"]`, `button[aria-label="Mount <name>"]`
  - Playlist: `[data-testid="add-items-to-playlist"]`, `[data-testid="playlist-list"]`, `[data-testid="playlist-item"]`, `[data-testid="add-items-confirm"]`
  - Playback: `[data-testid="playlist-play"]`, `[data-testid="playback-current-track"]`, `[data-testid="playback-elapsed"]`
  - HVSC: `[data-testid="import-option-hvsc"]`, `[data-testid="source-entry-row"]`, `[data-testid="add-items-filter"]`
  - Volume: `[data-testid="volume-mute"]`, `[data-testid="volume-slider"]`

Recommendations:

- Preserve and extend existing selectors for Play, Disks, Settings diagnostics, and Home controls.
- Add explicit status rows for:
  - current playlist source and source ID
  - background execution armed state
  - HVSC cache baseline/update versions
  - whether an HVSC reset is summary-only or filesystem-clearing

Acceptance criteria:

- A controller can read these states without inference from toasts.

### State reset and determinism

Recommendations:

- Standardize reset tiers:
  - tier 0: no reset
  - tier 1: app foreground/log reset only
  - tier 2: app storage clear and fixture restage
  - tier 3: C64 baseline restore plus app/storage reset
- Reuse existing force-stop/`pm clear` harness patterns from emulator/Maestro scripts where appropriate.

Acceptance criteria:

- Each case declares its reset tier and the runner verifies the resulting baseline before continuing.

### Long-running resilience

Recommendations:

- Add bounded retry policies for HVSC and add-items recursion.
- Snapshot state before and after every long-running phase.
- Fail early when cleanup or attribution becomes non-deterministic.

Acceptance criteria:

- Long-running cases emit intermediate checkpoints and can stop as `inconclusive` before corrupting later cases.

### Screen-lock reliability

Recommendations:

- Expose controller primitives for lock, unlock, wake, and foreground restore.
- Record `backgroundAutoSkipDue`, app playback state, and runtime log slices around lock/unlock.
- Add a case-local proof that background execution was armed before locking.

Acceptance criteria:

- A lock-screen autoplay case passes only when armed-state evidence, item transition evidence, and post-unlock app state all agree.

### Download and cache verification

Recommendations:

- Separate “summary reset” from “cache clear” in the app and in case metadata.
- Record cache baseline/update versions before download, after download, and before cached ingest.
- Add test-owned HVSC storage budgeting and cleanup checks.

Acceptance criteria:

- A cached-ingest case can prove it used previously downloaded artifacts and did not re-download.

## Concrete Policy Text For Documentation

Add this text to the controlling prompt and architecture docs:

> Product-validation runs for C64 Commander are invalid if the primary user-facing action is performed through `c64bridge` when the app exposes that action. In such cases the runner must stop as `blocked` or `inconclusive`; it must not silently continue through direct-device control.

## Suggested Execution Order

1. Stop counting current direct-control `c64scope` validation cases as product coverage.
2. Stand up the mobile-controller integration and contract tests.
3. Add enforcement and provenance to `scope_session`.
4. Build reset tiers and fixture hygiene.
5. Implement four app-driven flagship journeys:
   - playlist creation and playback
   - disk collection creation and mount
   - HVSC download/cached ingest/browse/play
   - lock-screen autoplay continuation
6. Expand from there using the case catalog.

