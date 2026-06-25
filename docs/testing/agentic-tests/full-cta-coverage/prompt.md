# Autonomous Android Production-Readiness Certification for C64 Commander (Full-CTA Coverage)

## 0. How to read this prompt

This program exists to certify the C64 Commander Android app at **CTA granularity** — every
button, toggle, select, slider, input, list action, link, and keypad shortcut — across the
~500–1000 controls the app exposes once state-dependent surfaces are counted.

Two facts shape everything below:

1. **There is already a working agentic test harness in this repository.** It is the
   `c64scope/` package (an MCP server *and* a family of autonomous TypeScript runners), the
   `full-app-coverage/` feature program, the canonical agentic-test contracts under
   `docs/testing/agentic-tests/`, and the web chaos/fuzz runner. You are **extending** that
   harness, not building a parallel one. Reuse is mandatory; duplication is a defect.

2. **The gap this program fills is scalability.** The prior `full-app-coverage` run proved the
   feature surface at route/marker level by having the LLM drive every interaction directly
   through the controller. That does not scale to ~1000 CTAs: an LLM clicking each control and
   collecting evidence in a long dialog is too slow and too expensive. The fix is a **two-level
   execution model** (Section 4): a deterministic, headless **bulk runner** that performs the
   CTA census and generic contracts without an LLM in the per-click loop, plus **agent-directed
   cases** where the LLM only handles the risky/ambiguous minority and triages the runner's
   machine-readable output. The LLM never hand-drives all 1000 CTAs.

Your two deliverables are equally important:

1. **Extend the existing `c64scope` harness** with the missing CTA-census / keypad-traversal /
   determinism / coverage-accounting layer, reusing existing modules wherever they already
   solve the problem (Section 6).
2. **Use that harness** plus targeted agent-driven testing to produce a complete
   production-readiness certification, ending in evidence-backed per-CTA results and a release
   recommendation rich enough to fix any finding without re-investigation (Sections 33–43).

Do not stop after designing the runner. Build it (by extending `c64scope`), document it,
validate it, run it against the real Pixel 4 and `c64u`, triage its failures, restore the
environment, and produce the final report. The release targets tens of thousands of paying
customers: treat every crash, ANR, unreachable CTA, silent failure, stale status, wrong device
mutation, request storm, lifecycle failure, data-loss risk, and hardware instability as
release-relevant.

## 1. Role

Act as a Principal Android QA Engineer, mobile-automation architect, and autonomous test
engineer who is also a careful steward of an existing test codebase. You optimize for reuse,
cohesion, and maintainability — not for greenfield rebuilds. When you must add code, it lands
inside the existing harness, follows its conventions, and is covered by its unit-test setup.

## 2. Required reading (read completely before any implementation or execution)

The reuse decision depends entirely on knowing what already exists. Read all of the following.
If a file is missing, record a documentation gap and continue; do not assume.

### 2.1 Canonical agentic-test contracts (authoritative — do not re-derive)

1. `docs/testing/agentic-tests/agentic-test-architecture.md` — peer-server model, LLM-as-orchestrator, evidence model.
2. `docs/testing/agentic-tests/agentic-controller-contract.md` — the controller role in interface terms. **This is the controller interface. Do not invent a new one.**
3. `docs/testing/agentic-tests/agentic-safety-policy.md` — action classes + per-family mutation budgets. **This is the risk model. Map onto it (Section 5).**
4. `docs/testing/agentic-tests/agentic-oracle-catalog.md` — oracle classes + per-feature oracle policy. **This is the oracle model. Use it (Section 5).**
5. `docs/testing/agentic-tests/agentic-observability-model.md` — evidence owners, correlation contract, minimum evidence per verdict, failure-triage order.
6. `docs/testing/agentic-tests/agentic-android-runtime-contract.md` — connection state machine, background-execution contract, the reusable startup/staging scripts, package id.
7. `docs/testing/agentic-tests/agentic-action-model.md` — per-route preconditions/actions/postconditions/recovery/escape and exploration order.
8. `docs/testing/agentic-tests/agentic-feature-surface.md` — **the source of truth for scope**: route inventory, per-page repo anchors, feature areas, risk profiles.
9. `docs/testing/agentic-tests/agentic-coverage-matrix.md` — feature area → repo anchor → testability → primary oracle class → safety class.
10. `docs/testing/agentic-tests/agentic-open-questions.md` — AOQ-001…AOQ-009 already enumerate the known safety/expected-behavior unknowns. **Cite AOQ IDs; do not re-pose them as new questions.**
11. `docs/testing/agentic-tests/agentic-infrastructure-reuse.md` — reuse rules and the Playwright/Maestro/JVM prior-art map. **"Future implementation work must read this before adding new infrastructure."**
12. `docs/testing/agentic-tests/c64scope-spec.md` — c64scope responsibilities, tool groups, failure classes, response envelopes.
13. `docs/testing/agentic-tests/mcp-setup.md` — the four MCP servers, launchers, `.mcp.json`, `npm run agentic:mcp:setup`/`:check`.

### 2.2 The existing programs and code you are extending

14. `docs/testing/agentic-tests/full-app-coverage/` — read **all** of it: `README.md`, `feature-inventory.md`, `feature-test-catalog.md`, `feature-status-matrix.md`, `iteration-log.md`, `tool-gap-analysis.md`, `runs/README.md`, and at least `prompts/F003-home-machine-controls.md` and `prompts/F012-playback-transport.md` for the per-feature template. This is the program you extend (Section 7).
15. The `c64scope/` package source — at minimum: `src/validation/droidmindClient.ts`, `src/validation/runner.ts`, `src/validation/helpers.ts`, `src/validation/appFirstUi.ts`, `src/validation/appFirstPrimitives.ts`, `src/exploration.ts`, `src/oraclePolicy.ts`, `src/sessionStore.ts`, `src/preflight.ts`, `src/deviceRegistry.ts`, `src/fullAppCoverageExecutor.ts`, `src/autonomousValidation.ts`, `src/hilEvidenceRun.ts`, `src/server.ts`; plus `c64scope/package.json` and `c64scope/scripts/start.mjs`. This is the harness you extend (Section 6).
16. The chaos/fuzz runner — `scripts/run-fuzz.mjs`, `playwright/fuzz/chaosRunner.fuzz.ts`, `playwright/fuzz/fuzzRecovery.ts`, `playwright/fuzz/fuzzProgress.ts`, `playwright/fuzz/fuzzBackend.ts`, `scripts/fuzzClassifier.mjs`, `scripts/fuzzReportUtils.mjs`, `scripts/fuzzArtifactMergeUtils.mjs`, and `docs/testing/chaos-fuzz.md`. This is the source of the reusable seed/timeout/watchdog/signature/report spine (Section 6).
17. `.opencode/agents/c64-agentic-tester.md` and `.github/prompts/agentic-test.prompt.md` — existing bootstrap prompts; stay consistent with them.

### 2.3 App and product documentation

18. `AGENTS.md` (repo root).
19. `docs/cta-inventory.md` — the maintained per-page CTA checklist (includes the keypad device model). Treat its per-page counts as **tripwires**, not proof: they are pinned to an older branch/app version and must be re-counted by live discovery.
20. `docs/features-by-page.md`, `docs/architecture.md`, `docs/keyboard-input.md`, `docs/ux-interactions.md`.
21. `docs/testing/maestro.md`, `docs/testing/test-architecture.md`, `docs/testing/playback-volume-latency.md`, `docs/testing/physical-device-matrix.md`.
22. Relevant C64 REST/FTP/Telnet, file-format, and native-plugin documentation, and existing Playwright/Maestro/JVM/keypad/fuzz tests as prior art for expected behavior (per `agentic-infrastructure-reuse.md`).

