# Bug-Hunt Ledger

> ## ⭐ Session bughunt-20260625T164637Z (HEAD b86877f4) — S1 ROOT-CAUSED + FIXED + VERIFIED
> Artifact root: `c64scope/artifacts/bughunt-20260625T164637Z-pixel4-c64u-b86877f43589/`. Build `0.8.9-b8687` (unfixed SHA f052b0b1 → fixed SHA 2ffb1645). Target c64u **HEALTHY** (web stack up, 403/8ms).
>
> | Area | Test | Status | Evidence | Defect |
> |---|---|---|---|---|
> | Disks/transport | idle→mount→idle→eject (S1 catastrophic path) | **PROVEN_BUG → FIXED + VERIFIED** | reproduced HTTP404+HTTP000 wedge on unfixed; HTTP200+healthy on fixed | S1-ROOTCAUSE-HTTP-KEEPALIVE-STALE-SOCKET-WEDGES-C64U |
> | Disks | per-drive status recovery | NO_BUG (S2 fix holds) | status HTTP404→OK on poll, no page re-mount | S2 (prior) |
> | Shell | keypad digits 1–6 → tabs; `*`→Diag; `#`→Switcher; Back dismiss | NO_BUG_FOUND | sweep-* screenshots | - |
> | All routes | CDP console/exception sweep | NO_BUG_FOUND | window.__qaErrors=[] across 6 routes | - |
> | Overlays | AbortError on Diagnostics/Switcher dismiss | **PROVEN_BUG (S4)** | unhandledrejection x2 | S4-UNHANDLED-ABORTERROR-ON-OVERLAY-DISMISS |
> | Config | menu + Video sub-page live render | NO_BUG_FOUND | sweep-config, config-video-setup | - |
> | Settings | appearance; display profile Small→Auto restore | NO_BUG (drift restored) | settings-display-restored-auto | - |
> | Diagnostics | password redaction | NO_BUG (PASS) | no `pwd` in body | - |
> | Lifecycle | relaunch; background/foreground reconnect | NO_BUG_FOUND | lifecycle-relaunch | - |
> | Repo health | prettier drift in 2 committed files | FIXED (whitespace-only) | lint now PASS | - |
> | Config write / Play browser / negative-host / orientation / 20× reps | DEFERRED_WITH_REASON | see bug-hunt-report §coverage | - |
>
> Final recommendation: `BUGHUNT-COMPLETE-CRITICAL-BUGS-FOUND` (critical bug fixed + verified). Full report: `../bug-hunt-report.md`.

---

# Bug-Hunt Ledger — bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb (prior session)

Run: 2026-06-25. Pixel 4 `9B081FFAZ001WX`. App `0.8.9-cf84d`. Target c64u **OFFLINE (HTTP 000)**.
Artifact root: `c64scope/artifacts/bughunt-20260625T125855Z-pixel4-c64u-cf84d8e565cb/`

Statuses: NOT_STARTED · IN_PROGRESS · PROVEN_BUG · NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST · FAILED_TEST_NEEDS_TRIAGE · BLOCKED_WITH_EVIDENCE · SAFETY_BLOCKED_NOT_EXECUTED · INCONCLUSIVE_REPLAY_REQUIRED · NOT_PRESENT_WITH_REASON · SPEC_GAP_WITH_EVIDENCE

