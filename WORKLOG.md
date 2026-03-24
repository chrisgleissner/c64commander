# Telnet Integration Research Worklog

Status: COMPLETE
Date: 2026-03-24

## 2026-03-24 — Initial Document Review

Read required documents:

- `doc/architecture.md` — React+Vite+Capacitor app, REST+FTP to C64U, TanStack Query
- `doc/c64/c64u-openapi.yaml` — REST API spec, X-Password auth
- `doc/c64/telnet/c64u-telnet-spec.md` — Normative telnet spec (contains F-key mapping errors, see below)
- `doc/c64/telnet/c64u-telnet-action-walkthrough.md` — Captured telnet screens

Key: Telnet-only actions include Power Cycle, Reboot (Clear Memory), Save C64/REU Memory, IEC controls, Printer controls, Config file ops, Debug log ops.

## 2026-03-24 — C64 Commander REST/FTP Concurrency Model

### REST Client (`src/lib/c64api.ts`)

- Uses native `fetch()` with AbortController for timeouts
- Request IDs: sequential `c64req-{timestamp}-{seq}`
- Timeouts: 3s control, 5s upload/playback, 15s RAM write
- SID upload retries: max 3 attempts on 502/503/504
- Read request deduplication via in-flight map
- Read request budget (256 entries, 64KB, 500ms window)

### FTP Client (`src/lib/ftp/ftpClient.ts`)

- Delegates to `FtpClient` native plugin (Capacitor bridge)
- Records trace events via `recordFtpOperation()`
- Uses implicit action wrapping for FTP calls outside user actions

### Device Interaction Manager (`src/lib/deviceInteraction/deviceInteractionManager.ts`)

- **REST scheduler**: `InteractionScheduler` with `REST_MAX_CONCURRENCY = 1` (fully serialized)
- **FTP scheduler**: `InteractionScheduler` with configurable `ftpMaxConcurrency` (default 2)
- **REST and FTP schedulers are independent** — no shared queue
- Priority queue: user > system > background intent ordering
- Per-endpoint cooldowns: machine control 250ms, config mutation 120ms
- Per-protocol circuit breaker with configurable threshold and cooldown
- Exponential backoff on critical errors
- Device state gating: blocks during UNKNOWN/DISCOVERING/ERROR states
- Background read gating: defers background reads when device is BUSY
- Read request caching with policy-based TTL
- In-flight request coalescing

### Device Safety Config (`src/lib/config/deviceSafetySettings.ts`)

- Four modes: RELAXED, BALANCED (default), CONSERVATIVE, TROUBLESHOOTING
- FTP concurrency: 1-4 depending on mode
- All parameters user-overridable via localStorage

## 2026-03-24 — Home Page and Machine Controls

### Machine Controls (`src/pages/home/components/MachineControls.tsx`)

- Quick Actions grid: Reset, Reboot, Pause/Resume, Power Off, Menu Button, Save RAM, Restore Snapshot
- Controls come from `useC64MachineControl()` hook → `useMutation()` calling `api.machineReset()` etc.
- `runMachineTask()` gates one task at a time via ref+state

### Missing from UI

Power Cycle, Reboot (Clear Memory), Save C64 Memory, Save REU Memory — all Telnet-only.

### Mock Infrastructure

- `src/lib/mock/mockServer.ts` — MockC64U native plugin for REST mock
- `src/lib/native/mockC64u.ts` / `mockC64u.web.ts` — Capacitor mock bridge
- No Telnet mock exists

## 2026-03-24 — Firmware Telnet Server Analysis

### Connection Handling (`1541ultimate/software/network/socket_gui.cc`)

- Telnet server listens on port 23, backlog 2
- Each connection spawns a FreeRTOS task (`socket_gui_task`) at `PRIO_USERIFACE`
- Each task creates independent: `HostStream`, `UserInterface`, `BrowsableRoot`, `TreeBrowser`
- Socket receive timeout: 200ms
- Authentication: plaintext password prompt, exponential delay on failure (250ms → 4s)