Do not treat historical coverage claims (including `full-app-coverage`'s "23 PASS") as evidence
that the current production candidate passes. Re-verify against the live build.

## 3. Source-of-truth and specification policy

Precedence when sources agree:

1. Explicit instructions in this prompt.
2. Product requirements.
3. The canonical agentic-test contracts (Section 2.1).
4. `cta-inventory.md` for the maintained CTA/keypad checklist.
5. `agentic-feature-surface.md` + `features-by-page.md` for implemented scope.
6. `architecture.md` for runtime and persistence behavior.
7. `keyboard-input.md` for keypad semantics.
8. `ux-interactions.md` for interaction and overlay contracts.
9. Current source code.
10. Actual production-candidate behavior.

When sources disagree:

- Do not silently pick one. Record a discrepancy, but **first check whether the conflict is
  already tracked**: if it matches an `AOQ-###` in `agentic-open-questions.md`, cite that ID and
  extend it rather than minting a new one. Only open a new `SPEC-###` for genuinely new conflicts.
- Identify the conflicting sources, inspect the implementation, test both reasonable
  interpretations where safe, separate intended from actual behavior, and never count a
  discrepancy as a pass.

### 3.1 Resolved discrepancy: Play sources (do not re-investigate from scratch)

Static analysis already settled the old "Commodore source?" question. The app exposes **four**
play/import sources (`src/lib/playback/playbackRouter.ts` `PlaySource`, labels in
`src/lib/sourceNavigation/sourceTerms.ts`):

- `local` → "Local"
- `ultimate` → "C64U"
- `hvsc` → "HVSC"
- `commoserve` → "CommoServe" — an online file archive (`http://commoserve.files.commodore.net`),
  default-enabled and user-visible (`src/generated/variant.ts`), surfaced both as a Play import
  source (`ItemSelectionDialog`) and from Settings ("Open archive browser",
  testid `open-online-archive`).

There is **no** source named "Commodore" (the only "Commodore" strings are an HTTP `Client-Id`
header and a firmware charset label). Test all four real sources. Confirm whether the
Settings archive browser and the Play CommoServe source can each add items to the playlist; a
browse-only surface that cannot enqueue is a different feature from a Play source and must be
reported as such.

## 4. The scalability model (two-level execution)

This is the core architectural answer to "an LLM cannot click 1000 CTAs in a dialog."

### Level A — Bulk deterministic runner (no LLM in the per-click loop)

A compiled, headless TypeScript runner (an extension of the `c64scope` harness) that, given a
target and a route/scope, autonomously performs:

- Runtime CTA census (dynamic discovery, Section 11).
- Keypad traversal and touch parity (Section 15).
- Generic control contracts for R0/R1 controls and pre-approved R2 controls (Section 14).
- Safe value iteration with capture-and-restore.
- Empty/populated state coverage, repeated-interaction and busy-state checks.
- Timeout/watchdog detection, screenshot + UI-hierarchy + log capture on every issue.
- Per-CTA result recording, checkpointing, and replay generation.

The runner drives the device through the controller (DroidMind via the existing
`DroidmindClient`) directly in code. It must execute end-to-end **without the LLM choosing each
key press**. The LLM launches it, then consumes its machine-readable artifacts.

### Level B — Agent-directed cases (LLM judgment where it is worth the cost)

The LLM handles only:

- Unclassified controls (`R4`/`UNCLASSIFIED`).
- Guarded-destructive actions (`R3`) under explicit scenario manifests.
- Cross-page business flows and A/V-sensitive cases.
- C64 target instability, ambiguous failures, recovery, C64Bridge exception decisions.
- Background playback, long-running HVSC flows.
- Final triage and the release decision.

The LLM **must replay every bulk-runner failure at least once through the controller** before
declaring an application defect — unless the original evidence already proves a crash, ANR, or
irreversible failure.

This split is the acceptance-defining feature of the runner: a design that requires the LLM to
drive every CTA fails acceptance (Section 36).

## 5. Reuse the canonical vocabularies — do not invent parallel taxonomies

The previous draft of this program minted its own risk classes, oracle hierarchy, and controller
interface. That creates drift. **Reuse the canonical vocabularies; where finer granularity
genuinely helps, define it as an explicit refinement *of* the canonical term, with a mapping.**

### 5.1 Risk / safety

Use the action classes and **mutation budgets** from `agentic-safety-policy.md`
(Read-only / Guarded mutation / Destructive mutation / Prohibited; per-family max-per-case,
required guard, cleanup requirement). The runner's per-CTA gate must consult those budgets — the
existing `c64scope/src/exploration.ts` `shouldRefuseAction()` already implements a 3-tier budget
gate (`read-only` / `guarded-mutation` / `destructive`); extend that, do not replace it.

If you keep the finer `R0–R4` labels for CTA pre-classification, they are **only** a refinement
overlay and must map exactly:

| Refinement | Canonical action class | Automation rule |
| --- | --- | --- |
| R0 read-only | Read-only | Auto-exercise. |
| R1 app-local reversible | Guarded mutation (app-local) | Auto if original captured + restored. |
| R2 C64 reversible | Guarded mutation (device) | Auto only with before-state, app-driven restore path, expected postcondition, and a registered scenario/oracle. Respect the budget table. |
| R3 guarded destructive | Destructive mutation | Never auto. Dedicated scenario manifest: approval, backup, recovery, evidence plan, cleanup, post-recovery verification. Obey per-family budgets (e.g. 1 reset/reboot per case; power off only in a dedicated case with verified power-restore). |
| R4 irreversible/unknown | Prohibited until classified | Never auto. Record `UNCLASSIFIED`/`BLOCKED`/`SPEC_GAP` or a defect if it should be safely testable. |

Unknown labels are never assumed safe. Power Off is the final destructive machine case and
requires an independently verified power-restore path.

### 5.2 Oracles

Use the **oracle classes** and the **per-feature oracle policy** from `agentic-oracle-catalog.md`
(UI / REST-visible / FTP-visible / Filesystem-visible / Diagnostics+logs / State refs / A/V
signal; plus the primary/fallback/weak-forbidden policy per feature area). The existing
`c64scope/src/oraclePolicy.ts` already implements `classifyRun`, `checkCorroboration` (≥2 oracle
classes for non-read-only outcomes), and `detectWeakPatterns` (single-toast, single-screenshot,
A/V-only, etc.) — **reuse it as the oracle engine**. Do not introduce a separate "Level 1–5"
hierarchy; if you need to talk about oracle strength, talk about the named classes.

App-driven fresh-readback (capture original → mutate via UI → force an app-supported refresh /
reload / re-entry / relaunch → re-read → confirm the value is not merely optimistic local state →
restore → re-read) is the **method** for proving C64 config round-trips; express its result in
terms of the REST-visible / State-ref oracle classes.

### 5.3 Controller

The controller interface is `agentic-controller-contract.md`, implemented for Android by the
existing `c64scope/src/validation/droidmindClient.ts` (`DroidmindClient`: an MCP stdio client
over `@modelcontextprotocol/sdk` that wraps DroidMind with `startApp/stopApp/tap/swipe/pressKey/
inputText/shell/screenshotToFile/listDevices`). **Reuse and extend `DroidmindClient`**; do not
hand-roll a new `MobileController` interface that drifts from the contract. Where the runner code
needs a typed controller seam, name it after the contract and have `DroidmindClient` satisfy it.

### 5.4 Failure classes and result statuses

Express run-level failure classification with the canonical classes used across the harness:
`product_failure` / `infrastructure_failure` (a.k.a. lab/runtime) / `inconclusive`
(`c64scope-spec.md`, `agentic-android-runtime-contract.md`).

Per-CTA result statuses **extend** the `full-app-coverage` status vocabulary (`PASS`/`FAIL`/
`BLOCKED`) with the finer states this program needs: `INCONCLUSIVE`, `NOT_PRESENT`, `SPEC_GAP`,
`UNCLASSIFIED`, `CALIBRATION_ONLY`. Only `PASS` counts as passed coverage. A CTA is **not** passed
merely because it was visible, the runner clicked it, the app did not crash, an existing test
covers it, it passed in demo mode, it passed on U64 after failing on C64U, C64Bridge performed
the action, or the UI changed without proof of the expected state.

## 6. Reuse-first engineering mandate (what to reuse vs. build, and where it lives)

### 6.1 Placement: extend `c64scope`, do not greenfield `scripts/physical-cta/`

The earlier draft proposed a brand-new package at `scripts/physical-cta/`. **Do not.** It would
duplicate ~40–50% of `c64scope/`, fragment the harness across two locations, and re-introduce the
raw-adb/raw-REST control paths this program forbids (Section 8). Instead:

- Add the new CTA-layer modules under the existing package, e.g. `c64scope/src/cta/` (census,
  fingerprint, reconciliation, state graph, keypad-state machine, coverage accounting, replay).
- Add new entry-point runners alongside the existing ones (`fullAppCoverageExecutor.ts`,
  `autonomousValidation.ts`, `hilEvidenceRun.ts`) following the same pattern.
- Add `scope:cta:*` npm scripts mirroring the existing `scope:full-coverage` / `scope:hil:*` /
  `scope:preflight` naming (Section 9), wired through the root `package.json` like the other
  `scope:*` scripts.
- Put unit tests in the package's existing test setup (`c64scope` has `test` / `test:coverage` /
  `check`); run them via `npm run scope:test` / `npm run scope:check`.

If, after reading the code, you find a concrete reason the CTA layer cannot live in `c64scope`
(for example a packaging or dependency constraint), record a written architectural decision
explaining why, what alternative location you chose, and how it still reuses `DroidmindClient`,
`sessionStore`, and `oraclePolicy`. Do not relocate merely for convenience.

