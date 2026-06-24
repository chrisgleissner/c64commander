# Full CTA Coverage Progress Ledger

Allowed statuses in this ledger: `NOT_STARTED`, `IN_PROGRESS`, `PROVEN`, `FAILED`, `BLOCKED_WITH_EVIDENCE`, `SAFETY_BLOCKED_NOT_EXECUTED`, `INCONCLUSIVE_NEEDS_REPLAY`.

## Current Position

- Recorded at: `2026-06-24T22:28:37Z`
- Active branch: `test/full-cta-coverage`
- Git SHA: `414ec2a965d64651881c658cc5df772dd4ed934b`
- Pixel 4 serial: `9B081FFAZ001WX`
- Package: `uk.gleissner.c64commander`
- Current APK build identity: `PROVEN`; `android/app/build/outputs/apk/debug/c64commander-0.8.9-414ec-debug.apk`, SHA-256 `b404778e5c617c203009a7b608dbca2149555a45dfdb9c1c21342c2af6225256`.
- Installed package identity: `PROVEN`; versionName `0.8.9-414ec`, versionCode `2037`, firstInstallTime/lastUpdateTime `2026-06-24 22:52:18`, package path `/data/app/~~AIeSfoxigZHXtD-Mo6Ky-g==/uk.gleissner.c64commander-ITET5_YkUO8PpJhMlS5JLA==/base.apk`.
- Primary target: `c64u`; unauthenticated `/v1/info` returned HTTP 403 in inherited evidence, so app-driven authenticated validation is required.
- Fallback target: `u64`; inherited infra probe reported Ultimate 64 Elite firmware `3.14e`, unique ID `38C1BA`; fallback only.
- Current artifact roots: `PROVEN`; baseline root `c64scope/artifacts/cta-20260624T214802Z-pixel4-c64u-414ec2a965d6/`, canonical Save-and-Connect root `c64scope/artifacts/cta-20260624T220402Z-pixel4-c64u-414ec2a965d6/`, all-route discovery root `c64scope/artifacts/cta-20260624T221006Z-pixel4-c64u-414ec2a965d6/`.
- Current active blockers under fix: Drive A/B `Mount disk` sheet was empty after clean install because it had no in-sheet Add disks path when the disk library was empty; Disks Add items picker omitted CommoServe.
- Missing inherited prompt artifacts: `final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md`.

## Phase A — Current Build And Device Baseline

| Item | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Git branch and SHA captured | PROVEN | `WORKLOG.md`; command output at continuation start | Keep exact SHA in final report |
| Worktree status captured | PROVEN | `WORKLOG.md`; `git status --short` output | Preserve unrelated dirty files |
| Package and build scripts inspected | PROVEN | `package.json`, `build`, `android/app/build.gradle` reads | Use repo-supported build path |
| `npm run scope:check` after current infrastructure edits | PROVEN | `logs/commands/npm-run-scope-check.stdout.log`; later redaction checks passed 54 files / 353 tests | Re-run after further code changes |
| Current APK built from source state | PROVEN | Build log `logs/commands/build-skip-tests-install-apk.stdout.log`; APK `c64commander-0.8.9-414ec-debug.apk` | Use current APK only |
| Current APK installed on Pixel 4 | PROVEN | `adb-install-current-apk.stdout.log`; package metadata logs | None |
| Installed package identity captured after install | PROVEN | `adb-dumpsys-package-current.stdout.log`; `adb-pm-path-current.stdout.log`; `apk-sha256.stdout.log` | Include in final report |
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
| Clean-state all-route discovery | PROVEN | `c64scope/artifacts/cta-20260624T221006Z-pixel4-c64u-414ec2a965d6/results.json`; 199 discovery-only controls across six routes | Re-run after patched APK install because UI changed |
| Home CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Play CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Disks CTAs accounted | IN_PROGRESS | Gate 6.5 touched Drive A controls; user observed empty Mount disk sheet and missing CommoServe source; targeted disk suites pass 98/98 after fixes | Deploy patched APK, verify source popup and mount representative disk |
| Config CTAs accounted | IN_PROGRESS | Direct clean Config census found 28 controls in `diagnostics/config-direct-clean-census.json`; Gate 6.5 block caused by stale mount sheet overlay | Re-run Config after patched Disks flow |
| Settings CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Docs CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Diagnostics CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Device Switcher CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Licenses CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Native picker CTAs accounted | NOT_STARTED | None current APK | Deep dive where reachable |
| Unaccounted CTA count | IN_PROGRESS | 199 current discovery rows, all discovery-only | Must finish at zero after execution ledger |

## Phase E/F/G/H — Flow Certification

| Flow | Status | Evidence | Next action |
| --- | --- | --- | --- |
| C64U Save-and-Connect | PROVEN | `c64scope/artifacts/cta-20260624T220402Z-pixel4-c64u-414ec2a965d6/gate3-result.json` | Use as connected baseline |
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
| `S2-DISKS-MOUNT-EMPTY` | IN_PROGRESS | Empty Drive A/B `Mount disk` sheet after clean install; root cause and fix recorded in `WORKLOG.md` | Verify patched APK on Pixel 4 and decide whether to create formal defect file |
| `S2-DISKS-COMMOSERVE-MISSING` | IN_PROGRESS | Disks Add items picker omitted CommoServe while Play included it; root cause and fix recorded in `WORKLOG.md` | Verify patched APK on Pixel 4 and decide whether to create formal defect file |
