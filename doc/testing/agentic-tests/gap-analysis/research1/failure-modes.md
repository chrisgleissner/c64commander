# Failure Modes And Bypass Paths

## Bypass Paths

| ID | Bypass path | Evidence | Why attractive | Why harmful | Severity | Recommended mitigation |
| --- | --- | --- | --- | --- | --- | --- |
| BP-01 | Use `c64bridge` program runners instead of app playback | `c64scope/src/validation/cases/playback.ts`; artifacts for `PLAY-RUN-001` and `PLAY-STREAM-001` | one call starts deterministic execution | proves hardware behavior, not app playback | Critical | remove from product-validation cases; classify as infrastructure calibration only |
| BP-02 | Use direct REST memory reads as primary Play oracle | `playback.ts`, `hardwareValidation.ts` | faster and deterministic | bypasses app transport, queue, and metadata logic | Critical | allow only as secondary oracle after app action |
| BP-03 | Use direct FTP and drive/config queries instead of disk-library UX | `storage.ts` | easy file presence checks | skips import/group/rename/delete/mount UX and persistence | Critical | require disk cases to start from app import/mount actions |
| BP-04 | Use ADB screenshot plus package/shared-prefs checks as “Settings coverage” | `system.ts` settings case, session artifacts | easy to script | does not prove settings interaction or export behavior | High | reframe as app-install sanity only, not Settings product coverage |
| BP-05 | Hardcode peer-server and LLM-trace metadata in scripted runner | `validation/runner.ts`, `validation-report.md` | makes reports look complete | creates false confidence about orchestration and control-path provenance | High | derive peer usage from real tool invocations and reject synthetic traces |
| BP-06 | Richer prompts/examples for `c64bridge` than for app-driving | `c64bridge/README.md`, `c64bridge/AGENTS.md`, prompt registry | direct tools are easier to discover | LLM will rationally choose the cheapest path | High | reduce direct-control examples in product-validation contexts; add controller-first playbooks |
| BP-07 | `droidmind` MCP available but not wired into validation pipeline | `.vscode/mcp.json` configures `droidmind`; `droidmind/` exists as gitignored symlink; but `autonomousValidation.ts` and `hardwareValidation.ts` use direct ADB calls; validation runner writes `peerServer: "mobile_controller"` without MCP | direct ADB is simpler than MCP in scripted code | makes app-driven validation structurally impossible in the scripted path; IDE-based LLM sessions CAN use droidmind but lack strong app-driving examples | Critical | wire `droidmind` MCP into the validation pipeline OR refactor validation to use the IDE-based MCP session model |

## Reliability Failure Modes

### FM-01: App state persists across runs without case-level reset

Fact:

- Playlist state persists through local storage, session storage, and IndexedDB.
- Disk collections persist by device ID.
- HVSC summary reset does not clear actual cache state.
- Runner cleanup resets only the C64.

Effect:

- later cases inherit playlists, sessions, cached media, HVSC summaries, and disk collections
- long-running exploratory runs become non-deterministic

Severity:

- Critical

### FM-02: App-driven vs direct-device mutations are not distinguishable

Fact:

- `scope_session.record_step` accepts a caller-supplied `peerServer`.
- The runner writes `peerServer` values itself.
- `validation-report.md` claims all three peer servers were used without proving actual `droidmind` MCP usage.

Effect:

- session artifacts cannot establish whether the app caused a change

Severity:

- Critical

### FM-03: Failure classification is semantically wrong even on pass

Fact:

- `c64scope/src/oraclePolicy.ts` returns `failureClass: "product_failure"` when all assertions pass.

Effect:

- downstream analytics and reports cannot be trusted

Severity:

- High

### FM-04: Case metadata and executed cases diverge

Fact:

- `c64scope/src/catalog/cases.ts` contains app-aligned journeys such as playlist build, background execution, and HVSC lifecycle.
- `c64scope/src/validation/cases/index.ts` executes a different, thinner case set.

Effect:

- the stack can advertise one coverage model while running another

Severity:

- High

### FM-05: Missing intermediate assertions for long-running flows

Fact:

- HVSC and background playback require intermediate checks:
  - progress stages
  - due-at armed state
  - cached baseline/update versions
  - playlist/current-item transitions
- Current executable agentic runner does not model these journeys.

Effect:

- divergence is detected late or not at all

Severity:

- High

## Flow-Specific Failure Modes

### Disk list creation and execution

- No executable autonomous app path today.
- No enforced test-owned namespace policy in runner.
- Current autonomous evidence only proves FTP/drive state (via `/v1/drives` and FTP browse in `storage.ts`).
- App selectors exist: `[data-testid="disk-list"]`, `[data-testid="disk-row"]`, `button[aria-label="Mount <name>"]`.
- Playwright `diskManagement.spec.ts` already tests folder grouping and mounting.

### Playlist creation and execution

- No executable autonomous add-items path today.
- Current Play cases bypass queue logic by posting PRGs via `/v1/runners:run_prg` in `playback.ts`.
- No reliable attribution that current item came from an app playlist action.
- App selectors exist: `[data-testid="add-items-to-playlist"]`, `[data-testid="playlist-list"]`, `[data-testid="playlist-play"]`, `[data-testid="playback-current-track"]`.
- Both Playwright (`itemSelection.spec.ts`, `playlistControls.spec.ts`) and Maestro (`edge-playlist-manipulation.yaml`) cover these flows.

### Locked-screen continuation

- No agentic executor for lock/unlock path.
- No case-level device state reset for screen lock.
- Background arming evidence IS available: `backgroundAutoSkipDue` events with `{ dueAtMs, firedAtMs }`, `BackgroundExecution.setDueAtMs()` API.
- Maestro `edge-auto-advance-lock.yaml` provides complete prior art for the lock/unlock/verify sequence.
- Missing: controller integration for `pressKey: Lock` / `pressKey: Home`, due-at correlation in session model.

### HVSC download and cache reuse

- Shared-lab mutation budgets exist in docs, but current runner does not enforce them.
- HVSC summary reset (`useHvscLibrary` reset) is NOT cache reset; only clears UI state, not `hvsc/cache/` filesystem.
- `getHvscCacheStatus()` returns `{ baselineVersion, updateVersions }` and `ingestCachedHvsc()` can ingest without re-download.
- No agentic case currently proves cached-ingest semantics end to end.
- Cache marker files (`hvsc-baseline-{version}.7z.complete.json`) can serve as filesystem assertions.

### Downloaded-song playlist generation

- Requires app browse/add-to-playlist behavior via `[data-testid="import-option-hvsc"]`, source entry navigation, and `[data-testid="add-items-confirm"]`.
- Playwright `hvsc.spec.ts` includes `addHvscDemoTrackToPlaylist()` helper demonstrating the complete flow.
- Current runner has no executor for this.
- Current A/V cases cannot prove provenance of played track because the control path bypasses the app.