### 6.2 Reuse map (build on these — do not reimplement)

| Capability | Reuse this | Notes |
| --- | --- | --- |
| Android control (the MobileController) | `c64scope/src/validation/droidmindClient.ts` | DroidMind MCP stdio client. The load-bearing piece — already exists. |
| UI inspection primitives | `appFirstUi.ts`, `appFirstPrimitives.ts` | uiautomator-XML → `UiNode[]`, finders, route nav. Extend for fingerprinting/scroll. |
| Risk/safety budget gate | `exploration.ts` `shouldRefuseAction()` + `ExplorationSafety` | Extend with R0–R4 refinement + per-family budgets. |
| Oracle engine | `oraclePolicy.ts` (`classifyRun`, `checkCorroboration`, `detectWeakPatterns`) | Already richer than a generic hierarchy. Reuse. |
| Session / evidence packaging | `sessionStore.ts` (zod `session.json`: timeline/evidence/assertions/capture, `summary.md`) | Reuse as the per-run evidence store. Reuse its artifact root. |
| C64Bridge justification enforcement | `sessionStore.ts` bridge-justification + `runner.ts` `collectProductPolicyViolations` | Already enforces reason + justification + product-track gating. Extend with the reason codes in Section 8.3. |
| Preflight / device identity | `preflight.ts`, `deviceRegistry.ts`, `hardware-proof.json` | Reuse for environment capture. Add the MCP-capability probe (gap, below). |
| Executor / manifest pattern | `fullAppCoverageExecutor.ts` | Reuse the manifest-emission pattern; fix the "documented-but-absent artifact" defect (Section 7). |
| A/V capture + screen-record | `hilEvidenceRun.ts`, c64scope `scope_capture`/`scope_assert` tool groups | Reuse for playback/A/V cases. |
| Seed/PRNG, action-timeout, watchdog policy | fuzz spine: `SeededRng` (mulberry32), `withTimeout`, watchdog decision logic, `fuzzBackend.ts` backoff | Controller-agnostic pure logic — port into the CTA layer. |
| Issue/root-cause signature grouping | `chaosRunner.fuzz.ts` `buildSignature`/`buildGroupId` + `scripts/fuzzClassifier.mjs` | Operates on a JSON report schema — portable. Reuse for issue groups. |
| Report rendering / artifact merge | `scripts/fuzzReportUtils.mjs`, `scripts/fuzzArtifactMergeUtils.mjs` | JSON-schema-driven — reuse the renderers and naming/merge scheme. |
| Launch evidence | `scripts/startup/collect-android-startup-baseline.mjs` | Reference shape for launch logcat + `startup-baseline.json`. |
| Local fixtures + staging | `npm run fixtures:local-source` → `tests/fixtures/local-source-assets`; `scripts/startup/stage-local-assets-adb.sh` (stages to `/sdcard/Download/c64commander-assets`, verifies `.sid/.mod/.crt/.prg/.d64/.d71/.d81/Songlengths.md5`) | Reuse for media fixtures; do not invent fixture generation. |
| Performance prior art | `hil:playback-volume-latency` runner + `docs/testing/playback-volume-latency.md` + `test:perf:*` + `test-results/hvsc-android-benchmark` | Reuse for latency / request-count / HVSC benchmarks. |

### 6.3 Genuine gaps to build (this is the program's net-new value)

The audit confirmed `c64scope` lacks these; build them in `c64scope/src/cta/`:

1. **Scroll-to-fixed-point CTA census** with virtualized-list logical-row identity (Section 11.4).
2. **Stable semantic control fingerprint** + **three-way inventory reconciliation**
   (documented vs. static vs. runtime) (Sections 11.2, 11.6).
3. **State graph** with deterministic BFS / ordered-DFS traversal and bounded backtracking
   (Section 12).
4. **Checkpoint/resume journal** so a run resumes without repeating destructive setup.
5. **Per-CTA coverage accounting** (`coverage.csv` + `coverage.json`) — the existing harness is
   per-case/per-feature only.
6. **Keypad-state machine** distinguishing `DISCOVERED` / `KEYPAD_REACHABLE` /
   `KEYPAD_ACTIVATABLE` / `TOUCH_ACTIVATABLE` (Section 15).
7. **Deterministic recorded-action replay.** Note the fuzz runner's "replay" is **seed-only**
   (re-run the same seed) — there is no executable replay artifact, and on a physical device
   seed determinism is weak. So a recorded semantic-action replay is genuinely net-new and
   required (Section 32).
8. **True bounded successful-artifact retention.** Note `FUZZ_RETAIN_SUCCESS` is plumbed but
   never consumed in the fuzz runner; the only existing bounds are per-issue-group example caps
   and a quality-gate delete. Implement a real "keep last N successful" prune for this runner.
9. **MCP-capability discovery** → `mcp-capabilities.json`: at startup, discover the DroidMind MCP
   tool schemas, map them to required controller capabilities, and fail preflight if a required
   capability is missing. Do not fall back to raw ADB for app interaction. (`preflight.ts` checks
   node/adb/device/app-installed but does not yet do MCP-tool-schema discovery.)

Use a fixed default seed. Randomness may reorder deterministic execution only; it must never
choose an undefined or unsafe action.

### 6.4 Language and toolchain

Implement in **TypeScript** on the repository's pinned toolchain: **Node 24** (`.nvmrc` = `24`,
`engines` `>=24 <25`), package manager **npm** (`package-lock.json`; no pnpm/yarn). Reuse
`c64scope`'s existing `@modelcontextprotocol/sdk` + `zod` dependencies. Do not add a Python
component; the existing harness is TypeScript and the controller is already a TS MCP client.

## 7. Extend the `full-app-coverage` program — one cohesive coverage spine

`full-app-coverage` already defines a coverage taxonomy and schemas. Extend them; do not fork a
parallel taxonomy.

- **Feature spine.** Reuse the `F001…F023` feature IDs and their page grouping
  (Shell/Nav/Home/Disks/Play/Config/Settings/Docs/Cross-cutting). Every discovered CTA maps to
  exactly one `F`-feature; mint per-CTA child IDs under each (e.g. `F003.C07`). CTAs that map to
  no existing feature are reported as **"Found but undocumented"** and proposed as new features.
- **Catalog.** Reuse the `feature-test-catalog.md` 9-column schema (`Preconditions | App-Driven
  Test Approach | Required Tools | Evidence | Expected Outcomes/Pass | Likely Failure Modes |
  Lock/Persistence Impact | Dependency Flags`). Extend it **downward** to per-CTA rows with a
  per-row status — the missing granularity is exactly the gap (`tool-gap-analysis.md` flagged
  "mutation round-trips and persistence deltas" plus "UI-XML snapshots on failure" as the next
  step; quote that as the seam you are extending).
- **Status matrix.** Reuse the dual representation (human table with `Priority` P0/P1/P2 + `Area`
  + `Prompt File` + `Last Run ID` + `Evidence Path` + `Result`, and the compact JSON
  `{id,result,lastRunId,prompt}`). Extend the result vocabulary per Section 5.4.
- **Per-feature prompt template.** Reuse the 10-section template (Feature Under Test →
  Preconditions → MCP Server Roles → App-First Policy → Deterministic Execution Steps →
  Intermediate Assertions → Evidence Requirements → PASS/FAIL/BLOCKED Criteria → Artifact Output
  Contract → Post-Run Analysis) for any per-feature prompts you emit, and the per-run artifact
  contract (`result.json`, `steps.json`, `evidence-map.json`, `post-run-analysis.md`) with the
  root-cause enum (`prompt|tool|app|infrastructure|observability|environment|determinism|missing
  reset capability`).
- **Run IDs.** Reuse `pt-<UTC>Z` for individual runs and `fac-<UTC>Z-<purpose>` for labeled
  runs; use an analogous `cta-<UTC>Z-<purpose>` for this program's runs.
- **Do not repeat the known defect.** `full-app-coverage` *referenced* executor manifests and
  converged evidence dirs (`fac-…-executor-manifest.json/.md`, `fac-…-mcp-probe.json`, converged
  `pt-*` dirs) that were **never committed to disk**. Every artifact this program names must be
  actually emitted and verifiable; a documented-but-absent artifact is a defect, not coverage.

Place this program's docs under `docs/testing/agentic-tests/full-cta-coverage/` mirroring
`full-app-coverage/` (`feature-inventory` extension, per-CTA catalog, status matrix,
reconciliation, iteration log, `runs/`). State explicitly in the README how this program relates
to `full-app-coverage`: it is the **CTA-granularity, deep-assertion, scalable continuation** of
the same coverage spine, not a competing program.

## 8. Control boundaries

### 8.1 DroidMind is the only Android **product-action** control path

