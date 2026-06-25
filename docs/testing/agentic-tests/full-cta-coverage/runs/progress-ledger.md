# Full CTA Coverage Progress Ledger

Allowed statuses in this ledger: `NOT_STARTED`, `IN_PROGRESS`, `PROVEN`, `FAILED`, `BLOCKED_WITH_EVIDENCE`, `SAFETY_BLOCKED_NOT_EXECUTED`, `INCONCLUSIVE_NEEDS_REPLAY`.

## Current Position

- Recorded at: `2026-06-25T07:10:00Z`
- Active branch: `test/full-cta-coverage`
- Git SHA: `af2d795b2361cc78e52f3013cf3502c0e72c0375`
- Pixel 4 serial: `9B081FFAZ001WX`
- Package: `uk.gleissner.c64commander`
- Current APK build identity: `PROVEN`; `android/app/build/outputs/apk/debug/c64commander-0.8.9-af2d7-debug.apk`, SHA-256 `e0f00bc9a9d595566df01b2eb1cfe63992dfc1611d4acce0fe4a21fa56af7891`.
- Installed package identity: `PROVEN`; versionName `0.8.9-af2d7`, versionCode `2042`, lastUpdateTime `2026-06-25 07:52:21`, signature short `d39d81d2`.
- Primary target: `c64u`; app-visible final target restored and proven in `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/restore-c64u-final-state/home-after-c64u-final.png`.
- Fallback target: `u64`; inherited infra probe reported Ultimate 64 Elite firmware `3.14e`, unique ID `38C1BA`; fallback only.
- Current artifact roots: `IN_PROGRESS`; active current-build root `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/`; inherited `515e2` evidence remains under `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/`.
- Current active blockers under fix: S1 `S1-DISKS-MOUNT-EJECT-RESETS-C64U` remains open until corrected five-cycle reliability passes. Current mitigation has one clean readonly pass and one inconclusive/invalid repetition harness run. Open S2 broad `/USB2/test-data` recursive scan stall remains.
- Missing inherited prompt artifacts: `final-report-2.md`, `cleanup-report-2.md`, `callback-8020-residual-risk.md`, and `cta-runner.md`.
- Continuation handover: `docs/testing/agentic-tests/full-cta-coverage/handover5.md`. `final-report-3.md` is not written because exhaustive CTA execution and cleanup are incomplete.

## Phase A — Current Build And Device Baseline

| Item | Status | Evidence | Next action |
| --- | --- | --- | --- |
| Git branch and SHA captured | PROVEN | `WORKLOG.md`; current SHA corrected to `af2d795b2361cc78e52f3013cf3502c0e72c0375` after branch advance | Keep exact SHA in final report |
| Worktree status captured | PROVEN | `WORKLOG.md`; `git status --short` output | Preserve unrelated dirty files |
| Package and build scripts inspected | PROVEN | `package.json`, `build`, `android/app/build.gradle` reads | Use repo-supported build path |
| `npm run scope:check` after current infrastructure edits | PROVEN | `WORKLOG.md`; current `af2d7` run passed 55 files / 360 tests | Re-run after further code changes |
| Current APK built from source state | PROVEN | `WORKLOG.md`; APK `c64commander-0.8.9-af2d7-debug.apk`, SHA-256 `e0f00bc9a9d595566df01b2eb1cfe63992dfc1611d4acce0fe4a21fa56af7891` | Use current APK only |
| Current APK installed on Pixel 4 | PROVEN | Build/install log; streamed install succeeded | None |
| Installed package identity captured after install | PROVEN | `WORKLOG.md`; versionName `0.8.9-af2d7`, versionCode `2042`, lastUpdateTime `2026-06-25 07:52:21` | Include in final report |
| App launched through DroidMind path | PROVEN | Build helper launch plus `DroidmindClient.startApp` in baseline capture | Continue product actions through `DroidmindClient` |
| Baseline screenshot and hierarchy | PROVEN | `screenshots/baseline-current-sha-launch.png`; `hierarchies/baseline-current-sha-launch.xml` | Use as current-SHA baseline |
| Launch logcat captured | PROVEN | `logs/logcat/baseline-after-install-launch.log` | Continue per-case log capture |
| `c64u` and `u64` health probes recorded as infrastructure evidence | PROVEN | `target-health-probes*.stdout.log`; c64u authenticated 200 from host and Pixel-side curl; u64 unauthenticated 200 | Raw probes support only; product proof is targeted Save-and-Connect |

