# Full CTA Coverage Progress Ledger

Allowed statuses in this ledger: `NOT_STARTED`, `IN_PROGRESS`, `PROVEN`, `FAILED`, `BLOCKED_WITH_EVIDENCE`, `SAFETY_BLOCKED_NOT_EXECUTED`, `INCONCLUSIVE_NEEDS_REPLAY`.

## Current Position

- Recorded at: `2026-06-24T23:20:00Z`
- Active branch: `test/full-cta-coverage`
- Git SHA: `10c4b5e98510b3a4cd0afa824ca4ac34dcc71db9`
- Pixel 4 serial: `9B081FFAZ001WX`
- Package: `uk.gleissner.c64commander`
- Current APK build identity: `PROVEN`; `android/app/build/outputs/apk/debug/c64commander-0.8.9-10c4b-debug.apk`, SHA-256 `38d17f562159101f340d729f4e93ba5c21e7885dd3ccf40b868c792432e71e6e`.
- Installed package identity: `PROVEN`; versionName `0.8.9-10c4b`, versionCode `2040`, firstInstallTime `2026-06-24 22:52:18`, lastUpdateTime `2026-06-25 00:17:22`, package path `/data/app/~~U83Do-y3NWKqtU49tTBMPw==/uk.gleissner.c64commander-xwJ3ACWEBnM_ee8FAXUMiw==/base.apk`, signature short `d39d81d2`.
- Primary target: `c64u`; unauthenticated `/v1/info` returned HTTP 403 in inherited evidence, so app-driven authenticated validation is required.
- Fallback target: `u64`; inherited infra probe reported Ultimate 64 Elite firmware `3.14e`, unique ID `38C1BA`; fallback only.
- Current artifact roots: `PROVEN`; baseline root `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/`, canonical Save-and-Connect root `c64scope/artifacts/cta-20260624T220402Z-pixel4-c64u-414ec2a965d6/`, current all-route discovery and Disks fix root `c64scope/artifacts/cta-20260624T231700Z-pixel4-c64u-10c4b5e98510/`.
- Current active blockers under fix: none for the user-reported empty/wrong Mount disk sheet or missing CommoServe source; open Disks issue remains for broad `/USB2/test-data` recursive scan stall.
- Missing inherited prompt artifacts: `final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md`.

## Phase A — Current Build And Device Baseline

| Item | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Git branch and SHA captured | PROVEN | `WORKLOG.md`; command output at continuation start | Keep exact SHA in final report |
| Worktree status captured | PROVEN | `WORKLOG.md`; `git status --short` output | Preserve unrelated dirty files |
| Package and build scripts inspected | PROVEN | `package.json`, `build`, `android/app/build.gradle` reads | Use repo-supported build path |
| `npm run scope:check` after current infrastructure edits | PROVEN | `logs/commands/npm-run-scope-check.stdout.log`; later `npm run scope:check` passed 55 files / 356 tests after Disks fixes | Re-run after further code changes |
| Current APK built from source state | PROVEN | Build log `logs/commands/build-install-drive-sheet-fix.stdout.log`; APK `c64commander-0.8.9-1ce6a-debug.apk` | Use current APK only |
| Current APK installed on Pixel 4 | PROVEN | `build-install-drive-sheet-fix.stdout.log`; package metadata captured after install | None |
| Installed package identity captured after install | PROVEN | `dumpsys package` output in current command log; `versionName=0.8.9-1ce6a`, `versionCode=2039` | Include in final report |
| App launched through DroidMind path | PROVEN | `droidmind-baseline-launch.*`; baseline screenshot/hierarchy | Continue product actions through `DroidmindClient` |
| Baseline screenshot and hierarchy | PROVEN | `screenshots/baseline-launch.png`; `hierarchies/baseline-launch.xml` | Use as clean reinstall baseline |
| Launch logcat captured | PROVEN | `logs/logcat/baseline-launch.log` | Continue per-case log capture |
| `c64u` and `u64` health probes recorded as infrastructure evidence | PROVEN | `curl-c64u-info*.log`, `curl-u64-info.stdout.log`, `adb-ping-*`, `adb-curl-c64u-info-xpassword-quoted.stdout.log` | Raw probes support only; product proof is Gate 3 |

## Phase B — CTA Infrastructure

| Item | Status | Evidence | Next action |
| --- | --- | --- | --- |
| `DroidmindClient` product-action path confirmed | PROVEN | `c64scope/src/validation/droidmindClient.ts`; `gate3.ts` uses `pressKey()` in current diff | Keep policy test green |
| `scope:cta:*` scripts exist | PROVEN | `package.json`; `c64scope/package.json` | Execute current gates after install |
| MCP capability check on current APK | PROVEN | `cta-20260624T220402Z-pixel4-c64u-414ec2a965d6/mcp-capabilities.json`, satisfied true | Re-run for later broad runner if needed |
| `coverage.csv`/`coverage.json` emission | IN_PROGRESS | Inherited current-SHA smoke emitted files but before current APK install | Re-run all-route discovery |
| Runtime inventory and reconciliation emission | NOT_STARTED | None current continuation | Run all-route discovery |
| `actions.jsonl` logging | IN_PROGRESS | Inherited smoke emitted `actions.jsonl` | Re-run after install |
| Checkpoint and replay artifacts | IN_PROGRESS | Inherited smoke replay exists | Re-run after install and on failures |
| Status vocabulary suitability | IN_PROGRESS | `riskModel.ts` includes strict final states; some gate runners still emit `BLOCKED` | Normalize final ledgers manually or update runners if needed |
| Secret redaction | PROVEN | Gate 3 redaction fix; `scope:check` 54 files / 353 tests; canonical artifact scan clean | Recheck during diagnostics/export flows |
| Old incomplete artifact retention | PROVEN | `retention.ts` and test changes in working tree; inherited `scope:check` pass | Re-run `scope:check` |
| Product key events use `pressKey()` | PROVEN | `gate3.ts`, `gate5.ts`, `gate6.ts`, `gate65.ts`, `gate7.ts`, `keypadCanaryRunner.ts` source scan | Keep policy check green |
| Generic CTA execution beyond `CALIBRATION_ONLY` | IN_PROGRESS | Gate runners exist; generic `scope:cta` still discovery-only | Use gate runners and targeted DroidMind flows; extend only when necessary |