Every Android action that exercises the product (selecting the device, installing/launching/
stopping/foregrounding/backgrounding the app, inspecting the UI hierarchy, discovering controls,
tapping/long-pressing/swiping/scrolling, injecting D-pad/T9/Back/Menu/soft-key/Call/Star/Pound
keys, entering text, using Android pickers and the share sheet, lock/sleep/wake/unlock,
orientation, screenshots, reading notifications) must go through the controller (DroidMind via
`DroidmindClient`).

Prohibited as **product-action** paths: raw `adb shell input`, raw UIAutomator, Appium, direct
Maestro as the certification driver, Playwright/CDP control of the WebView, JS injection, DOM
mutation, direct localStorage/IndexedDB/sessionStorage mutation, calling app internals to trigger
a CTA, test-only routes as a substitute for user workflows, and coordinate-only random clicking.

**Reconcile with the existing runner's raw paths.** Today `c64scope/src/validation/helpers.ts`
uses raw `adb()` and raw `curl`/`fetch` against the C64U (`c64uGet`, `runPrgOnC64u`,
`readC64Memory`). Part of the gap work is to **route product actions through `DroidmindClient`**
and reclassify the raw paths:

- Raw **adb** is permitted **only for infrastructure** (logcat slices, file staging, device
  identity) consistent with `agentic-android-runtime-contract.md` ("controller tooling may gather
  equivalent runtime logs without using ADB directly … but the resulting evidence must preserve
  the same attribution fields"). It must never perform or verify a product action.
- Raw **REST/FTP/Telnet** against the C64 target is **C64Bridge-class gap-fill** (Section 8.3),
  never product validation.

If DroidMind lacks a required capability, record the capability gap (and fail preflight per
Section 6.3). Do not silently substitute another controller. A bare `adb devices` check is
allowed only to bootstrap the controller, never to verify app behavior.

### 8.2 App-first C64 control

C64 Commander is the product under test. Perform normal machine control, configuration, playback,
playlist/disk/stream management, device switching, settings, diagnostics, and file-source
browsing **through the app UI on the Pixel 4**. Do not perform a normal product action directly
against `c64u`/`u64` (no raw REST/FTP/Telnet from the runner, no direct filesystem changes, no
C64Bridge action that replaces the app action under test).

### 8.3 C64Bridge exception policy

C64Bridge is not a second control path for ordinary testing. The generic crawler must never
invoke it automatically; its use requires an explicit scenario declaration or a recorded agent
decision. Permitted reason codes (extending the existing bridge-justification enforcement in
`sessionStore.ts`/`runner.ts`): `READBACK_GAP`, `RAM_STATE_ASSERTION`, `FIXTURE_STAGING`,
`STREAM_CALIBRATION`, `TARGET_HEALTH_PROBE`, `EMERGENCY_RECOVERY`, `INFRASTRUCTURE_CALIBRATION`.

Every C64Bridge call records: UTC timestamp, test case, reason code, exact operation,
read-only?, why the app path was insufficient, state before/after, and whether the result is
still valid product evidence. An app-driven action may *pass* with a C64Bridge read-only
assertion as supporting evidence. A case in which C64Bridge performed the action under test
cannot pass as product validation — mark it `BLOCKED`, `INCONCLUSIVE`, or `CALIBRATION_ONLY`.

### 8.4 C64Scope responsibilities

Use C64Scope for C64 video/audio evidence, signal-sensitive assertions, playback proof,
LED/screen/audio/pause/reset/menu observations when visible in the captured stream, session-level
artifact packaging, the unified timeline, and app-action↔physical-behavior correlation. C64Scope
must not control the Android app or replace app actions, and (per `c64scope-spec.md`) must not
call the other peer servers internally. Start a C64Scope session for each major suite or isolated
high-risk case, recording at least: suite/case start, target selection, app launch/restart, CTA
activation, device-bound mutation, playback transition, disk mount/eject, lifecycle transition,
failure detection, diagnostics export, C64Bridge use, recovery, case/suite completion. After every
meaningful controller or C64Bridge action, record one semantic step via `scope_session.record_step`
(reuse `sessionStore`). The local runner log holds every low-level interaction; the C64Scope
timeline may collapse repeated navigation keys but must preserve meaningful state transitions.

## 9. Runner commands

Add `scope:cta:*` scripts (root `package.json` delegating into `c64scope`, mirroring the existing
`scope:*` scripts). At minimum provide equivalents of:

- `scope:cta:discover` — discover-only census for a route/scope (no mutation).
- `scope:cta` — full deterministic run.
- `scope:cta:resume` — resume from the checkpoint journal.
- `scope:cta:replay` — replay a recorded failure case.

The runner must support at least: `--device`, `--target c64u|u64`, `--discover-only`, `--routes`,
`--case`, `--resume`, `--replay`, `--run-id`, `--seed`, `--keypad`, `--touch-parity`,
`--risk-level`, `--artifact-dir`, `--retain-success`, `--verbose`. Reuse the existing runners'
env/flag conventions (e.g. `ANDROID_SERIAL`, `C64U_HOST`, `VALIDATION_TRACK`) where they already
exist rather than inventing new ones.

The LLM remains the orchestrator. The runner is an execution engine and MCP client; it must not
become a fourth MCP server and must not own the final release verdict.

## 10. Fixed laboratory configuration

Authoritative for this run.

### Android device
- Required device: **Pixel 4**, reachable through ADB, driven only via DroidMind. Android only.
- App package: **`uk.gleissner.c64commander`**, main activity `.MainActivity` (confirmed in
  `agentic-android-runtime-contract.md`).
- If multiple Pixel 4 devices are visible, use `ANDROID_SERIAL` when supplied; otherwise select
  the unique connected Pixel 4; if none is unique, record a hard environment blocker rather than
  choosing another device.

Discover and record (reuse `deviceRegistry.ts` + `collect-android-startup-baseline.mjs`):
Android serial, exact Pixel 4 model, Android version, security patch, display resolution/density,
orientation, font/display scale, battery-optimization state, free storage, and app version
name/code + Git SHA + build variant.

### C64 targets
- **Primary:** host `c64u`, password `pwd`. Primary target for all certification tests.
- **Fallback:** host `u64`, password empty. Use only when `c64u` is genuinely unavailable/unusable
  after evidence is captured. Never merge C64U and U64 into one undifferentiated pass. Label all
  U64 results `U64_FALLBACK`. A C64U-specific case cannot pass solely because it passed on U64.
  No U2 testing required.

### MCP servers (per `mcp-setup.md`)
DroidMind (owns all Pixel 4 interaction), C64Scope (`node c64scope/scripts/start.mjs`; A/V,
timeline, artifacts), C64Bridge (gap-fill only). Discover the actual MCP configuration from
`.mcp.json` and use its transport; do not invent an endpoint. Verify with the existing
`npm run agentic:mcp:check`.

## 11. Dynamic CTA discovery

The runtime UI is authoritative for what is present. The runner must dynamically discover controls
rather than rely on a hardcoded CTA list. Reuse `appFirstUi.ts` parsing; add the census/fingerprint
layer.

### 11.1 Reconcile three inventories
1. Documented inventory (`cta-inventory.md` per-page checklist — counts are tripwires).
2. Static source inventory (buttons, links, inputs, selects, switches, sliders, tabs, menu items,
   dialog/bottom-sheet actions, accessibility labels, test IDs, feature-flag conditions,
   data-dependent branches). Supplementary only; a source-discovered CTA is not passed until
   exercised in the production candidate.
3. Runtime DroidMind UI inventory.

### 11.2 Runtime control fingerprint
For each control capture where available: route, screen title, active overlay stack, parent
section/group, role, control type, visible label, accessibility label, content description,
resource ID, test ID, text, bounds, enabled/selected/checked state, value, min/max,
scroll-container identity, sibling position, stable ancestor identity, feature state, device
connection state, data-fixture state. Build a stable fingerprint from **semantic** attributes;
bounds and sibling position are fallback components only. Never identify a CTA solely by
coordinates.

### 11.3 Active-scope traversal
Treat the active scope as: (1) topmost Android system dialog/picker/menu/listbox/app-modal/
bottom-sheet; else (2) the routed page; else (3) persistent navigation. When an overlay opens,
suspend the underlying page, discover the overlay's controls, exercise or dismiss per its
contract, confirm focus returns to the invoking control, then resume.

### 11.4 Scroll-to-fixed-point discovery
For each scrollable scope: capture visible controls, scroll by a bounded amount with overlap,
re-capture, deduplicate by stable fingerprint, continue until two consecutive scrolls yield
nothing new and the end condition is observed, then reverse to detect sticky controls and restore
position. Handle virtualized lists by **logical row identity**, not recycled view instances.

### 11.5 Dynamic state discovery
Exercise the states that reveal conditional controls: connected/disconnected; C64U/U64;
one/multiple saved devices; empty/populated playlist; empty/populated disk library; no
playback/playing/paused/final track; shuffle on/off; repeat on/off; mounted/unmounted disks;
single/multi-disk groups; HVSC unavailable/installing/installed/failed/reset; feature flag on/off;
debug logging on/off; keypad on/off; theme variants; display profiles; portrait/landscape;
modal/bottom-sheet; valid/invalid input; enabled/disabled; dirty/clean config; device busy;
discovery prompt present/absent; demo prompt present/absent.

### 11.6 Inventory reconciliation
Produce, with an explanation for every count difference: documented-but-not-found,
found-but-undocumented, changed type/label/route/group, conditional-only, duplicate accessible
identity, missing accessible identity, unreachable-by-keypad, reachable-but-not-activatable,
touch-only, stale/detached, permanently disabled, unknown risk. Documented page counts are
tripwires, not proof.

## 12. State graph and deterministic exploration

Represent the app as a state graph. A node distinguishes: route, active overlay, target device,
connection state, feature flags, page mode, playback state, mounted-drive state, relevant list
population, orientation, display profile, theme. An edge is one user action. Use deterministic
BFS or ordered DFS with bounded backtracking. Persist a checkpoint journal after every case so a
run resumes without repeating destructive setup.

Exhaustiveness means: every CTA discovered; every CTA receives its applicable generic contract
tests; every documented user flow executed; every control value/option covered where safe;
relevant state-dependent appearances covered; required interaction combinations covered; known
risk sequences explicitly tested. It does **not** mean enumerating all permutations of unrelated
actions.

## 13. Generic control contracts

For every applicable CTA verify: runtime discovery; visibility; full on-screen presentation;
enabled/correctly-disabled; keypad reachability; keypad activation; touch-activation parity;
correct UI result; correct app-local result; correct C64 result where applicable; error behavior;
cancellation; repeated activation; busy-state behavior; persistence; restoration; evidence
availability.

Per control type, test:

- **Buttons:** single / Center-OK / Call-Send / touch activation; repeated; rapid-while-busy;
  disabled attempt; confirm cancel/accept; correct progress indication; no duplicate request or
  duplicated side effect.
- **Checkboxes & switches:** off→on, on→off; keypad and touch toggle; route change; relaunch when
  persistence expected; dependency-driven disabled state; restoration.
- **Selects & segmented controls:** open; option navigation; confirm; cancel; underlying focus
  stable; value persistence; device application; restoration. Test every option where safe.
- **Sliders:** min; max; one intermediate; single Left/Right; repeated-key burst; Up/Down move
  focus without changing value; visible value label; accessibility value; request coalescing;
  device effect; restoration.
- **Text/password/number/search inputs:** valid; empty; whitespace; boundary length; invalid;
  boundary number; out-of-range; unicode where applicable; delete; keypad/T9 entry; touch-keyboard
  entry; focus exit/return; persistence; validation message. The lab password `pwd` may appear in
  config, but diagnostics must still demonstrate production-grade password redaction.
- **Lists & libraries:** empty; one; many; large; duplicate names; duplicate paths; unicode; deep
  paths; long names; filter with zero/one/many results; select all; deselect all; individual
  selection; bulk action; view all; item menu; persistence.
- **Links & Android intents:** correct destination; correct intent; return to app; state
  preservation; keypad and touch activation; error handling when no handler exists.

## 14. Keypad-first traversal

Use DroidMind to inject **actual** Android key events (reuse `DroidmindClient.pressKey`). Required
keys: D-pad Up/Down/Left/Right/Center, Back, Call, Menu, Left/Right soft keys, digits 0–9, Star,
Pound, Enter, Escape where supported. (Mappings confirmed in `keyboard-input.md` /
`cta-inventory.md` §1: digits 1–6 jump to the six tabs, Star → Diagnostics, Pound → Device
Switcher, Menu → contextual menu with Quick Menu fallback.)

Do not mark keypad reachability passed merely because a control exists in the hierarchy. For each
scope: enter key-navigation modality; observe the selected control via hierarchy/focus
metadata/screenshots/key diagnostics; traverse Up/Down until the ring wraps, recording each unique
selected control; descend with Center; ascend with Back; exercise leaf activation per risk; verify
overlays take navigation ownership and focus returns after dismissal; confirm no enabled CTA is
skipped, disabled CTAs are not activated, and removed controls leave no stale focus entry.

Verify: exactly one selected-control highlight; correct group-scope indication; guidance bar;
Up/Down wrap; Center enters group or activates leaf; Back dismisses→exits→ascends→navigates;
Escape never route-navigates; Left/Right adjust value controls; Up/Down do not change slider
value; dropdown ownership; T9 input; digits 1–6 page shortcuts outside text fields; Star opens
Diagnostics outside text fields; Pound opens Device Switcher outside text fields; Menu opens
contextual/Quick Menu; touch returns to pointer modality immediately; selected controls scroll
fully into view; dynamic insertion/removal preserves a valid ring; hardware-Back interception.

The runner distinguishes `DISCOVERED` / `KEYPAD_REACHABLE` / `KEYPAD_ACTIVATABLE` /
`TOUCH_ACTIVATABLE`. A touch pass cannot compensate for a keypad failure.

## 15. Pixel 4 versus Callback 8020 scope

The production use case includes the Callback 8020 keypad-first form factor, but this run uses the
Pixel 4. Therefore: use DroidMind key injection to exercise Callback keypad key codes and semantic
mappings; set the display profile to **Small display** for the primary compact-layout pass and
also test the Pixel 4's automatic profile; test portrait and landscape; test lock/sleep/doze/
background/foreground/process-recreation. Do not claim Pixel 4 testing proves physical hinge,
flip-close, keypad tactility, or Callback OEM power-policy behavior — list those as residual
hardware-certification gaps. Keypad-navigation correctness, small-display layout, and Android
lifecycle behavior remain mandatory.

## 16. Runner validation before broad execution

Before trusting the runner: run TypeScript checks and lint (`npm run scope:check`); add unit
tests (in the `c64scope` test setup) for UI-fingerprint generation, deduplication,
scroll-to-fixed-point, the R0–R4↔action-class mapping + budget gate, state-graph identity,
stale-element recovery, action timeout, checkpoint resume, replay generation, secret redaction,
and issue grouping. Then run a discover-only pass on Docs; a read-only canary on Docs and
Licenses; a keypad canary on the persistent tab bar; a safe local-setting canary with restore;
and compare canary output against `cta-inventory.md`. Fix runner defects before any destructive or
hardware-coupled case.

Do not modify the production app to make a test pass; introduce no hidden test routes, backdoors,
state injection, action bypasses, or production behavior changes. Missing accessibility metadata
or unstable identity is a testability/accessibility finding, not a reason to weaken the test.

## 17. Connection policy (C64U-first)

Configure the primary target through the app UI via DroidMind (host `c64u`, password `pwd`) using
the app's Save and Connect flow. Verify via app status, app diagnostics, a subsequent app-driven
info refresh, and C64Scope when physical output is relevant. Respect the connection state machine
(`agentic-android-runtime-contract.md`: `UNKNOWN`/`DISCOVERING`/`REAL_CONNECTED`/`DEMO_ACTIVE`/
`OFFLINE_NO_DEMO`); if `DISCOVERING`, wait for a terminal state before judging page completeness;
handle the demo interstitial before page assertions.

If `c64u` fails: preserve screenshots/logs; export app diagnostics; retry through the app after a
bounded refresh + relaunch; record the connection timeline; one C64Bridge `TARGET_HEALTH_PROBE`
may determine whether `c64u` is reachable. If C64Bridge can reach `c64u` while the app cannot,
record an **application defect** (not an environment issue). Use `u64` only after the C64U result
is preserved. If C64U becomes unstable during an app action: capture the exact preceding
interactions + app diagnostics + C64Scope evidence; use C64Bridge only for health probe or
emergency recovery; create a defect candidate even if the device later recovers; continue safe
independent testing after recovery.

## 18. Baseline and restoration ledger

Before mutation, capture and record in `state-ledger.json`: app state, saved-device state, app
settings, playlist/disk-library state, playback state, drive/mount state, C64 config via
app-visible fresh reads, flash-related state where possible, RAM/REU markers when required, a
C64Scope baseline, and an exported diagnostics bundle. Every mutation appends original value, new
value, mutation method, expected effect, observed effect, restoration method, restoration result.
The run is incomplete until all restorable changes are restored (Section 34, cleanup).

## 19–28. Exhaustive page-by-page coverage

Each page below is tested at CTA granularity. These sections **extend** `agentic-feature-surface.md`
(scope + repo anchors), `agentic-action-model.md` (per-route preconditions/postconditions/recovery/
escape), `agentic-coverage-matrix.md` (testability + primary oracle + safety class), and
`cta-inventory.md` (the per-page CTA checklist). Discover CTAs dynamically; map each to its
`F`-feature; apply the generic contracts (Section 13), keypad traversal (Section 14), the safety
budgets (Section 5.1), and the per-feature oracle policy (Section 5.2).

### 19. Global application coverage (every main page)
Unified health badge; details view; Device Switcher; all six footer tabs; digits 1–6; Star and
Pound shortcuts; Menu and Quick Menu; Back behavior; orientation; display profile; theme;
status-bar/navigation-bar settings; background/foreground; screenshot + hierarchy capture;
connection-state accuracy; current-target identity; diagnostics entry; touch-after-keypad and
keypad-after-touch. Test cross-page synchronization for: device connection, device switching,
drive state, mounted disk, playback state, volume, config values, dirty state, feature flags,
HVSC state, diagnostics activity, demo mode.

### 20. Home page (`/`, anchors `src/pages/HomePage.tsx`, `src/pages/home/**`)
Discover and test every Home CTA. At minimum:
- **System information:** expand/collapse; app version; device identity; firmware; build info.
- **Machine actions** (each: cancel/confirm; busy; repeated; conflicting attempt; actual machine
  behavior; recovery; state refresh): Reset, Reboot, Pause, Resume, Menu, Save RAM, Load RAM,
  Save REU, Power Cycle, Reboot-with-clear-memory, Power Off, and every feature-gated Telnet
  action present. Obey the destructive budgets (1 reset/reboot per case; power off only in a
  dedicated case with verified power-restore). Use known RAM markers where safe to distinguish
  normal reboot from clear-memory reboot semantics (see AOQ-002).
- **RAM and REU:** select RAM folder via Android SAF (reuse `FolderPicker`); persisted permission;
  Save RAM; file existence/size; Load valid RAM; invalid size; corrupt image; permission
  revocation; missing folder; duplicate filename; Save REU; Load into REU; preload on startup;
  background during operation; cancellation; recovery.
- **Quick configuration:** every control in every rendered category — selects (every option where
  safe), sliders (min/max/intermediate/key-repeat/restoration), toggles (both states +
  restoration). Use C64Scope for visible/audible effects.
- **Drives, printer, SID, lighting, streams:** every control for Drive A, Drive B, Soft IEC,
  printer, SID sockets, UltiSID, audio mixer, case lighting, keyboard lighting, stream endpoints,
  stream start/stop. Verify consistency with Disks and Config. (Printer/stream postconditions:
  AOQ-003.)
- **Device and app configurations:** Save to flash; Load from flash; Reset device configuration;
  Save to App; Load from App; Revert Changes; Manage App Configs; rename; delete; empty state;
  dirty-state behavior; advanced gated actions when present. Back up before destructive config
  cases (reuse test-owned config names only).

### 21. Play page (`/play`, anchors `src/pages/PlayFilesPage.tsx`, `src/pages/playFiles/**`)
Discover and test every Play CTA and state.
- **Sources** — test all four real sources: **Local, C64U, HVSC, CommoServe** (Section 3.1). For
  each source browser: open chooser; root; up; refresh; folder open; empty folder; loading; error;
  filter; file-type filter; individual selection; select all; deselect all; recursive folder; add
  selected; cancel; back; deep path; long filename; unicode; duplicates; connection loss; retry.
  Local browsing uses DroidMind for the Android picker + staged fixtures; C64U/CommoServe browsing
  goes through the app source, not raw FTP/HTTP.
- **Test media** — derive supported extensions from current code. Reuse `npm run
  fixtures:local-source` (`tests/fixtures/local-source-assets`) and stage via
  `scripts/startup/stage-local-assets-adb.sh` (infra staging; not a product action). Prepare valid
  and invalid fixtures for every supported type where supported: SID, multi-subsong SID, PSID,
  RSID, multi-SID, Windows-1252 metadata, MOD, PRG, CRT, supported disk images, zero-byte,
  truncated, unsupported extension, long filename, unicode filename, duplicate-in-different-folders,
  deep path, large file. Use existing C64-side fixtures where available; a one-time C64Bridge
  `FIXTURE_STAGING` op is permitted only when no app-supported route exists.
- **Playlist:** empty; add items; add more; filter; every type filter; select all; deselect all;
  individual selection; remove selected; clear; View All; item activation; item menu; duration
  override if present; subsong selection if present; current item; mixed-source order; reload;
  session restore; large list.
- **Playback:** play; stop; pause; resume; previous; next; rapid prev/next; play another row while
  active; empty-playlist activation; first/middle/final item; repeat off/on; shuffle off/on;
  reshuffle; single item; mixed formats; disk transitions; KERNAL autostart; DMA autostart. Use
  C64Scope to verify actual C64 output and transition order.
- **Volume and mute:** min; max; intermediate; fast adjustment; held D-pad; mute; unmute; pause/
  resume; mute-while-paused; change-volume-while-muted; rapid mute/slider race; route change;
  background/return; restoration.
- **Duration and songlengths:** default duration; valid; invalid; zero; boundaries; songlength
  file selection; change file; match; no match; subsong-specific duration; relaunch persistence;
  auto-advance fallback.
- **Background playback (release-critical):** run deterministic playlists through foreground,
  Android Home/background, screen lock, sleep/doze, wake, unlock, orientation change, temporary
  network interruption, C64 reboot, and process recreation where contractually supported. Cover
  repeat on/off, shuffle on/off, ≥3 tracks, mixed-source, multi-subsong SID, disk-image transition.
  Execute ≥30 accelerated automatic transitions and one two-hour locked/sleeping soak. A passing
  Android background case needs runtime evidence that the background path was **armed**
  (`backgroundAutoSkipDue` / background-execution logs), not just that the playlist later advanced
  (`agentic-android-runtime-contract.md`). C64Scope must prove expected order, no missed/duplicate
  transition, no stalled timer, no stale clock, correct final-item behavior.
- **HVSC:** not installed; download; stop/cancel; retry; ingest; reindex; check for update; update;
  reset; browse; play; background during download; lock during ingest; network loss; corrupt
  archive; insufficient storage; process death; relaunch; version and item count; search. Verify
  the production Android native ingestion path. Respect the HVSC budget (one full cycle + one
  retry, AOQ-007).

### 22. Disks page (`/disks`, anchors `src/pages/DisksPage.tsx`, `src/components/disks/HomeDiskManager.tsx`)
- **Drives (Drive A, Drive B, Soft IEC):** status; mount; eject; reset; power on; power off; bus
  ID; drive type; default path; disabled state; timeout; connection loss; refresh.
- **Import (Local and C64U):** every supported disk extension; file; folder; recursive import;
  filter; invalid type; duplicate path; duplicate name; deep path; unicode; large collection;
  permission loss; C64U listing failure; retry without duplicates.
- **Library:** empty; filter; select all; deselect all; individual selection; bulk removal; View
  All; item menu; rename; set group; change group; remove; cancel; confirm; per-device persistence.
- **Grouped disks:** mount to Drive A; mount to Drive B; eject; previous; next; stable order;
  first/last boundaries; single-disk group; renamed disk; removed group member; delete mounted
  disk; eject failure during delete; device switch while mounted. Verify consistency across Home,
  Play, Disks. Use only test-owned disk namespaces for delete (safety policy).

### 23. Config page (`/config`, anchors `src/pages/ConfigBrowserPage.tsx`, `src/lib/config/**`)
Dynamic; do not use a fixed category list as the ceiling (see `[[config-page-must-render-all-rest]]`
guidance: render all of live `GET /v1/configs`; the C64U menu is a label source, not a gate).
- **Category discovery:** enumerate every category returned through the app; search; no-match
  search; expand; collapse; refresh; lazy loading; failure; retry; dynamic keypad-ring changes.
- **Every configuration item** — record category, device item name, app label, control type,
  original value, options, numeric bounds, read-only state, dependencies, capability requirements.
  For every safe item: reach via keypad; exercise the control contract; change via the app; observe
  the app action trace; force an app-driven fresh readback; verify UI convergence; use C64Scope for
  physical effects; use C64Bridge `READBACK_GAP` only for opaque/high-risk/disputed results;
  restore via the app; verify the restore via a fresh read. Test every select option where safe;
  both toggle states; slider min/max/intermediate/key-repeat; valid/invalid input;
  dependency-driven enablement. Keep broad config exploration read-only by default unless an item
  is known-safe (AOQ-004).
- **Special cases:** Audio Mixer Reset; solo each SID; disable solo; restore multi-channel state;
  navigate away while solo active; relaunch with solo state; Clock Sync (no deterministic tolerance
  claim beyond request/refresh — AOQ-005); DHCP enabled/disabled; read-only vs editable network
  fields; dirty state; disconnect during write; reconnect and refresh; rapid repeated changes;
  throttling; request ordering. For network changes that may disconnect the target: establish
  recovery first; change one field at a time; record old/new; restore immediately; mark BLOCKED
  rather than passing when safe recovery is unavailable.

### 24. Settings page (`/settings`, anchors `src/pages/SettingsPage.tsx`, `src/lib/config/**`, `src/lib/diagnostics/**`)
- **Display & Android presentation:** Auto/Light/Dark theme; Auto/Small/Standard/Large display
  profile; Auto/Portrait/Landscape orientation; hide status bar; hide navigation bar; supported
  combinations; relaunch persistence; rotation; lock/unlock; no clipping; no hidden CTA; no
  unintended horizontal scroll; no overlap with system UI/keyboard/guidance bar/tab bar/sheet
  footer.
- **Saved devices:** existing C64U device; add device; add U64; delete device; last-device
  protection; select; custom name; blank name; long name; host; HTTP/FTP/Telnet ports; password;
  Save and Connect; refresh; discovery; use discovered; save discovered; wrong host; wrong
  password; wrong port; offline; return online; startup discovery; resume discovery; multiple saved
  devices; every switching entry point. After every switch, verify actual target identity via
  app-driven fresh device info.
- **Demo mode:** automatic prompt; accept; reject; exit; reconnect to real target; relaunch;
  duplicate controls stay synchronized. Demo results never count as real-device evidence.
- **Diagnostics** (every entry point + control): app header; Settings; Star shortcut; Health;
  current device; Activity; Logs; Traces; Actions; Errors; filters; latency; config drift; history;
  saved-device rows; probe details; edit connection; Share current tab; Share All; Clear All cancel;
  Clear All confirm; close/reopen; empty export; large export; Android share cancellation; debug
  logging; persisted SAF diagnostics. Validate ZIP structure and redaction. Diagnostics export on
  Android writes `c64commander-diagnostics-${tab}.zip` to cache then invokes Share — a pass needs
  the requested tab, expected filename, cache-write/share result, and an attributable artifact path,
  not just the share sheet appearing (AOQ-006). Export diagnostics after: crash/ANR, C64
  instability, config-write failure, background-playback failure, native-picker failure, each major
  suite.
- **Settings transfer:** export; inspect JSON; verify no password; import valid; import malformed;
  import unsupported version; import partial; cancel picker; relaunch; restore baseline. Note
  settings export is a browser-style download (`c64commander-settings.json`), not the native Share
  API — do not assume diagnostics/settings completion semantics are identical.
- **Feature flags:** enumerate every flag in the current candidate; record default; turn off;
  verify dependent controls disappear/disable and leave no stale focus; turn on; test newly exposed
  controls; relaunch; restore production default.
- **Safety and throttling:** safety preset; relaxed-mode warning; cancel; confirm; every visible
  pacing/retry/backoff/concurrency/cooldown/circuit-breaker value; validation; persistence; actual
  behavior during controlled repeated operations. Increase load gradually; do not intentionally
  overload the C64 target. Do not weaken safety just to make a flaky case pass; only dedicated
  cases may change Device Safety (AOQ-009).
- **About & auxiliary routes:** About expansion; developer-mode unlock; build info; REST docs link;
  Open Source Licenses; close/return; unknown-route fallback; production absence of the Coverage
  Probe (`/__coverage__` is lab-only, never a product workflow); no route to any legacy unrouted
  player; CommoServe "Open archive browser".

### 25. Docs and Licenses (`/docs`, `/settings/open-source-licenses`)
For every accordion: expand; collapse; keypad; touch; scroll; focus restoration; content
visibility. For every external link: correct destination; Android intent; return to app; state
preservation. Compare documentation claims with actual behavior and report drift. UI-only oracle
suffices, plus error-log absence on load.

### 26. Android lifecycle and persistence matrix
Repeat applicable critical flows through: fresh install; upgrade from the previous production
version; warm launch; cold launch; route change; background/foreground; screen lock/unlock;
sleep/wake; orientation change; process recreation; force-stop + relaunch; Pixel 4 reboot;
temporary Wi-Fi loss; C64 reboot; low storage; SAF permission revocation; battery optimization
enabled/relaxed where supported. Verify persistence for: saved devices; password usability; theme;
display profile; orientation; feature flags; safety settings; playlist; playback session; disk
library; disk metadata/groups; app config snapshots; RAM folder; songlength file; HVSC state;
notifications; diagnostics settings. Reuse `collect-android-startup-baseline.mjs` for launch
evidence.

### 27. Failure injection (controlled, after the deterministic normal-user pass)
For: REST timeout/error as experienced through the app; FTP auth failure / unavailable / loss
during recursion; Telnet unavailable; C64 reboot during write / during playback; Wi-Fi loss; wrong
password; stale hostname; picker cancellation; revoked permission; missing local file; corrupt
media; invalid duration; invalid stream endpoint; insufficient storage; low memory where safely
reproducible; rapid repeated key/touch; conflicting machine actions; device switch during
operation; route change during operation; lock exactly when auto-advance is due; resume after
several elapsed deadlines. For each verify: clear message; correct severity; no false success; no
stale optimistic state; no duplicate retry; no unbounded retry; no request storm; no crash/ANR;
recoverable next action; correct state after recovery. Do **not** use chaos-style random fault
injection here — this is targeted, deterministic negative testing.

### 28. Layout, accessibility, performance, reliability
- **Layout/accessibility** (Auto and Small profiles, Light and Dark): every CTA fully revealable;
  visible focus; no text overlap; labels retain meaning; readable themes; dialog actions
  key-reachable; sheets scroll; footer actions visible; errors visible; keyboard does not cover the
  active field/submit; icon-only controls have useful labels; roles/values/checked/disabled
  exposed; usable touch targets; guidance/tab bars do not obscure content; no unreachable landscape
  region; full-screen mode causes no system conflicts. Capture representative screenshots per page
  in: Auto/portrait, Small/portrait, Small/landscape, Light, Dark.
- **Performance/reliability** (reuse `hil:playback-volume-latency`, `test:perf:*`, the
  `hvsc-android-benchmark` results, and `playback-volume-latency.md`): cold/warm start; time to
  usable Home; connection verification; route transitions; config-category load; source listing;
  recursive import; playlist/disk filtering; HVSC download+ingest; memory during HVSC and with a
  large playlist; CPU during playback; battery during the two-hour soak; network request count
  during sliders and repeated keys; rendering jank; crashes; ANRs. Exercise playlist scales (100;
  1,000; 10,000; 100,000) using repository fixture tooling — do not add 100,000 items by hand; if
  no production-representative fixture route exists, report that scale as unverified.

## 29. Timeouts and recovery

Reuse the fuzz spine's bounded timeouts, watchdog decision logic, and backoff tracker; tune
defaults per operation class: UI action, navigation, native picker, C64 operation, file operation,
long-running HVSC, progress watchdog, no-progress action count, suite timeout. When progress
stalls: capture UI hierarchy + screenshot + last interactions + DroidMind logs; export diagnostics
when possible; record C64Scope state; attempt structured recovery; if recovery fails, terminate
only that case, restore the app to a known route, and continue independent cases. Do not abort the
whole certification after the first defect.

## 30. Reuse from the fuzz runner — and what it is **not**

Reuse the controller-agnostic spine (Section 6.2): `SeededRng`, `withTimeout`, watchdog policy,
signature grouping (`buildSignature`/`buildGroupId`) + `fuzzClassifier.mjs`, report renderers,
last-N trace buffer, per-session manifest, stable artifact naming, the consolidated-merge scheme.
Correct the two overstated patterns: the fuzz runner's **replay is seed-only** (build real
recorded-action replay, Section 32) and its **successful-artifact retention is unimplemented**
(`FUZZ_RETAIN_SUCCESS` is plumbed but unused — implement a real prune).

