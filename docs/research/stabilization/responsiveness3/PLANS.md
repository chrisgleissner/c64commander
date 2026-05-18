# PLANS — Stabilization Refuel (Stage 1: Investigation, Responsiveness 3)

Date: 2026-05-18
Repository: c64commander
Branch at handoff: `feat/reduce-latency-and-fix-errors2`
Handoff directory (mandatory): `/home/chris/dev/c64/c64commander/docs/research/stabilization/responsiveness3`
Prior investigation: `../responsiveness2/`
Prior PR: #258 (`d7325920 Reduce latency and fix errors`) — merged 2026-05-18.

## Why a third pass

Responsiveness2 closed seven findings with code+tests+device evidence (F-DIAG-1..3,
F-CONN-1..3, F-HTTP-1, F-LOG-1..2, F-MIME-1, F-RT-1, plus hypotheses H-VOL-1..2,
H-PLAY-1, H-RT-2). The Pixel 4 / u64 / c64u soak in `IMPLEMENTATION_PLANS.md`
green-lights the badge contract and most cold-boot noise. But on this branch, with
the merged PR installed, **the cold-boot REST storm is still ~95 sequential
CapacitorHttp requests over ~11 s** before Home is fully consistent, and the
Telnet plugin opens four separate connect/disconnect cycles inside the same window.
That is far worse than the F-HTTP-2 evidence implied — that fix only collapsed
`LED Strip Settings` and `Keyboard Lighting`. Every other Home category still
fans out to one network round-trip per item.

This investigation captures and explains that, plus the other latency, error-
recovery, and scheduling gaps still observable on real hardware. It does **not**
modify code — it produces an implementation-ready brief for a stage-2 stabilization
pass.

## Scope

Investigation-only stage. Discover root causes of:

- Pixel 4 cold-boot REST storm (95 sequential requests against the active device).
- Pixel 4 cold-boot Telnet storm (4 connect/disconnect cycles inside the
  REST window; saved-device capability discovery is in-memory only and re-runs
  every time the cache key changes).
- Bridge-thread serialization: how `CapacitorHttp` + `TelnetSocketPlugin` are
  forcing effectively single-stream traffic from a multi-concurrent React tree.
- Polling-pause coverage gaps: which non-slider primitives still bypass
  `pollingPauseRegistry` (volume mute toggle, drives polling, `/v1/info` polling,
  Telnet capability discovery, config invalidation on visibility resume).
- Visibility-resume refetch storm: `runConfigReconciler` in `src/App.tsx`
  invalidates and refetches every active config-items query on every WebView
  resume, replaying the cold-boot enrichment storm.
- Per-item enrichment behaviour of `C64API.getConfigItems` against firmware that
  returns flat strings (c64u 1.1.0, u64 3.14e both do).
- Telnet plugin single-thread + single-socket constraints (the native Kotlin
  layer prevents real concurrency even when callers parallelise).
- Silent-catch surface: 36 `} catch { ... }` blocks across `src/**`; audit which
  ones swallow legitimate failures.
- Cross-device coherence between `u64` (Ultimate 64 Elite, fw 3.14e) and
  `c64u` (C64 Ultimate, fw 1.1.0).

## Non-goals (binding)

- No production code fixes in this stage.
- No diagnostics suppression / label downgrades / threshold loosening.
- No test weakening.
- No firmware updates, factory resets, or persistent device-side changes.
- No screenshot refresh in `docs/img/**`.

## Device targets

- Android: Pixel 4, adb serial `9B081FFAZ001WX` (`9B0` prefix confirmed via `adb devices`).
- C64 hardware:
  - `u64` → 192.168.1.13, Ultimate 64 Elite, fw 3.14e, fpga 122, core 1.4B, unique_id `38C1BA`.
  - `c64u` → 192.168.1.167, C64 Ultimate, fw 1.1.0, fpga 122, core 1.49, unique_id `5D4E12`.
- Both REST `/v1/info` < 30 ms from dev host. Both responded healthy at the start
  of this investigation; see `evidence/baseline-u64-cold-start.txt` and the
  cold-boot logcat.