### Screen Rendering (`1541ultimate/software/io/stream/screen_vt100.cc`)

- Fixed 60×24 grid
- VT100 escape sequences: cursor positioning (`\e[r;cH`), color (SGR), reverse (`\e[7m`)
- Line-drawing via alternate charset (`\e(0` / `\e(B`)
- Screen clear via RIS (`\ec`)
- Init: Telnet DONT LINEMODE + WILL ECHO + RIS

### Key Input (`1541ultimate/software/io/stream/keyboard_vt100.cc`)

- Standard VT100 escape sequences: `\e[A`-`\e[D` for arrows, `\e[N~` for function keys
- F1=`\e[11~`, F5=`\e[15~`, F7=`\e[18~`

### Critical F-key Mapping (`userinterface.cc:612-616`)

- `KEY_F1 → KEY_PAGEUP` (Page Up, NOT action menu)
- `KEY_F3 → KEY_HELP` (Help)
- **`KEY_F5 → KEY_TASKS` (Action Menu)**
- `KEY_F7 → KEY_PAGEDOWN` (Page Down)
- **The existing `telnet-spec.md` incorrectly says F1 opens the action menu. It is F5.**

### Menu System (`1541ultimate/software/userinterface/task_menu.cc`)

- `TaskMenu` collects actions from all `ObjectWithMenu` subsystems
- Actions organized into `TaskCategory` groups (Power & Reset, Built-in Drive A, etc.)
- Category names and action labels come from subsystem registrations
- Menu items dynamically enabled/disabled based on current device state

## 2026-03-24 — Firmware Concurrency Model (Critical Finding)

### SubSystem Mutex (`1541ultimate/software/infra/subsys.h:53-61`)

- Each `SubSystem` instance has its own FreeRTOS mutex (`xSemaphoreCreateMutex()`)
- SubSystem IDs: C64(1), Drive_A(2), Drive_B(3), Drive_C(4), IEC(7), Printer(10), etc.

### SubsysCommand Execution (`1541ultimate/software/infra/subsys.cc:4-31`)

- `SubsysCommand::execute()` looks up subsystem by ID
- Takes per-subsystem mutex with **1-second timeout** (`xSemaphoreTake(myMutex, 1000)`)
- If lock acquired: executes command, releases lock
- If lock NOT acquired: returns `SSRET_NO_LOCK` (maps to HTTP 423 Locked)

### REST → SubSystem Path (`1541ultimate/software/api/route_machine.cc`)

- REST handlers (reset, reboot, poweroff) create `SubsysCommand` and call `execute()`
- HTTP daemon is single-threaded (`HTTPServerRunLoop`)
- REST operations are inherently serialized by the HTTP server loop

### Telnet → SubSystem Path (`1541ultimate/software/userinterface/context_menu.cc:124-141`)

- Menu action selection calls `ContextMenu::executeSelected()`
- Creates `SubsysCommand` with the Telnet session's `UserInterface` reference
- Calls `execute()` — same path as REST, same per-subsystem mutex

### Conclusion

- **REST, FTP, and Telnet converge on the same SubsysCommand::execute() path**
- **Per-subsystem mutex provides thread safety** — not a global lock
- **Cross-subsystem operations are fully concurrent** (e.g., REST config read + Telnet C64 power cycle)
- **Same-subsystem operations are serialized** by the firmware mutex with 1s timeout
- **No global device-wide lock exists** — C64 Commander does NOT need a cross-protocol queue

## 2026-03-24 — Specification Written

Created `doc/c64/telnet/telnet-integration-spec.md` with:

- Evidence-backed concurrency answer
- Telnet protocol findings with VT100 details
- Transport architecture (native TCP for Android/iOS, disabled on web)
- Independent Telnet scheduler design (concurrency 1, parallel to REST/FTP)
- VT100 screen parser design
- Label-based menu navigator state machine
- Deterministic mock with failure injection
- Action abstraction and capability mapping
- UI placement for Home page Quick Actions
- Platform support strategy
- Firmware compatibility strategy
- 4-phase implementation plan
- Acceptance criteria