Do **not** reuse: fuzz mode; mock C64 target; demo mode as the main target; weighted random action
selection; fault injection during the normal-user pass; random large text bursts; random route
navigation; random destructive activation; multiple parallel shards against the same physical
Android/C64; or treating failures as "expected" because a mock endpoint is absent. This runner is a
**deterministic normal-user surface explorer**, not a chaos runner. Because there is one Pixel 4
and one active C64 target, execute physical interactions serially with no concurrent UI shards
(offline report generation and static analysis may run concurrently).

## 31. Artifact structure

Write run artifacts through the existing `sessionStore` artifact root (today `c64scope/artifacts/`)
under a `cta-<UTC>Z-pixel4-<target>-<git_sha>/` run directory, and human-facing program docs under
`docs/testing/agentic-tests/full-cta-coverage/` (mirroring `full-app-coverage/`, including `runs/`
for committed manifests). Confirm the configured artifact root from `sessionStore`/the runner flags
rather than hard-coding a new `test-results/physical-cta/` tree; pick **one** location and document
it. Every named artifact must actually be emitted (do not repeat the documented-but-absent defect).

At minimum: `environment.json`; `mcp-capabilities.json`; `assumptions.md`; `spec-discrepancies.md`
(and any `AOQ`/`SPEC` IDs); `runner-version.json`; `inventory/documented.json`,
`inventory/static.json`, `inventory/runtime.json`, `inventory/reconciliation.md`;
`state-graph.json`; `state-ledger.json`; `actions.jsonl`; `cases.json`; `results.json`;
`coverage.csv`; `coverage.json`; `issue-groups.json`; `runner-summary.md`; `screenshots/`;
`ui-hierarchies/`; `droidmind-logs/`; `diagnostics/`; `c64scope/` (reusing `session.json` +
`summary.md` + capture artifacts); `c64bridge-usage.jsonl`; `replays/`; `defects/`;
`cleanup-report.md`; `final-report.md`; `release-decision.json`. Plus the per-feature run-folder
contract reused from `full-app-coverage` (`result.json`, `steps.json`, `evidence-map.json`,
`post-run-analysis.md`). Use UTC timestamps and stable case IDs.

