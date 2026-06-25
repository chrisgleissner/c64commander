# INFRA-003 — Gate 6 runner hangs during DroidMind hierarchy capture

- Severity: INFRA
- Priority: P1
- Product area: CTA infrastructure
- Route: Settings at time of interruption
- CTA fingerprint: Gate 6 route-control runner
- Control label: Multiple route controls
- Input method: DroidMind touch/key events via `DroidmindClient`
- Build identity: `0.8.9-515e2`, APK SHA-256 `2f9b1569575eb6539509dc828ead4a220ac79ad516aa100fc4971635a0adea45`
- Git SHA: `515e2818ed1992dd6e3579470e1355488111278f`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, HTTP `80`, FTP `21`, Telnet `23`
- First reproduced UTC: `2026-06-25T00:13:29Z`
- Last reproduced UTC: `2026-06-25T00:17:00Z`
- Reproduction count: 1
- Reproduction rate: 1/1 for current-SHA Gate 6 run
- Preconditions: Current APK installed; prior gates had run; app connected.
- Exact DroidMind semantic actions: Gate 6 runner started app and entered route-control traversal.
- Exact command: `npm run scope:cta:gate6 -- --serial 9B081FFAZ001WX --target c64u --start-app --case CURRENT-SHA-GATE6`
- Expected result: Gate 6 completes and emits coverage.
- Actual result: Runner produced no completion output for over five minutes. Process inspection showed it inside DroidMind UI hierarchy capture; live screenshot showed the app stationary at Settings top.
- User impact: Infrastructure-only for this run; Gate 6 must be superseded by targeted route evidence.
- State before: App connected.
- State after: Runner stopped with Ctrl-C; no `gate6.js` child remained.
- Recovery performed: Stopped process, confirmed no runner child remained, continued independent gates.
- Cleanup status: App remained connected; later HTTP-port cleanup proved connected state.
- Suspected component: DroidMind hierarchy capture path or Gate 6 route traversal state.
- Evidence supporting suspected component: `ps` output showed `adb ... uiautomator dump`; MCP screenshot showed stationary Settings top.
- Remaining uncertainty: Whether the underlying uiautomator command hung on WebView accessibility state or Gate 6 kept requesting repeated captures.
- Replay command: none emitted because run was interrupted.
- Linked screenshots: MCP screenshot in chat; partial artifact root `c64scope/artifacts/cta-20260625T001329Z-pixel4-c64u-515e2818ed19/`
- Linked UI hierarchies: partial artifact root above
- Linked actions/checkpoint/coverage/results/issue groups: no final results emitted
- Linked logcat: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/baseline-after-install-launch.log`
- Linked DroidMind logs: command log below
- Linked C64Scope timeline: partial artifact root above
- Linked C64Bridge log: not used
- Linked diagnostics export: not used
- Full stdout/stderr command logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-cta-gate6.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-cta-gate6.stderr.log`
- Relevant log excerpt: No runner result; process was stopped after live hang confirmation.

## Fix Verification

**FIXED (2026-06-25).** Root cause: a hung `adb shell uiautomator dump` made
`DroidmindClient.callTool()` (the MCP request) never resolve, with no deadline — so the
whole Gate 6 runner blocked indefinitely; `captureUiHierarchy`'s retry loop could never
fire because the first `shell()` call never returned. Two fixes in
`c64scope/src/validation/droidmindClient.ts`:
1. `callTool()` now passes `{ timeout: MCP_CALL_TIMEOUT_MS }` (30 s) to `client.callTool`, so
   any hung DroidMind MCP call (incl. `uiautomator dump`) rejects fast instead of hanging forever.
2. `captureUiHierarchy()` now wraps each attempt in try/catch, so a timed-out dump/cat
   retries (up to 3×) and then throws a clear error rather than aborting capture.

Verified: `npm run scope:check` (build + unit tests, incl. `droidmindClient.test.ts`) PASS.
