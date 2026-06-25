# INFRA-004 — Gate 6.5 Config check blocked by leftover Drive A mount sheet

- Severity: INFRA
- Priority: P2
- Product area: CTA infrastructure
- Route: Disks overlay blocking Config navigation
- Overlay/dialog: `Mount disk to Drive A`
- CTA fingerprint: `config-page-load`
- Control label: Config tab via KEY_4
- Input method: DroidMind key event via `DroidmindClient.pressKey()`
- Build identity: `0.8.9-515e2`, APK SHA-256 `2f9b1569575eb6539509dc828ead4a220ac79ad516aa100fc4971635a0adea45`
- Git SHA: `515e2818ed1992dd6e3579470e1355488111278f`
- Pixel 4 identity: `9B081FFAZ001WX`
- Target identity: `c64u`, HTTP `80`, FTP `21`, Telnet `23`
- First reproduced UTC: `2026-06-25T00:18:27Z`
- Last reproduced UTC: `2026-06-25T00:19:42Z`
- Reproduction count: 1
- Reproduction rate: 1/1 for current-SHA Gate 6.5 run
- Preconditions: Gate 6.5 tapped Drive A Mount disk and left the sheet open before KEY_4.
- Exact DroidMind semantic actions: Gate 6.5 used KEY_2, Play controls, KEY_3, Disks controls, Drive A mount, then KEY_4.
- Exact command: `npm run scope:cta:gate65 -- --serial 9B081FFAZ001WX --target c64u --start-app --case CURRENT-SHA-GATE65`
- Expected result: Config page loads and `CONFIG` text is detected.
- Actual result: Coverage row `F018.G65C012` is `BLOCKED`; screenshot shows `Mount disk to Drive A` sheet still open over Disks.
- User impact: Infrastructure-only; direct current-SHA discovery already found 28 Config controls.
- State before: App connected.
- State after: Overlay dismissed with DroidMind Back.
- Recovery performed: Pressed Back through DroidMind and continued Gate 7.
- Cleanup status: Overlay dismissed.
- Suspected component: Gate 6.5 cleanup between Disks mount-sheet check and Config navigation.
- Evidence supporting suspected component: `screenshots/config-initial.png` shows Drive A mount sheet, not Config.
- Remaining uncertainty: None for this block classification.
- Replay command: not needed; evidence is deterministic overlay contamination.
- Linked screenshots: `c64scope/artifacts/cta-20260625T001827Z-pixel4-c64u-515e2818ed19/screenshots/config-initial.png`
- Linked UI hierarchies: `c64scope/artifacts/cta-20260625T001827Z-pixel4-c64u-515e2818ed19/hierarchies/config-initial.xml`
- Linked coverage/results: `coverage.json`, `gate65-result.json`
- Linked logcat: `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/logcat/baseline-after-install-launch.log`
- Full stdout/stderr command logs:
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-cta-gate65.stdout.log`
  - `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/logs/commands/npm-run-scope-cta-gate65.stderr.log`

## Fix Verification

No runner fix yet. Overlay was manually dismissed by DroidMind Back before continuing.