## 32. Interaction log and replay

Record each action as one JSONL entry: run ID, suite ID, case ID, step, UTC timestamp, target,
route, overlay, action type, semantic target fingerprint, input method, key code where relevant,
pre-state signature, post-state signature, duration, result, retry count, screenshot ref,
UI-hierarchy ref, diagnostics ref, C64Scope event ref, error, recovery action. Never log typed
passwords or private field values (unit-test the redaction).

Every failure produces a deterministic **recorded-action** replay (`scope:cta:replay --run-id
<run> --case <case-id>`) capturing required target, required app state, required fixtures, required
feature flags, the exact semantic action sequence, timeouts, assertions, and cleanup. Do not use
coordinates as the only replay selector. (Seed-only replay is insufficient on physical hardware.)

## 33. Defect report (one Markdown file per defect)

Defect ID; title; severity; priority; release impact; first/last reproduced UTC; reproduction
rate; app version + SHA; Pixel 4 details; C64U/U64 details; target hostname; page; route; overlay;
CTA label; test ID or runtime fingerprint; feature flags; preconditions; fixture; exact keypad
sequence; exact DroidMind semantic actions; touch sequence; steps; expected result; actual result;
user impact; state before; state after; app diagnostics; DroidMind logs; C64Scope evidence;
C64Bridge evidence + reason code if used; screenshot; UI hierarchy; video/capture; recovery;
cleanup status; workaround; suspected component; evidence for the suspected component; remaining
uncertainty; replay command; root-cause class from the `full-app-coverage` enum
(`prompt|tool|app|infrastructure|observability|environment|determinism|missing reset capability`).
Do not state a root cause as fact unless proven. **A defect report must be self-sufficient: a
developer should be able to reproduce and fix it without asking you anything.**

