# Handover 1 — Full-CTA-Coverage Certification Program

> **Read first, act second.** This handover lets a fresh agent resume the
> `docs/testing/agentic-tests/full-cta-coverage/prompt.md` program without
> re-deriving the state. It is a status snapshot + reuse map + ordered next
> steps, not a re-statement of the spec.

## 0. What this program is

Extend the existing `c64scope` agentic-test harness with a **scalable, CTA-granularity
(~500–1000 controls) certification layer** and use it (plus targeted agent-driven
cases) to certify the C64 Commander Android app for release against a real Pixel 4
and a real C64 Ultimate. The full specification is
`docs/testing/agentic-tests/full-cta-coverage/prompt.md` (already in-tree). The
architectural core is a **two-level execution model**: a deterministic headless
**bulk runner** (no LLM in the per-click loop) does the CTA census + generic
contracts; the LLM only handles the risky/ambiguous minority and triages the
runner's machine-readable output.

The single most important rule: **extend `c64scope`, do not greenfield a parallel
package**. Reuse `DroidmindClient`, `sessionStore`, `oraclePolicy`, `exploration`,
`preflight`, `deviceRegistry`, and the fuzz spine. Duplication is a defect.

## 1. Environment verified this session (2026-06-24)

| Target | Status | Evidence |
| --- | --- | --- |
| **Pixel 4** | READY | ADB-attached, serial `9B081FFAZ001WX`, Android 16 (matches `9B0` prefix rule). Driven only via DroidMind MCP. |
| **u64** | REACHABLE (preferred per AGENTS.md) | `GET http://u64/v1/info` → Ultimate 64 Elite, firmware 3.14e, FPGA 122, core 1.4B, unique_id `38C1BA`, no errors. |
| **c64u** | AUTH-GATED, not confirmed usable | Unauthenticated `GET http://c64u/v1/info` → HTTP **403**. Likely needs the app's auth (password `pwd`); not necessarily a hard blocker, but **must be re-verified through the app's Save-and-Connect flow** before any C64U-primary case. |
| **c64bridge MCP** | Points at **VICE emulator**, not hardware | `c64_config info` → `{emulator:"vice", host:"127.0.0.1", port:6502}`. To use c64bridge gap-fill against real hardware it must be re-pointed (or use infra-class raw REST probes for health checks). |
| **c64scope lab peers** | UNKNOWN (no health reports yet) | `scope_lab_check_lab_readiness` → all three peers `unknown`. First real run must report peer health via `scope_lab_report_peer_health`. |

**Target decision for the next session:** the spec mandates `c64u` primary, but
AGENTS.md prefers `u64` and `u64` is healthy while `c64u` is unverified. Resolve
by attempting the app-driven Save-and-Connect to `c64u` (host `c64u`, password
`pwd`); if it connects and app diagnostics confirm identity, use `c64u` primary.
If not, proceed on `u64` labelled `U64_FALLBACK` and never merge the two.

## 2. What is already built (this session) — `c64scope/src/cta/`

The foundational, hardware-independent, testable CTA-layer core (the spec's
"genuinely net-new value", Section 6.3). Five pure-logic modules + five test files:

| Module | Purpose | Reuses |
| --- | --- | --- |
| `cta/riskModel.ts` | R0–R4 ↔ canonical action-class mapping; per-family mutation budgets (`defaultFamilyBudgets`, `MutationBudgetTracker`); combined `evaluateCtaAction` gate; CTA result-status vocabulary (`PASS/FAIL/BLOCKED/INCONCLUSIVE/NOT_PRESENT/SPEC_GAP/UNCLASSIFIED/CALIBRATION_ONLY`). | `exploration.ts` `shouldRefuseAction` + `ExplorationSafety`. |
| `cta/fingerprint.ts` | Stable semantic control fingerprint + dedup. Identity tiers: test-id → resource-id → label+role → positional fallback. Never coordinate-only. `fingerprintFromUiNode` adapter. | `validation/appFirstUi.ts` `UiNode`. |
| `cta/census.ts` | Scroll-to-fixed-point census with **logical-row identity** dedup. Pure `CensusAccumulator` (fixed-point detection) + injectable `ScrollDriver` + `runScrollCensus`. Stop reasons: `fixed-point | at-end | max-scrolls | single-page`. | — |
| `cta/coverage.ts` | Per-CTA coverage accounting (`CtaCoverageRecord`, `summarizeCoverage`, `toCoverageCsv`, `toCoverageJson`). Only `PASS` counts as passed. | `cta/riskModel.ts` `CtaResultStatus`. |
| `cta/redaction.ts` | Secret/PII redaction for the interaction log (Section 32). Field-name redaction + recursive known-secret-literal scrubbing. | — |