## Phase C/D — Inventory And CTA Execution

| Item | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Clean-state all-route discovery | PROVEN | `c64scope/artifacts/cta-20260624T231700Z-pixel4-c64u-10c4b5e98510/results.json`; 295 discovery-only controls across six routes: Home 109, Play 24, Disks 40, Config 28, Settings 76, Docs 18 | Execute current-APK CTA statuses; discovery is not coverage |
| Home CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Play CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Disks CTAs accounted | IN_PROGRESS | User-reported defects fixed and proven: CommoServe source picker evidence, specific C64U D64 import evidence, Drive A populated mount-sheet evidence, mount/eject evidence | Continue Disks deep dive; broad folder scan stall remains `FAILED` issue |
| Config CTAs accounted | IN_PROGRESS | Direct clean Config census found 28 controls in `diagnostics/config-direct-clean-census.json`; Gate 6.5 block caused by stale mount sheet overlay | Re-run Config after patched Disks flow |
| Settings CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Docs CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Diagnostics CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Device Switcher CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Licenses CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Native picker CTAs accounted | NOT_STARTED | None current APK | Deep dive where reachable |
| Unaccounted CTA count | IN_PROGRESS | 295 current discovery rows, all discovery-only | Must finish at zero after execution ledger |

## Phase E/F/G/H — Flow Certification

| Flow | Status | Evidence | Next action |
| --- | --- | --- | --- |
| C64U Save-and-Connect | PROVEN | `c64scope/artifacts/cta-20260624T220402Z-pixel4-c64u-414ec2a965d6/gate3-result.json` | Use as connected baseline |
| Disks Add items source matrix | PROVEN | `screenshots/commoserve-library-source-01-source-picker.png`, `hierarchies/commoserve-library-source-01-source-picker.xml` | Include in Disks ledger rows |
| Disks C64U D64 import | PROVEN | `screenshots/disks-import-specific-after-add.png`, `hierarchies/disks-import-specific-after-add.xml`, `logs/commands/droidmind-disks-import-specific-d64.stdout.log` | Remove temporary entries during cleanup |
| Drive A mount sheet population | PROVEN | `screenshots/drive-a-mount-sheet-fixed-open.png`, `hierarchies/drive-a-mount-sheet-fixed-open.xml`, `logs/commands/droidmind-drive-a-mount-sheet-fixed.stdout.log` | Continue mount/eject repetitions |
| Broad C64U folder import `/USB2/test-data` | FAILED | `screenshots/disks-import-stuck-scan-before-cancel.png`, `logs/commands/droidmind-disks-import-add-to-library.stdout.log` | Track defect and avoid broad-folder import during cleanup |
| Keypad canary | PROVEN | `c64scope/artifacts/cta-20260624T221253Z-pixel4-c64u-414ec2a965d6/`; 9/9 passed | Full keypad-first matrix still required |
| Touch parity | NOT_STARTED | None current APK | Execute route passes |
| Keypad-first matrix | NOT_STARTED | None current APK | Execute after canary |
| Negative-path matrix | NOT_STARTED | None current APK | Execute with restoration |
| Lifecycle matrix | NOT_STARTED | None current APK | Execute after core flows |
| Performance timings | NOT_STARTED | None current APK | Capture during flows |
| Reliability repetitions | NOT_STARTED | None current APK | Repeat critical flows |
| Background playback | NOT_STARTED | None current APK | Execute if supported/fixtures available |
| Soak | NOT_STARTED | None current APK | Run longest safe session duration |
| Cleanup and final diff | NOT_STARTED | None current APK | Execute before final report |

## Defects

| ID | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `INFRA-001` | IN_PROGRESS | Missing inherited artifacts listed above | Create defect only if it blocks current certification artifacts |
| `S2-DISKS-MOUNT-EMPTY` | PROVEN | Fixed-sheet proof `screenshots/drive-a-mount-sheet-fixed-open.png`; formal defect file `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-MOUNT-EMPTY.md` | Keep fix evidence; continue broader Disks pass |
| `S2-DISKS-COMMOSERVE-MISSING` | PROVEN | Source picker proof `screenshots/commoserve-library-source-01-source-picker.png`; formal defect file `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-COMMOSERVE-MISSING.md` | Keep fix evidence; continue broader Disks pass |
| `S2-DISKS-FTP-RECURSIVE-SCAN-STALL` | FAILED | Broad folder import stalled at `Scanning... 0 items` for at least 1m52s; formal defect file `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-FTP-RECURSIVE-SCAN-STALL.md` | Reproduce in Disks performance/reliability pass or keep as open S2 |