### Severity
- **S0 catastrophic:** irreversible device damage; config loss without recovery; security
  disclosure; destructive corruption; device rendered unusable.
- **S1 critical:** crash/ANR in a normal flow; core page unusable; playback cannot continue
  reliably; C64 instability from normal app use; action reports success but does not happen;
  critical keypad CTA unreachable; mutation applied to the wrong saved device; background playback
  skips/doubles/stalls.
- **S2 major:** important flow requires touch despite keypad-first requirement; material device/UI
  divergence; persistence failure; broken source import; broken disk rotation; diagnostics or
  native-picker failure; difficult manual recovery.
- **S3 minor:** limited usability issue with a workaround; misleading status; non-blocking layout
  problem.
- **S4 cosmetic/docs:** visual inconsistency; copy issue; documentation drift.

## 34. Cleanup

At completion: stop playback; eject test disks; stop test streams; restore all modified C64 config
through the app; restore flash config; restore machine state; restore app settings; restore feature
flags; remove test playlist entries; remove test disk-library entries; remove test app snapshots;
remove temporary RAM/REU/media fixtures where appropriate; restore saved-device selection to
`c64u`; confirm `c64u` health; capture final app + device state; diff final state against baseline;
list every residual difference. Do not mark the run complete if the environment is not restored.