Tests: `c64scope/tests/cta{RiskModel,Fingerprint,Census,Coverage,Redaction}.test.ts`.

**Build status: NOT YET CONFIRMED GREEN.** There was exactly one compile error
(`defaultFamilyBudgets` Map constructed from object literals instead of `[k,v]`
pairs) — **fixed** in `riskModel.ts` (now builds the Map from `defaultBudgetEntries`
via `.map`). The follow-up `npm run scope:check` run was **interrupted by the
user before producing output**, so green status is unverified.

> **FIRST ACTION NEXT SESSION:** run `npm run scope:check` and confirm it is
> fully green (tsc strict + vitest). Fix any remaining errors before building
> anything else. The modules above are the foundation everything else depends on.

### Known scope deliberately deferred (do not regress these decisions)
- **Sticky-control reverse traversal** was removed from `census.ts` (it needed a
  direction-aware `ScrollDriver` and could not be tested cleanly against a
  forward-only interface). Add it back later with an explicit scroll-direction
  param. `ScrollDriver` is currently forward-only.
- No `scope:cta:*` npm scripts are wired yet — **intentionally**, to avoid the
  "documented-but-absent artifact" defect. Wire them only when the runner entry
  points (`ctaDiscover.ts` etc.) actually exist.

## 3. Reuse map — build on these, do not reimplement (spec Section 6.2)

- **Android controller (the load-bearing piece):** `c64scope/src/validation/droidmindClient.ts`
  — `DroidmindClient` is a real MCP stdio client over `@modelcontextprotocol/sdk`.
  Has `listDevices, startApp, stopApp, tap, swipe, pressKey(keycode:number),
  inputText, shell, screenshotToFile`. **Gaps to add:** UI-hierarchy capture,
  long-press/double-tap, a scroll primitive, list-elements. DroidMind tool names
  it calls: `android-device`, `android-app`, `android-ui`, `android-shell`,
  `android-screenshot`.
- **UI parsing:** `validation/appFirstUi.ts` (`parseUiNodes` uiautomator-XML →
  `UiNode[]`, finders, bounds). `validation/appFirstPrimitives.ts`,
  `validation/appFirstPlaybackPrimitives.ts`.
- **Risk gate:** `exploration.ts` `shouldRefuseAction` (3-tier) — extended by my
  `cta/riskModel.ts` to R0–R4 + per-family budgets.
- **Oracle engine:** `oraclePolicy.ts` (`classifyRun`, `checkCorroboration`,
  `detectWeakPatterns`). Reuse as-is — but see bug #1 below.
- **Evidence store:** `sessionStore.ts` (zod `session.json`, `summary.md`,
  bridge-justification enforcement). Reuse for per-run artifacts.
- **Executor pattern:** `fullAppCoverageExecutor.ts` (manifest emission,
  `timestampId`, `resolveWorkspaceRoot`, feature→case map).
- **Preflight / device identity:** `preflight.ts`, `deviceRegistry.ts`.
- **Fuzz spine (port the controller-agnostic parts):** `SeededRng` (mulberry32),
  `withTimeout`, watchdog logic, signature grouping (`buildSignature`/`buildGroupId`
  in `playwright/fuzz/chaosRunner.fuzz.ts` + `scripts/fuzzClassifier.mjs`), report
  renderers (`scripts/fuzzReportUtils.mjs`, `scripts/fuzzArtifactMergeUtils.mjs`).
  **Do NOT reuse:** fuzz mode, mock target, weighted-random selection, fault
  injection during the normal-user pass. This runner is deterministic.
- **Launch evidence:** `scripts/startup/collect-android-startup-baseline.mjs`.
- **Fixtures/staging:** `npm run fixtures:local-source` →
  `tests/fixtures/local-source-assets`; `scripts/startup/stage-local-assets-adb.sh`
  (stages `.sid/.mod/.crt/.prg/.d64/.d71/.d81/Songlengths.md5` to
  `/sdcard/Download/c64commander-assets`). **Infra-only staging**, not a product action.
- **Test/build conventions:** vitest; flat `c64scope/tests/*.test.ts`; `scope:check`
  = `cd c64scope && npm run check` = tsc strict + vitest; Node 24, npm, ESM `.js`
  import extensions, license header on every file.

## 4. Known defects / hazards to fix or route around

