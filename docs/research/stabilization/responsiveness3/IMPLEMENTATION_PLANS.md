# IMPLEMENTATION_PLANS — Stabilization Refuel (Stage 2: Implementation)

Started: 2026-05-18
Working branch: `feat/responsiveness3-cold-boot`
Pixel 4 adb serial: `9B081FFAZ001WX`
Device targets: `u64` (primary), `c64u` (secondary)

This document is the live execution log for the responsiveness3 Stage 2 implementation pass. Read `IMPLEMENTATION_PROMPT.md`, `FINDINGS.md`, `DIAGNOSTICS_ROOT_CAUSE_MATRIX.md`, `FEATURE_INVENTORY.md`, and `RESPONSIVENESS_NOTES.md` for the full brief and acceptance gates.

## Status legend

- TODO — not started
- IN_PROGRESS — code/tests/evidence in flight
- BLOCKED — documented blocker with fallback path
- DONE — code landed, relevant validation passed, evidence captured

## Phase 1 — Home cold-boot enrichment storm

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F3-HTTP-1 | Home cold-boot enrichment storm | IN_PROGRESS | Home summary queries now opt into `skipEnrichment`, with Home fallback option domains added for U64/cartridge/UI selectors and CPU speed slider. Target evidence: `evidence/phase1-F3-HTTP-1-u64-cold-logcat.txt`, `evidence/phase1-F3-HTTP-1-u64-cold-paint-screencap.png`. |
| F3-CACHE-1 | Persistent config enrichment cache | IN_PROGRESS | Added `src/lib/c64api/configEnrichmentCache.ts` and wired `C64API` to persist category enrichment by `unique_id|firmware_version`, preserving cached metadata across host switches. Target evidence: `evidence/phase1-F3-CACHE-1-switch-back-summary.txt`. |
| F3-HTTP-2 | Deferred app-config snapshot capture | IN_PROGRESS | `useAppConfigState` no longer captures on mount; it now exposes manual capture, schedules an idle capture, and Home Revert prompts to capture a baseline when missing. |

## Phase 2 — Telnet capability discovery

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F3-TELNET-1 | Stable capability-discovery gating | TODO | Target evidence: `evidence/phase2-F3-TELNET-1-u64-cold-logcat.txt`. |
| F3-TELNET-2 | Persistent telnet capability cache | TODO | Target evidence: `evidence/phase2-F3-TELNET-2-u64-repeat-cold-logcat.txt`. |

## Phase 3 — Polling-pause sweep

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F3-HTTP-3 | Drives polling respects pause registry | TODO | Target evidence: `evidence/phase3-F3-HTTP-3-u64-slider-30s-request-trace.json`. |
| F3-HTTP-4 | Info polling respects pause registry | TODO | Shares Phase 3 request-trace evidence. |
| F3-PAUSE-1 | Mute toggle acquires polling pause | TODO | Target evidence: `evidence/phase3-F3-PAUSE-1-u64-mute-during-poll-logcat.txt`. |
| F3-PAUSE-2 | Telnet capability discovery acquires pause | TODO | Shares Phase 3 request-trace evidence. |

## Phase 4 — Visibility reconciler and slider tail-grace

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F3-RESUME-1 | Visibility resume no longer replays storm | TODO | Target evidence: `evidence/phase4-F3-RESUME-1-u64-lock-unlock-logcat.txt`. |
| F3-PAUSE-3 | Slider commit tail-grace | TODO | Target evidence: `evidence/phase4-F3-PAUSE-3-u64-slider-pause-trace.json`. |

## Phase 5 — Background traffic + TelnetSocketPlugin closeups

| ID | Finding | Status | Notes / Evidence |
|---|---|---|---|
| F3-NAV-1 | Backgrounded app stops REST/Telnet activity | TODO | Target evidence: `evidence/phase5-F3-NAV-1-u64-backgrounded-logcat.txt`. |
| F3-TELNET-4 | TelnetSocketPlugin disconnect caught-exception payload | TODO | Target evidence: `evidence/phase5-F3-TELNET-4-jvm-test-output.txt`. |

## Phase 6 — Full validation sweep

| Gate | Status | Notes / Evidence |
|---|---|---|
| `npm run lint` | DONE | Passed after Phase 1 code + regression test changes. |
| `npm run test` | TODO |  |
| `npm run test:coverage` | IN_PROGRESS | Re-running after fixing a `tests/unit/c64api.branches.test.ts` regression exposed by the coverage sweep. |
| `npm run test:agents` | TODO |  |
| `npm run build` | TODO |  |
| `npm run cap:build && npm run android:apk` | TODO |  |
| Fresh Pixel 4 install + cold launch | TODO |  |
| Cross-device sweep (`u64`, `c64u`) | TODO |  |

## Evidence register

| Phase | Host | Evidence | Status | Notes |
|---|---|---|---|---|
| 1 | u64 | `phase1-F3-HTTP-1-u64-cold-logcat.txt` | TODO |  |
| 1 | u64 | `phase1-F3-HTTP-1-u64-cold-paint-screencap.png` | TODO |  |
| 1 | multi | `phase1-F3-CACHE-1-switch-back-summary.txt` | TODO |  |
| 2 | u64 | `phase2-F3-TELNET-1-u64-cold-logcat.txt` | TODO |  |
| 2 | u64 | `phase2-F3-TELNET-2-u64-repeat-cold-logcat.txt` | TODO |  |
| 3 | u64 | `phase3-F3-HTTP-3-u64-slider-30s-request-trace.json` | TODO |  |
| 3 | u64 | `phase3-F3-PAUSE-1-u64-mute-during-poll-logcat.txt` | TODO |  |
| 4 | u64 | `phase4-F3-RESUME-1-u64-lock-unlock-logcat.txt` | TODO |  |
| 4 | u64 | `phase4-F3-PAUSE-3-u64-slider-pause-trace.json` | TODO |  |
| 5 | u64 | `phase5-F3-NAV-1-u64-backgrounded-logcat.txt` | TODO |  |
| 5 | local | `phase5-F3-TELNET-4-jvm-test-output.txt` | TODO |  |

## Pixel 4 deploy log

| When | APK | TotalTime | Notes |
|---|---|---|---|
| 2026-05-18 17:45 | `c64commander-0.7.9-rc1-debug.apk` (PR #258, pre-responsiveness3 fix) | 606 ms | Baseline; 95 HTTP / 74 Telnet plugin calls in first 12 s of cold boot against c64u; see `evidence/baseline-u64-cold-logcat-12s.txt`. |
| 2026-05-18 17:48 | same APK | 572 ms | Reproduced baseline against c64u (95 HTTP requests, 74 Telnet plugin calls). |