## Investigation tasks (this stage)

| #  | Task                                                                          | Status |
| -- | ----------------------------------------------------------------------------- | ------ |
| 1  | Audit responsiveness2 closeout vs current `main`                              | DONE   |
| 2  | Hardware probe (Pixel 4, u64, c64u) and confirm installed APK                 | DONE   |
| 3  | Capture cold-boot, warm-restart logcat + screenshot baselines                 | DONE   |
| 4  | Quantify cold-boot REST storm per category                                    | DONE   |
| 5  | Read `getConfigItems` + `useC64ConfigItems` enrichment policy                 | DONE   |
| 6  | Identify all `useC64ConfigItems` call sites that pay per-key enrichment       | DONE   |
| 7  | Read `useTelnetActions` capability discovery + cache invalidation             | DONE   |
| 8  | Read `useC64Drives`, `useC64Info` polling and check `pollingPauseRegistry`    | DONE   |
| 9  | Read native Android plugins (`MainActivity`, `TelnetSocketPlugin`)            | DONE   |
| 10 | Map silent-catch surface and remaining error-eating sites                     | DONE   |
| 11 | Read `runConfigReconciler` / `invalidateForVisibilityResume`                  | DONE   |
| 12 | Write `FINDINGS.md`                                                           | DONE   |
| 13 | Write `DIAGNOSTICS_ROOT_CAUSE_MATRIX.md`                                      | DONE   |
| 14 | Write `FEATURE_INVENTORY.md`                                                  | DONE   |
| 15 | Write `IMPLEMENTATION_PROMPT.md` (execution-ready handoff)                    | DONE   |

## Hypotheses brought forward from responsiveness2

These are still relevant; the new investigation extends or refines them but does
not invalidate them.

- F-RT-1 fix only covers `useSavedDeviceHealthChecks`. Other interval-driven
  React Query consumers (`useC64Drives`, `useC64Info`) do not observe the
  registry, so a slider drag still races them.
- F-HTTP-2 fix only addressed `LED Strip Settings` and `Keyboard Lighting`. The
  underlying cause — `getConfigItems` enrichment storm when the device returns
  flat strings — applies to every Home category.
- F-CONN-1 fix (`noteReachable`) handles badge truthfulness, but the connection
  manager still runs its own `/v1/info` probe rather than reusing the first REST
  reachable signal. That probe overlaps with the storm.

## Evidence layout

- `evidence/baseline-u64-cold-start.txt` — `am start -W` output for the first
  reproducible cold boot.
- `evidence/baseline-u64-cold-logcat-12s.txt` — full logcat for first 12 s of
  cold boot. Contains all 95 CapacitorHttp `Handling …` lines.
- `evidence/baseline-u64-12s.png` — Pixel 4 screencap at +12 s. Home rendered
  with `C64U · HEALTHY` (saved device c64u is active despite branch name).
- `evidence/baseline-cold-c64u-2-logcat.txt`,
  `evidence/baseline-cold-c64u-2-logcat.txt`, `evidence/baseline-cold-c64u-2.png`
  — second cold boot, reproducing the 95-request / 74-telnet-call total.
- `evidence/baseline-c64u-warm-logcat.txt`, `evidence/baseline-c64u-warm.png` —
  warm restart (no REST traffic; not a regression source).
- `evidence/nav-to-play-2-logcat.txt`, `evidence/nav-to-play-2.png` — bottom-bar
  navigation observation (interpreted in FINDINGS.md F3-NAV-1).

## Termination criteria

- All investigation tasks DONE or BLOCKED with documented reason.
- All required handoff docs exist under `responsiveness3/`.
- `IMPLEMENTATION_PROMPT.md` is execution-ready with concrete file paths,
  confirmed findings, hypotheses, and acceptance criteria.

## Cross-link to prior work

- Closeout PR: [#258 — Reduce latency and fix errors](https://github.com/chrisgleissner/c64commander/pull/258).
- Prior investigation: [responsiveness2/](../responsiveness2/).
- Prior FINDINGS (still relevant): [`responsiveness2/FINDINGS.md`](../responsiveness2/FINDINGS.md).