1. **`oraclePolicy.ts` `classifyRun` returns `failureClass: "product_failure"` on
   a PASS** (around line 217). research1 flagged this P1; still present. A passing
   run should serialize a non-failure class (null/`inconclusive`-equivalent), never
   `product_failure`. **Fix before trusting any run classification.**
2. **`validation/helpers.ts` uses raw ADB/REST/FTP** (`adb()`, `c64uGet`,
   `c64uFtpList`, `runPrgOnC64u`, `readC64Memory`, `resetC64Machine`,
   `dumpUiHierarchy`). Per spec Section 8.1, product actions must route through
   `DroidmindClient`; raw paths are infra-class (logcat slices, file staging,
   device identity) or C64Bridge-class gap-fill only. The CTA runner must NOT use
   these for product actions. UI-hierarchy dump via uiautomator is infra-read and
   acceptable, but `runPrgOnC64u`/`readC64Memory`/`resetC64Machine` must not
   perform or verify product actions.
3. **WebView vs uiautomator concern (validate early on-device):** the app is a
   Capacitor WebView. `dumpUiHierarchy` (uiautomator) may expose only the WebView
   container, NOT the app's `data-testid` DOM controls. If so, the CTA census
   needs the accessibility tree / a web-inspection path (DroidMind
   `android-ui`/`mobile-mcp` `list_elements_on_screen`, or Chrome DevTools via the
   WebView) to reach `data-testid`. **This is the #1 runtime risk for the census.
   Prove a discovery canary can see app controls before scaling.**
4. **DroidMind tool-name/arg shape:** `DroidmindClient.pressKey` sends
   `action:"press_key", keycode:<number>`. Confirm against the live DroidMind
   schema via MCP-capability discovery (spec Section 6.3 item 9, build
   `mcp-capabilities.json`); fail preflight if a required capability is missing.

## 5. Ordered next steps for the next session

1. **Confirm foundation is green:** `npm run scope:check`. Fix until clean.
2. **Stand up the CTA census runtime (Level A bulk runner skeleton):**
   - Add to `DroidmindClient`: UI-hierarchy capture + scroll + (if needed)
     list-elements. Route product actions through it.
   - Build `c64scope/src/cta/` runtime pieces: `runtimeFingerprint` (wire
     `fingerprint.ts` to live hierarchy), `ctaCensus` (wire `census.ts` +
     `ScrollDriver` over DroidMind), `controller` seam named after
     `agentic-controller-contract.md`.
   - **Discovery canary first:** read-only census on `/docs` and `/licenses`,
     keypad canary on the persistent tab bar (digits 1–6, Star→Diagnostics,
     Pound→Device Switcher). Compare output against `docs/cta-inventory.md`
     counts (tripwires, not proof). This validates concern #3 above.
3. **Fix defect #1** (`oraclePolicy.classifyRun` pass-classification) before any
   mutation case.
4. **Environment:** report c64scope peer health; resolve c64u-vs-u64 primary via
   the app Save-and-Connect flow (Section 1).
5. **Wire `scope:cta:{discover,run,resume,replay}` scripts** in root
   `package.json` (mirroring `scope:full-coverage`) **only once** the runner entry
   points exist.
6. **Then** proceed through the spec's staged coverage: read-only routes → guarded
   R1/R2 with capture-and-restore → dedicated R3 scenarios → background-playback
   soak → final report (spec Sections 19–43).

## 6. Key references (read before resuming)
- Spec: `docs/testing/agentic-tests/full-cta-coverage/prompt.md`
- Prior gap analysis (the basis that produced `DroidmindClient`):
  `docs/testing/agentic-tests/gap-analysis/research1/{README,inventory,remediation-plan}.md`
- Canonical contracts: `docs/testing/agentic-tests/agentic-{safety-policy,oracle-catalog,controller-contract,android-runtime-contract,action-model,feature-surface,coverage-matrix,open-questions,infrastructure-reuse}.md`, `c64scope-spec.md`, `mcp-setup.md`
- Program to extend: `docs/testing/agentic-tests/full-app-coverage/**`
- CTA checklist (tripwires): `docs/cta-inventory.md`
- Reuse targets: `c64scope/src/{validation/droidmindClient.ts, exploration.ts, oraclePolicy.ts, sessionStore.ts, fullAppCoverageExecutor.ts, preflight.ts, deviceRegistry.ts}`, `c64scope/src/validation/appFirstUi.ts`, `playwright/fuzz/**`, `scripts/fuzz*.mjs`