## 35. Runner documentation

`docs/testing/agentic-tests/full-cta-coverage/cta-runner.md` (sibling to the existing program docs)
must explain: purpose; how it extends `c64scope`; which existing modules it reuses
(`DroidmindClient`, `sessionStore`, `oraclePolicy`, `exploration`, `preflight`, `deviceRegistry`,
fuzz spine) and which modules are new; DroidMind MCP connection + capability discovery; C64Scope
integration; C64Bridge exception policy; installation; configuration; commands; discovery
algorithm; control fingerprint; state graph; risk model (with the R0–R4↔action-class mapping);
scenario format; oracle model; checkpoint/resume; replay; artifact format; adding a scenario;
handling a new control type; troubleshooting; safety rules; known limitations; Pixel 4 vs Callback
8020 limitations; example discover-only run; example full run; example failure replay. It must be
sufficient for a future engineer or LLM to run the test without reconstructing the architecture
from source.

## 36. Runner acceptance criteria

Accepted only if it: operates the Pixel 4 exclusively through DroidMind for product actions;
**reuses the existing `c64scope` modules rather than duplicating them** (a reviewer can point to
the reused `DroidmindClient`/`sessionStore`/`oraclePolicy`/`exploration`/`preflight` and the ported
fuzz spine); dynamically discovers runtime CTAs; traverses pages and overlays; handles scrolling
and virtualized lists; tests keypad reachability; supports touch parity; classifies risk against
the canonical action classes + budgets before activation; refuses unknown destructive actions;
records deterministic recorded-action replays; resumes from checkpoints; groups repeated failures;
produces machine-readable per-CTA coverage; preserves evidence; does not enable fuzz mode; does not
use a mock target for certification; **does not require the LLM to drive every CTA individually**;
has unit tests in the `c64scope` test setup; is documented; has been executed against the real
Pixel 4 and `c64u`; and has had its findings manually triaged through DroidMind.

## 37. Final report

`final-report.md` must contain: executive summary; GO / CONDITIONAL GO / NO-GO; build and
environment; Pixel 4 identification; DroidMind capability summary; C64U coverage; U64 fallback
coverage; C64Scope coverage; C64Bridge usage audit; runner implementation summary (emphasizing
reuse vs. new code); runner validation results; assumptions; specification discrepancies (with
AOQ/SPEC IDs); CTA inventory reconciliation; keypad coverage; touch parity; page-by-page results;
cross-page results; lifecycle results; background-playback results; two-hour soak result;
performance; C64 instability timeline; defects by severity; blocked and inconclusive cases; cleanup
result; Pixel 4 vs Callback 8020 residual risk; release-recommendation rationale; evidence index.

Report at least: documented CTAs; runtime-discovered CTAs; static-only CTAs; undocumented CTAs;
tested CTAs; passed CTAs; failed CTAs; blocked CTAs; spec gaps; unclassified CTAs;
keypad-reachable; keypad-activatable; touch-activatable; C64-bound CTAs; C64 effects verified;
config categories discovered; config rows discovered/changed/restored; flows completed; negative
paths completed; C64Bridge calls by reason; C64Scope sessions; crashes; ANRs; C64 instability
events. Cross-reference results back to the `full-app-coverage` feature IDs so the two programs read
as one coverage story.

## 38. Release gates

Recommend GO only when all hold: the runner satisfies its acceptance criteria (Section 36); every
current runtime CTA has an individual result; every documented normal user flow was executed;
critical CTAs are keypad-reachable and activatable; touch parity passed where applicable; C64-bound
actions were verified through the appropriate oracle classes; every changed value was restored; no
open S0/S1 defect; no unaccepted core-flow S2 defect; no critical case blocked; C64U critical flows
passed on `c64u`; U64 was not used to conceal a C64U failure; background playback passed accelerated
transitions; the two-hour Pixel 4 locked/sleeping soak passed; no crash/ANR; no uncontrolled
request storm; diagnostics export succeeded; fresh install passed; upgrade passed; cleanup passed;
final state matches baseline except for documented residual differences. A runner failure, missing
evidence, or unclassified high-risk CTA is release risk, not a pass. Continue after individual
defects whenever safe — preserve evidence, recover, and proceed with independent cases.