## Phase B — CTA Infrastructure

| Item | Status | Evidence | Next action |
| --- | --- | --- | --- |
| `DroidmindClient` product-action path confirmed | PROVEN | `c64scope/src/validation/droidmindClient.ts`; `gate3.ts` uses `pressKey()` in current diff | Keep policy test green |
| `scope:cta:*` scripts exist | PROVEN | `package.json`; `c64scope/package.json` | Execute current gates after install |
| MCP capability check on current APK | PROVEN | `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/mcp-capabilities.json`, satisfied true | Re-run for later broad runner if needed |
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
| Clean-state all-route discovery | PROVEN | `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/results.json`; 290 discovery-only controls across six routes: Home 106, Play 24, Disks 40, Config 28, Settings 74, Docs 18; Settings stopped at `max-scrolls` | Execute current-APK CTA statuses; discovery is not coverage |
| Home CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Play CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Disks CTAs accounted | IN_PROGRESS | User-reported defects fixed and proven: CommoServe source picker evidence, specific C64U D64 import evidence, Drive A populated mount-sheet evidence, mount/eject evidence | Continue Disks deep dive; broad folder scan stall remains `FAILED` issue |
| Config CTAs accounted | IN_PROGRESS | Current discovery found 28 Config controls; Config deep dive `config-deep-dive/result.json` proved five clean loads connected with no loading/error text; Gate 6.5 block was Drive A mount-sheet overlay contamination | Execute individual Config CTA rows and safe mutations |
| Settings CTAs accounted | IN_PROGRESS | Current discovery found 74 Settings controls but stopped at `max-scrolls`; Gate 5 passed 12/12 and Gate 7 passed 2/3 with cleanup proven | Deep dive and complete remaining Settings controls |
| Docs CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Diagnostics CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Device Switcher CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Licenses CTAs accounted | NOT_STARTED | None current APK | Deep dive |
| Native picker CTAs accounted | NOT_STARTED | None current APK | Deep dive where reachable |
| Unaccounted CTA count | IN_PROGRESS | 290 current discovery rows, all discovery-only | Must finish at zero after execution ledger |

## Phase E/F/G/H — Flow Certification

| Flow | Status | Evidence | Next action |
| --- | --- | --- | --- |
| C64U Save-and-Connect | PROVEN | `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-515e2818ed19/targeted-save-connect/result.json`; generic Gate 3 artifact `cta-20260625T000108Z-pixel4-c64u-515e2818ed19` is runner-blocked | Use targeted current-SHA proof as connected baseline; document Gate 3 runner gap |
| Disks Add items source matrix | PROVEN | `screenshots/commoserve-library-source-01-source-picker.png`, `hierarchies/commoserve-library-source-01-source-picker.xml` | Include in Disks ledger rows |
| Disks C64U D64 import | PROVEN | `screenshots/disks-import-specific-after-add.png`, `hierarchies/disks-import-specific-after-add.xml`, `logs/commands/droidmind-disks-import-specific-d64.stdout.log` | Remove temporary entries during cleanup |
| Drive A mount sheet population | PROVEN | `screenshots/drive-a-mount-sheet-fixed-open.png`, `hierarchies/drive-a-mount-sheet-fixed-open.xml`, `logs/commands/droidmind-drive-a-mount-sheet-fixed.stdout.log` | Continue mount/eject repetitions |
| Broad C64U folder import `/USB2/test-data` | FAILED | `screenshots/disks-import-stuck-scan-before-cancel.png`, `logs/commands/droidmind-disks-import-add-to-library.stdout.log` | Track defect and avoid broad-folder import during cleanup |
| Drive A mount/eject original repetitions | FAILED | `disks-mount-eject-loop/result.json`; two successful cycles, third produced app-visible `Connection reset`; S1 defect filed | Superseded only by current-build corrected reliability when complete |
| Drive A readonly mount/eject clean single cycle | PROVEN | `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/clean-readonly-mount-eject-2/result.json`; final eject state `No disk mounted`, `Connected to c64u, system healthy` | Run corrected five-cycle reliability loop |
| Drive A readonly mount/eject repetitions | INCONCLUSIVE_NEEDS_REPLAY | `c64scope/artifacts/cta-20260624T235538Z-pixel4-c64u-af2d795b2361/readonly-mount-eject-repetitions/result.json`; stale coordinate fallback did not exercise the intended product path | Replay with corrected semantic targeting |
| Keypad canary | PROVEN | `c64scope/artifacts/cta-20260625T000854Z-pixel4-c64u-515e2818ed19/`; 11/11 passed with D-pad included | Full keypad-first matrix still required |
| Touch parity | NOT_STARTED | None current APK | Execute route passes |
| Keypad-first matrix | NOT_STARTED | None current APK | Execute after canary |
| Negative-path matrix | NOT_STARTED | None current APK | Execute with restoration |
| Lifecycle matrix | NOT_STARTED | None current APK | Execute after core flows |
| Performance timings | NOT_STARTED | None current APK | Capture during flows |
| Reliability repetitions | NOT_STARTED | None current APK | Repeat critical flows |
| Background playback | NOT_STARTED | None current APK | Execute if supported/fixtures available |
| Soak | NOT_STARTED | None current APK | Run longest safe session duration |
| Cleanup and final diff | NOT_STARTED | None current APK | Execute before final report |
| Handover after S1 safety stop | BLOCKED_WITH_EVIDENCE | `docs/testing/agentic-tests/full-cta-coverage/handover5.md` | Resume with local source/log triage only; do not send `c64u` traffic before a fix or explicit safe test window |