| # | Area | Route/Overlay | Precondition | Input | Risk | Test contract | Status | Evidence | Defect | Cleanup | Next action |
|---|------|---------------|--------------|-------|------|---------------|--------|----------|--------|---------|-------------|
| 1 | Shell | Launch | cold | DroidMind | R0 | App launches to Home, renders | NO_BUG_FOUND_AFTER_EXHAUSTIVE_TEST | screenshots/baseline-01-launch.png | - | n/a | - |
| 2 | Shell | Tab nav (1-6 + touch) | app up | DroidMind | R0 | All 6 tabs reachable, correct page | NOT_STARTED | - | - | n/a | discoverRoutes |
| 3 | Keypad | global matrix | app up | DroidMind pressKey | R0 | digits/star/pound/dpad map correctly | NOT_STARTED | - | - | n/a | keypad gate |
| 4 | Home | all controls (disconnected) | c64u down | CDP+DroidMind | R1 | disconnected status accurate, no false-enabled destructive | NOT_STARTED | - | - | n/a | gate6 + manual |
| 5 | Play | sources/playlist (disconnected) | c64u down | CDP+DroidMind | R1 | source open behavior, disconnected errors | NOT_STARTED | - | - | n/a | gate65 + manual |
| 6 | Disks | states (disconnected) | c64u down | CDP+DroidMind | R1 | drive status, mount sheet open/cancel | NOT_STARTED | - | - | n/a | gate65 + manual |
| 7 | Disks | Drive A 5x mount/eject | c64u GREEN | DroidMind | R3 | S1 reliability | PROVEN_BUG (S2 residual; catastrophic S1 not repro) | s1-c1..c5-* | S1+S2 | clean (No disk, OK) | idle-replay recommended |
| 7b | Disks | Drive A status recovery | c64u GREEN | DroidMind+CDP | R2 | status reflects truth, recovers on poll | PROVEN_BUG | s1-c1-stuck-status, s1-c5-repro-stuck | S2 | n/a | fix non-recovery |
| 8 | Config | category/row enumeration | c64u down | CDP+DroidMind | R1 | load/retry/error quality when disconnected | NOT_STARTED | - | - | n/a | gate65 + CDP |
| 9 | Settings | appearance (theme/display/orient) | app up | DroidMind | R0 | mutate+restore, no crash | NOT_STARTED | - | - | restore Auto | gate4/gate5 |
| 10 | Settings | Save-and-Connect NEGATIVE | app up | DroidMind | R1 | invalid/empty host, bad port handled | NOT_STARTED | - | - | restore c64u | gate7 + manual |
| 11 | Settings | saved devices add/edit/delete | app up | DroidMind | R2 | last-device protection, cancel paths | NOT_STARTED | - | - | restore | manual |
| 12 | Diagnostics | open all routes, tabs, export, redaction | app up | DroidMind | R1 | star shortcut, pwd redacted, export | NOT_STARTED | - | - | n/a | manual |
| 13 | Device Switcher | pound shortcut, select/cancel | app up | DroidMind | R1 | no accidental select, restore c64u | NOT_STARTED | - | - | restore c64u | manual |
| 14 | Docs | accordions expand/collapse/scroll | app up | DroidMind | R0 | all items, dpad reach | NOT_STARTED | - | - | n/a | gate6 + manual |
| 15 | Licenses | open/scroll/close | app up | DroidMind | R0 | renders, long content | NOT_STARTED | - | - | n/a | manual |
| 16 | Native picker | open/select/cancel/back | source dep | DroidMind | R1 | return-to-app state | NOT_STARTED | - | - | n/a | manual |
| 17 | Negative | disconnected Play/Disk/Config actions | c64u down | DroidMind | R1 | sensible errors, no hang | NOT_STARTED | - | - | n/a | manual |
| 18 | Lifecycle | cold/warm/home/lock/rotate/relaunch/bg | app up | DroidMind | R1 | state survives, no crash | NOT_STARTED | - | - | restore portrait | manual |
| 19 | Perf | route nav, diag open, switcher open timings | app up | DroidMind | R0 | <1500ms nav, no storm | NOT_STARTED | - | - | n/a | gates + manual |
| 20 | CDP | console error/exception sweep all routes | app up | CDP | R0 | no uncaught JS errors | NOT_STARTED | - | - | n/a | CDP |
| 21 | Variant | C64U Remote variant scope | not installed | - | - | feature flags, branding | SPEC_GAP_WITH_EVIDENCE | full app installed | - | n/a | assess build |

## Defects opened this session — ALL FIXED + VERIFIED ON DEVICE (2026-06-25, build SHA-256 5c6625f7…; typecheck+7458 tests+lint PASS; see fix-report.md)

- **S2-DISKS-DRIVE-A-STATUS-STUCK-HOST-UNREACHABLE** (S2/P1): after a slow/failed Drive A mount, `drive-status-a` sticks on "Host unreachable" while `drive-status-b`="OK" and device healthy; clears only on page re-mount. Repro 2/5. Evidence s1-c1-*, s1-c5-*.
- **S1 update**: catastrophic connection-reset NOT reproduced in 5 rapid cycles (c64u 403/7-8ms throughout); `Connection: close` fix appears effective; idle-triggered path not re-tested.

## Candidate findings — ALL FIXED + VERIFIED ON DEVICE (2026-06-25): C1 drive status gated→"Not available"; C2 OFFLINE-badge one-tap reconnect; C3 intentional 8000ms mount timeout. Original notes below.

- **C1 — Disconnected Home shows mixed stale data**: while header/badge say "Not connected/OFFLINE", Home body shows a mix of "Not available" placeholders (Turbo Control, Video Mode, Joystick…) AND stale concrete cached values (Drive A "ON/Type 1541/Status OK", SID "ARMSID", LED "Blue/31", Streams "192.168.1.185:11000"). Inconsistent disconnected rendering. Evidence: inventory/home-* (disconnected snapshot). Severity likely S3/S4. Needs visual review of whether stale values are de-emphasized.
- **C2 — No auto-reconnect after transient outage**: app stayed OFFLINE after c64u recovered; required manual Save-and-Connect. Possibly by-design. Needs check for a retry affordance / auto-reconnect expectation.
- **C3 — Slow mount + 10s hang on DNS failure**: mount PUT 0.8–1.8s; on DNS failure hung 10s before UnknownHostException with no visible timeout/progress. Minor UX.
