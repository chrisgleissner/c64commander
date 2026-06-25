# INFRA-002 — Gate 3 runner loses app during Save-and-Connect edit path

- Severity: INFRA
- Priority: P1
- Product area: CTA infrastructure
- Route: Settings
- CTA fingerprint: `Save & Connect`
- Control label: Save & Connect
- Input method: DroidMind touch/key events via `DroidmindClient`
- Build identity: `0.8.9-515e2`, APK SHA-256 `2f9b1569575eb6539509dc828ead4a220ac79ad516aa100fc4971635a0adea45`
- Git SHA: `515e2818ed1992dd6e3579470e1355488111278f`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, HTTP `80`, FTP `21`, Telnet `23`
- First reproduced UTC: `2026-06-25T00:01:09Z`
- Last reproduced UTC: `2026-06-25T00:02:07Z`
- Reproduction count: 1
- Reproduction rate: 1/1 for generic Gate 3 current-SHA run
- Preconditions: Current APK installed; app initially connected to `c64u`.
- Exact DroidMind semantic actions: Gate 3 runner pressed Home, started app, used KEY_5, scrolled to host, edited host, attempted to scroll to Save & Connect.
- Exact command: `npm run scope:cta:gate3 -- --serial 9B081FFAZ001WX --target c64u --host c64u --http-port 80 --ftp-port 21 --telnet-port 23 --password [REDACTED] --start-app --case CURRENT-SHA-GATE3-SAVE-CONNECT`
- Expected result: Gate 3 finds Save & Connect, activates it, and proves connected `c64u`.
- Actual result: Runner reported `BLOCKED`; later hierarchies show Android launcher instead of app.
- User impact: Infrastructure-only; product Save-and-Connect was proven by targeted app-driven flow.
- State before: App-visible `Connected to c64u, system healthy`.
- State after: Generic runner blocked; targeted proof restored/confirmed connected state.
- Recovery performed: Ran targeted Save-and-Connect flow successfully.
- Cleanup status: Proven connected to `c64u`.
- Suspected component: `c64scope/src/cta/gate3.ts` host-field edit/scroll sequence.
- Evidence supporting suspected component: `gate3-result.json` records pre-action connected status and missing Save & Connect; scroll hierarchies include launcher package.
- Remaining uncertainty: Exact input transition that sent focus/app to launcher.
- Replay command: `npm run scope:cta:replay -- --run-id cta-20260625T000108Z-pixel4-c64u-515e2818ed19 --case CURRENT-SHA-GATE3-SAVE-CONNECT`
- Linked screenshots: `c64scope/artifacts/cta-20260625T000108Z-pixel4-c64u-515e2818ed19/screenshots/`
- Linked UI hierarchies: `c64scope/artifacts/cta-20260625T000108Z-pixel4-c64u-515e2818ed19/hierarchies/`
- Linked actions/checkpoint/coverage/results/issue groups: `gate3-result.json`, `replays/CURRENT-SHA-GATE3-SAVE-CONNECT.json`
- Linked logcat: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/baseline-after-install-launch.log`
- Linked DroidMind logs: command log below
- Linked C64Scope timeline: Gate 3 step log in `gate3-result.json`
- Linked C64Bridge log: not used
- Linked diagnostics export: not used
- Full stdout/stderr command logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-cta-gate3.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-cta-gate3.stderr.log`
- Relevant log excerpt: `blockerReason: "Save & Connect button not visible after 8 scroll attempts"`.

## Fix Verification

**FIXED (2026-06-25).** `c64scope/src/cta/gate3.ts` now verifies a Settings-page marker
(`SETTINGS` / `Appearance` / `Connection` / `Saved devices`) is present in the post-scroll
hierarchy before trusting the matched "Save & Connect" bounds and tapping. If the scroll
sent the app to the background (launcher surfaced), the runner now fails with a clear
`BLOCKED: App left the Settings page during scroll to Save & Connect` instead of tapping
the launcher. Verified: `npm run scope:check` (build + unit tests) PASS. (Gate runners are
device integration tests not executed by scope:check; the guard is type-checked and the
logic is deterministic.)

Earlier, product-level Save-and-Connect was also superseded by `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/targeted-save-connect/result.json`, status `PROVEN`.