## Defects

| ID | Status | Evidence | Notes |
| --- | --- | --- | --- |
| `INFRA-001` | IN_PROGRESS | Missing inherited artifacts listed above | Create defect only if it blocks current certification artifacts |
| `INFRA-002` | BLOCKED_WITH_EVIDENCE | Generic Gate 3 runner lost app during host edit/Save-and-Connect scroll; formal defect `docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-002-GATE3-RUNNER-LOSES-APP.md` | Product Save-and-Connect superseded by targeted proof |
| `INFRA-003` | BLOCKED_WITH_EVIDENCE | Gate 6 runner hung in DroidMind hierarchy capture; formal defect `docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-003-GATE6-HIERARCHY-CAPTURE-HANG.md` | Supersede with targeted route evidence |
| `INFRA-004` | BLOCKED_WITH_EVIDENCE | Gate 6.5 Config block caused by leftover Drive A mount sheet; formal defect `docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-004-GATE65-CONFIG-BLOCKED-BY-MOUNT-SHEET.md` | Overlay dismissed |
| `INFRA-005` | PROVEN | Gate 7 HTTP restore blocked but cleanup proved HTTP `80`; formal defect `docs/testing/agentic-tests/full-cta-coverage/defects/INFRA-005-GATE7-HTTP-RESTORE-BLOCK.md` | Cleanup complete |
| `S2-DISKS-MOUNT-EMPTY` | PROVEN | Fixed-sheet proof `screenshots/drive-a-mount-sheet-fixed-open.png`; formal defect file `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-MOUNT-EMPTY.md` | Keep fix evidence; continue broader Disks pass |
| `S2-DISKS-COMMOSERVE-MISSING` | PROVEN | Source picker proof `screenshots/commoserve-library-source-01-source-picker.png`; formal defect file `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-COMMOSERVE-MISSING.md` | Keep fix evidence; continue broader Disks pass |
| `S2-DISKS-FTP-RECURSIVE-SCAN-STALL` | FAILED | Broad folder import stalled at `Scanning... 0 items` for at least 1m52s; formal defect file `docs/testing/agentic-tests/full-cta-coverage/defects/S2-DISKS-FTP-RECURSIVE-SCAN-STALL.md` | Reproduce in Disks performance/reliability pass or keep as open S2 |
| `S1-DISKS-MOUNT-EJECT-RESETS-C64U` | IN_PROGRESS | Original loop failed with `Connection reset`; current mitigation has one clean readonly proof and one invalid repetition harness run | Keep open until corrected five-cycle current-build reliability passes |
