# Telnet Integration Specification

## 1. Executive Summary

This specification defines how C64 Commander introduces Telnet-based control for C64 Ultimate functionality not exposed via REST. This covers two distinct capabilities:

1. **Action menu automation** — Telnet-only device actions (Power Cycle, Save Memory, IEC/Printer controls, etc.) via label-based menu navigation
2. **CommoServe search** — Online content search, browsing, and run/mount of C64 software via the firmware's built-in search form

The design adds a Telnet transport client, a VT100 screen parser (with both menu and form detection), a label-based menu navigator, a form-based CommoServe navigator, deterministic mocks, and native UI surfaces — all integrated with the existing device interaction scheduling infrastructure.

The primary research finding is that **Telnet can safely operate concurrently with REST and FTP** because the firmware serializes per-subsystem access through FreeRTOS mutexes. C64 Commander does not need a global device action queue across all three protocols.

---

## 2. Concurrency Answer (Evidence-Based)

### 2.1 Question

Can Telnet be interacted with independently of FTP and REST, or must all protocol activity share one queue?

### 2.2 Answer

**Telnet can operate independently.** No global serialization queue is required.

### 2.3 Evidence

| Finding                                                                                               | Source                                                                                                       |
| ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Each Telnet session runs in its own FreeRTOS task at `PRIO_USERIFACE`                                 | `1541ultimate/software/network/socket_gui.cc:222` — `xTaskCreate(socket_gui_task, ..., PRIO_USERIFACE, ...)` |
| Each Telnet session creates a private `UserInterface` instance with private screen and keyboard state | `socket_gui.cc:149-154` — `new UserInterface(...)`, `new TreeBrowser(...)`                                   |
| REST runs in a single HTTP daemon task                                                                | `1541ultimate/software/network/httpd.cc:38` — `HTTPServerRunLoop(&srv, Dispatch)`                            |
| FTP runs in its own task(s) with semaphore-based session management                                   | `1541ultimate/software/network/ftpd.cc:865` — semaphore usage                                                |
| All three protocols converge on `SubsysCommand::execute()`                                            | `1541ultimate/software/infra/subsys.cc:4-31`                                                                 |
| `SubsysCommand::execute()` takes a per-subsystem FreeRTOS mutex with 1-second timeout                 | `subsys.cc:19` — `xSemaphoreTake(subsys->myMutex, 1000)`                                                     |
| Each SubSystem has its own mutex, created at construction                                             | `1541ultimate/software/infra/subsys.h:60` — `myMutex = xSemaphoreCreateMutex()`                              |
| If mutex cannot be obtained, command returns `SSRET_NO_LOCK`                                          | `subsys.cc:24-25`                                                                                            |
| REST API handlers (reset, reboot, poweroff) create `SubsysCommand` and call `execute()`               | `1541ultimate/software/api/route_machine.cc:24-67`                                                           |
| Telnet menu actions create `SubsysCommand` via `ContextMenu::executeSelected()` and call `execute()`  | `1541ultimate/software/userinterface/context_menu.cc:124-141`                                                |

### 2.4 Implications

- Operations targeting **different** subsystems (e.g., REST config read + Telnet C64 power cycle) execute truly concurrently.
- Operations targeting the **same** subsystem are serialized by the firmware mutex. One request waits up to 1 second; if it cannot get the lock, it fails with `SSRET_NO_LOCK` (HTTP 423 Locked).
- C64 Commander's existing REST error handling (backoff, retry, circuit breaker) gracefully handles occasional lock failures.
- No C64 Commander-level cross-protocol serialization is needed.

---

## 3. Telnet Protocol Findings

### 3.1 Connection

- TCP port 23, standard Telnet
- Authentication: same network password as REST/FTP, transmitted in plaintext after `Password:` prompt
- Socket receive timeout: 200ms (`socket_gui.cc:219`)
- Listen backlog: 2 (`socket_gui.cc:206`)

### 3.2 Screen Model

| Property           | Value                                                                    | Source                                          |
| ------------------ | ------------------------------------------------------------------------ | ----------------------------------------------- |
| Width              | 60 columns                                                               | `screen_vt100.h:26` — `get_size_x()` returns 60 |
| Height             | 24 rows                                                                  | `screen_vt100.h:27` — `get_size_y()` returns 24 |
| Encoding           | ASCII + VT100 escape sequences                                           | `screen_vt100.cc`                               |
| Line drawing       | VT100 alternate character set (`\e(0` / `\e(B`)                          | `screen_vt100.cc:87-97`                         |
| Cursor positioning | `\e[row;colH` (1-based)                                                  | `screen_vt100.cc:68`                            |
| Color              | VT100 SGR sequences                                                      | `screen_vt100.cc:29-30`                         |
| Reverse video      | `\e[7m` / `\e[27m`                                                       | `screen_vt100.cc:43-48`                         |
| Screen clear       | `\ec` (RIS)                                                              | `screen_vt100.cc:61`                            |
| Init sequence      | `\xff\xfe\x22\xff\xfb\x01` (Telnet DONT LINEMODE + WILL ECHO) then `\ec` | `screen_vt100.cc:15-16`                         |

### 3.3 Key Input (VT100 Terminal → Firmware)

| Key      | VT100 Sequence | Firmware Internal Code                  | Purpose              |
| -------- | -------------- | --------------------------------------- | -------------------- |
| F5       | `\e[15~`       | `KEY_F5` (0x87) → `KEY_TASKS` (0x1FC)   | **Open action menu** |
| F1       | `\e[11~`       | `KEY_F1` (0x85) → `KEY_PAGEUP` (0x92)   | Page up              |
| F3       | `\e[13~`       | `KEY_F3` (0x86) → `KEY_HELP` (0x1FB)    | Help                 |
| F7       | `\e[18~`       | `KEY_F7` (0x88) → `KEY_PAGEDOWN` (0x95) | Page down            |
| Up       | `\e[A`         | `KEY_UP` (0x91)                         | Navigate up          |
| Down     | `\e[B`         | `KEY_DOWN` (0x12)                       | Navigate down        |
| Right    | `\e[C`         | `KEY_RIGHT` (0x1D)                      | Enter submenu        |
| Left     | `\e[D`         | `KEY_LEFT` (0x9D)                       | Leave submenu        |
| Enter    | `\r` (0x0D)    | `KEY_RETURN` (0x0D)                     | Execute / select     |
| Escape   | `\e` (0x1B)    | `KEY_ESCAPE` (0x1B)                     | Exit                 |
| Run/Stop | —              | `KEY_BREAK` (0x11)                      | Leave menu / back    |

**Action menu key**: On Ultimate 64 devices, the action menu is opened with **F5**, not F1. F1 is Page Up. Confirmed from firmware source: `userinterface.cc:615` — `case KEY_F5: c = KEY_TASKS; break;`. On C64 Ultimate devices, F1 opens the action menu directly. The client must detect the device type and use the correct key.

| Key | VT100 Sequence | Firmware Internal Code          | Purpose             |
| --- | -------------- | ------------------------------- | ------------------- |
| F6  | `\e[17~`       | `KEY_F6` → `KEY_SEARCH` (0x1FD) | **Open CommoServe** |

F6 opens the CommoServe online content search. This key mapping is consistent across both C64U and U64 devices. See section 10b for the full CommoServe integration design.

### 3.4 Menu Rendering

- Menus render as bordered windows overlaid on the file browser
- Borders use VT100 line-drawing characters (alternate charset)
- Selected item is indicated by reverse video (`\e[7m`)
- Submenus open to the right of the parent menu
- Menu labels are rendered with `output_fixed_length()` which pads with spaces to fixed width

---

## 4. Recommended Architecture

### 4.1 Module Structure

```text
src/lib/telnet/
  telnetClient.ts          # Transport layer (TCP socket abstraction)
  telnetSession.ts         # Session lifecycle (connect, authenticate, disconnect)
  telnetScreenParser.ts    # VT100 screen buffer parser
  telnetMenuNavigator.ts   # Label-based menu navigation state machine
  telnetActionExecutor.ts  # High-level action API (e.g., executePowerCycle())
  telnetTypes.ts           # Shared types
  telnetMock.ts            # Deterministic mock for testing
  __tests__/               # Unit tests

src/lib/native/
  telnetSocket.ts          # Capacitor plugin bridge (Android/iOS native TCP)

android/app/src/main/java/.../telnet/
  TelnetSocketPlugin.kt   # Android native TCP socket plugin
```

### 4.2 Layer Diagram

```text
UI (HomePage QuickActions)
  ↓
telnetActionExecutor (action API)
  ↓
deviceInteractionManager (telnetScheduler, circuit breaker, tracing)
  ↓
telnetMenuNavigator (label-based nav state machine)
  ↓
telnetScreenParser (VT100 buffer → structured screen)
  ↓
telnetSession (connect, auth, keepalive)
  ↓
telnetClient / telnetSocket (TCP transport)
  ↓
C64 Ultimate (port 23)
```

---

## 5. Scheduling Model

### 5.1 Recommendation: Independent Telnet Scheduler

Add a third `InteractionScheduler` instance alongside the existing `restScheduler` and `ftpScheduler`:

```typescript
const TELNET_MAX_CONCURRENCY = 1;
const telnetScheduler = new InteractionScheduler(() => TELNET_MAX_CONCURRENCY);
```

### 5.2 Rationale

- Firmware mutexes provide per-subsystem serialization — no C64 Commander-level cross-protocol lock is needed.
- Telnet actions are user-initiated, rare, and short-lived (typically < 2 seconds).
- At most one Telnet action executes at a time (concurrency 1 within the Telnet scheduler).
- REST continues at its own concurrency 1 in parallel.
- Worst case: a REST request targeting the same subsystem as a Telnet action gets `SSRET_NO_LOCK` (HTTP 423). Existing backoff handles this.

### 5.3 Interaction Sequencing Within a Telnet Action

A single Telnet action (e.g., "Power Cycle") consists of multiple send/receive cycles:

1. Send F5 → read screen → verify action menu visible
2. Send Down/Up keys → read screen → verify target category highlighted
3. Send Right → read screen → verify submenu visible
4. Send Down/Up keys → read screen → verify target action highlighted
5. Send Enter → action executes

The entire sequence holds the Telnet scheduler slot. Individual send/read cycles are not independently schedulable.

### 5.4 Optional Enhancement: Background Read Pause

During a Telnet action sequence, optionally suppress background REST polling (health checks, config refreshes) to reduce contention. This reuses the existing `waitForBackgroundReadsToResume()` gate in `deviceInteractionManager.ts`.

### 5.5 Device Safety Integration

The Telnet scheduler integrates with the existing `DeviceSafetyConfig`:

- Circuit breaker applies to Telnet (shared device-level circuit state)
- Device state gating applies (no Telnet during UNKNOWN/DISCOVERING/ERROR)
- Telnet errors increment a separate `telnetErrorStreak` with its own backoff

---

## 6. Telnet Client Design

### 6.1 Transport Abstraction

```typescript
interface TelnetTransport {
  connect(host: string, port: number): Promise<void>;
  disconnect(): Promise<void>;
  send(data: Uint8Array): Promise<void>;
  read(timeoutMs: number): Promise<Uint8Array>;
  isConnected(): boolean;
}
```

### 6.2 Platform Implementations

| Platform | Implementation                                                            | TCP Access            |
| -------- | ------------------------------------------------------------------------- | --------------------- |
| Android  | Capacitor native plugin (`TelnetSocketPlugin.kt`) using `java.net.Socket` | Direct TCP            |
| iOS      | Capacitor native plugin (Swift) using `NWConnection` (Network framework)  | Direct TCP            |
| Web      | Not supported; Telnet features hidden                                     | No raw TCP in browser |

### 6.3 Session Lifecycle

```typescript
interface TelnetSession {
  connect(host: string, port: number, password?: string): Promise<void>;
  sendKey(key: TelnetKey): Promise<void>;
  readScreen(timeoutMs?: number): Promise<TelnetScreen>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
}
```

- **Connection**: Lazy — established on first Telnet action invocation.
- **Authentication**: After TCP connect, detect `Password:` prompt, send password + newline, wait for success.
- **Keepalive**: Periodic no-op reads to detect connection drops. If dead, reconnect on next action.
- **Reconnection**: Automatic on connection loss. Max 2 retries with 500ms delay.
- **Disconnect**: On device host change, explicit disconnect, or 5-minute idle timeout.

### 6.4 Key Encoding

```typescript
const TELNET_KEYS = {
  F1: "\x1b[11~", // Open action menu (C64U) or Page Up (U64)
  F5: "\x1b[15~", // Open action menu (U64)
  F6: "\x1b[17~", // Open CommoServe search
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  RIGHT: "\x1b[C", // Enter submenu
  LEFT: "\x1b[D", // Leave submenu
  ENTER: "\r",
  ESCAPE: "\x1b",
  HOME: "\x1b[1~", // Clear field (CommoServe)
  PLUS: "+", // Cycle dropdown up (CommoServe)
  MINUS: "-", // Cycle dropdown down (CommoServe)
} as const;
```

---

## 7. Screen Parser Design

### 7.1 Screen Buffer

```typescript
interface TelnetScreen {
  width: 60;
  height: 24;
  cells: ScreenCell[][]; // [row][col]
  menus: ParsedMenu[]; // Detected menu overlays
  form: ParsedForm | null; // Detected CommoServe form (if present)
  selectedItem: string | null; // Currently highlighted label
  titleLine: string; // First line (product/version string)
  screenType: ScreenType; // Detected screen type
}

type ScreenType =
  | "file_browser" // Default file browser
  | "action_menu" // Action menu overlay (F5/F1)
  | "search_form" // CommoServe search form (F6)
  | "search_results" // CommoServe results list
  | "file_entries" // CommoServe file entries
  | "unknown"; // Unrecognized screen

interface ScreenCell {
  char: string;
  reverse: boolean; // Selection highlight
  color: number;
}

interface ParsedMenu {
  level: number; // 0 = top-level, 1 = submenu
  items: MenuItem[];
  selectedIndex: number;
  bounds: { x: number; y: number; width: number; height: number };
}

interface MenuItem {
  label: string;
  selected: boolean; // Reverse video = selected
  enabled: boolean;
}

interface ParsedForm {
  title: string; // e.g., "CommoServe File Search"
  fields: FormField[];
  selectedIndex: number; // Currently focused field
  bounds: { x: number; y: number; width: number; height: number };
}

interface FormField {
  label: string; // e.g., "Name", "Category"
  value: string; // Current value or empty string
  type: "text" | "dropdown" | "submit"; // Input type
  selected: boolean; // Currently focused
  isEmpty: boolean; // Shows placeholder underscores
}
```

### 7.2 VT100 Parser Responsibilities

1. **Escape sequence processing**: Track cursor position, color state, reverse mode, alternate character set.
2. **Character accumulation**: Build 60×24 cell grid from stream data.
3. **Menu detection**: Identify bordered rectangles using line-drawing characters (VT100 alternate charset: `l` = top-left, `k` = top-right, `m` = bottom-left, `j` = bottom-right, `x` = vertical, `q` = horizontal).
4. **Selection detection**: Identify cells with reverse video attribute as the selected item.
5. **Label extraction**: Extract trimmed text content from menu item rows.
6. **Form detection**: Identify CommoServe search form by title ("CommoServe File Search" or "Assembly 64 Query Form") and field layout (label + colon + value pattern).
7. **Form field parsing**: Extract field labels, current values, and empty state (underscores indicate empty).
8. **Screen type classification**: Distinguish between file browser, action menu, search form, results list, and file entries based on structural cues.

### 7.3 Screen Type Detection

The parser classifies the screen based on these heuristics:

| Screen Type      | Detection Signal                                                    |
| ---------------- | ------------------------------------------------------------------- |
| `file_browser`   | No overlays; status bar visible at bottom                           |
| `action_menu`    | Bordered menu overlay with category labels (Power & Reset, etc.)    |
| `search_form`    | 40-column modal with title containing "File Search" or "Query Form" |
| `search_results` | 40-column modal with item list (no field labels)                    |
| `file_entries`   | 40-column modal with filename + extension + size columns            |
| `unknown`        | None of the above patterns match                                    |

### 7.4 Form Field Parsing

CommoServe form fields follow a consistent layout within the 40-column modal:

```text
{Label}:   {value or underscores}
```

- **Label**: Left-aligned, capitalized, max 8 characters, followed by colon and spaces
- **Value position**: Column 10 within the modal window
- **Empty indicator**: `__________________` (underscores) when no value is set
- **Populated**: Value text replaces underscores
- **Submit button**: Special field with label `$`, rendered as `<< Submit >>`
- **Dropdown popup**: When a dropdown field is activated, a bordered popup appears to the right of the field with selectable options

### 7.5 Frame Synchronization

The firmware does not send explicit frame boundaries. The parser uses:

- A **read timeout** (200ms, matching firmware socket timeout) to detect frame completion.
- **Cursor position heuristic**: After a full redraw, the cursor rests at the status line.
- **Change detection**: Compare new frame to previous; report `unchanged` if identical (avoids spurious navigation retries).

---

## 8. Menu Navigator Design

### 8.1 State Machine

```text
IDLE → OPENING_MENU → SCANNING_MENU → NAVIGATING_TO_CATEGORY
  → ENTERING_SUBMENU → SCANNING_SUBMENU → NAVIGATING_TO_ACTION
  → EXECUTING → VERIFYING → COMPLETE | ERROR
```

### 8.2 Navigation Algorithm

```text
navigate(path: [categoryLabel, actionLabel]):
  1. Send F5
  2. Read screen, verify action menu is visible (detect bordered overlay)
  3. Parse menu items from screen
  4. Find category matching path[0] by trimmed case-insensitive comparison
  5. If category is not currently selected:
     a. Calculate direction (up or down) and distance
     b. Send arrow keys to move cursor
     c. Read screen after each key, verify cursor moved to expected item
  6. Send RIGHT to enter submenu
  7. Read screen, verify submenu is visible
  8. Parse submenu items
  9. Find action matching path[1] by trimmed case-insensitive comparison
  10. Navigate to action (same as step 5)
  11. Send ENTER to execute
  12. Read screen to verify action was executed (menu closes or confirmation appears)
```

### 8.3 Label Matching

```typescript
function matchLabel(screenLabel: string, targetLabel: string): boolean {
  const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return normalize(screenLabel) === normalize(targetLabel);
}
```

Matching must be case-insensitive, whitespace-normalized, and trimmed. Partial prefix matching is NOT used — labels must match fully. This prevents false matches when firmware truncates labels in narrow menus. If a label does not match fully but a prefix matches, the navigator should log a warning and continue searching.

### 8.4 Error Recovery

| Condition                                | Recovery                                                                         |
| ---------------------------------------- | -------------------------------------------------------------------------------- |
| Menu not visible after F5                | Retry F5 once, then fail                                                         |
| Target category not found                | Fail with descriptive error listing available categories                         |
| Target action not found in submenu       | Fail with descriptive error listing available actions                            |
| Screen unchanged after key press         | Retry key once, then fail (firmware may be busy)                                 |
| Desynchronized state (unexpected screen) | Send ESCAPE repeatedly (max 5) to return to file browser, then retry from step 1 |
| Connection lost during navigation        | Reconnect and retry entire action from start                                     |
| Timeout waiting for screen update        | Fail after 3 seconds total per navigation step                                   |

### 8.5 Timeout Budget

Total timeout for a single Telnet action: **10 seconds**. This is generous for a sequence that typically takes 1-2 seconds. Individual read timeouts: 500ms per screen read, with up to 3 retries per step.

### 8.6 CommoServe Navigation

CommoServe uses a fundamentally different navigation model from the action menu. Instead of a hierarchical menu, it is a multi-screen form-based flow with text input. The navigator must support both models.

#### 8.6.1 CommoServe State Machine

```text
IDLE → OPENING_SEARCH → LOADING_PRESETS → FORM_READY
  → FILLING_FIELDS → SUBMITTING → WAITING_RESULTS
  → RESULTS_READY → BROWSING_ENTRIES → FILE_ACTIONS
  → COMPLETE | ERROR
```

#### 8.6.2 Search Flow Algorithm

```text
commoserveSearch(query: CommoServeQuery):
  1. Send F6
  2. Read screen, wait for search form modal (detect title "File Search" or "Query Form")
     - If "No Valid Network Link" popup appears → fail with network error
     - If "Could not connect" popup appears → fail with connection error
  3. Parse form fields from screen

  For each field in query (Name, Group, Handle, Event):
    4. Navigate to field (UP/DOWN until field is selected)
    5. If field has a value in query:
       a. Type value characters directly (firmware supports quick-type)
       b. Send ENTER to confirm
    6. Read screen, verify field value updated

  For each dropdown field in query (Category, Date, Type, Sort, Order):
    7. Navigate to field (UP/DOWN until field is selected)
    8. If field has a value in query:
       a. Send ENTER or RIGHT to open dropdown popup
       b. Read screen, verify dropdown popup visible
       c. Navigate to target option by label (UP/DOWN)
       d. Send ENTER to select
    9. Read screen, verify field value updated

  10. Navigate to Submit button (DOWN until << Submit >> is selected)
  11. Send ENTER
  12. Read screen, wait for results list or "< No Items >"
  13. Return results
```

#### 8.6.3 Result Selection Algorithm

```text
commoserveSelectResult(index: number):
  1. From results list, navigate to target result (UP/DOWN)
  2. Send ENTER or RIGHT to view file entries
  3. Read screen, verify file entries visible
  4. Return file list
```

#### 8.6.4 File Action Algorithm

```text
commoserveRunFile(fileIndex: number, action: string):
  1. From file entries, navigate to target file (UP/DOWN)
  2. Send ENTER to open context menu
  3. Read screen, verify context menu visible
  4. Navigate to target action by label (UP/DOWN)
  5. Send ENTER to execute
  6. Read screen to verify action executed
```

#### 8.6.5 CommoServe Query Type

```typescript
interface CommoServeQuery {
  name?: string;
  group?: string;
  handle?: string;
  event?: string;
  category?: string; // Must match a preset label (e.g., "Demos", "Games")
  date?: string; // Must match a preset value (e.g., "1986")
  type?: string; // Must match a preset value (e.g., "d64", "sid")
  sort?: string; // Must match a preset value (e.g., "Name", "Year")
  order?: string; // Must match a preset value (e.g., "Ascending", "Descending")
}

interface CommoServeResult {
  name: string;
  group?: string;
  year?: number;
  index: number; // Position in results list
}

interface CommoServeFileEntry {
  filename: string;
  extension: string;
  size: string; // As displayed (e.g., "171K")
  index: number;
}
```

#### 8.6.6 CommoServe Error Recovery

| Condition                             | Recovery                                                 |
| ------------------------------------- | -------------------------------------------------------- |
| Search form not visible after F6      | Retry F6 once; if popup detected, report error and close |
| Network error popup                   | Close popup (ENTER), fail with descriptive network error |
| Empty results (`< No Items >`)        | Return empty result set (not an error)                   |
| Dropdown option not found             | Fail with error listing available options                |
| File entry not found                  | Fail with error listing available files                  |
| File action not found in context menu | Fail with error listing available actions                |
| Timeout waiting for results           | Fail after 15 seconds (network query can be slow)        |
| Connection lost during search         | Reconnect and retry from beginning                       |

#### 8.6.7 CommoServe Timeout Budget

CommoServe operations involve network requests to the archive service, so timeouts must be more generous than action menu navigation:

- **Search form open**: 5 seconds (includes preset fetching from server)
- **Query submission**: 15 seconds (server-side search can be slow)
- **File entry loading**: 10 seconds (fetches entry metadata from server)
- **File download + action**: 30 seconds (file must be downloaded to device cache before action)
- **Total per search flow**: 60 seconds maximum

---

## 9. Telnet Mock Design

### 9.1 Mock Architecture

```typescript
class TelnetMock implements TelnetTransport {
  private screen: MockScreenBuffer; // 60×24 grid
  private menuState: MockMenuState; // Current menu/submenu state
  private searchState: MockSearchState; // CommoServe search state
  private connected: boolean;
  private authenticated: boolean;
}
```

### 9.2 Responsibilities

1. **Screen rendering**: Maintain a 60×24 character buffer with color and reverse attributes.
2. **Menu hierarchy**: Store the full menu tree (categories → actions) as a fixture.
3. **Cursor / selection state**: Track which menu is open, which item is selected.
4. **Key handling**: Process VT100 input sequences and update menu state accordingly.
5. **Authentication**: Simulate password prompt and accept/reject based on configured password.
6. **Output generation**: Generate VT100 escape sequences matching the real firmware's `Screen_VT100` output format.
7. **CommoServe form**: Simulate the 40-column search form modal with field navigation, text input, and dropdown popups.
8. **CommoServe results**: Return configurable search results from fixtures and support result selection and file entry browsing.
9. **CommoServe file actions**: Simulate file context menus on search result entries.

### 9.3 Deterministic Fixtures

```typescript
const DEFAULT_MENU_FIXTURE: MenuFixture = {
  categories: [
    {
      label: "Power & Reset",
      actions: [
        { label: "Reset C64", enabled: true },
        { label: "Reboot C64", enabled: true },
        { label: "Reboot (Clr Mem)", enabled: true },
        { label: "Power OFF", enabled: true },
        { label: "Power Cycle", enabled: true },
        { label: "Save C64 Memory", enabled: true },
        { label: "Save REU Memory", enabled: true },
      ],
    },
    // ... remaining categories from c64u-telnet-spec.md section 5.1
  ],
};

const DEFAULT_SEARCH_FIXTURE: SearchFixture = {
  title: "CommoServe File Search", // or "Assembly 64 Query Form" for U64
  presets: {
    category: [
      { name: "Apps", aqlKey: "apps" },
      { name: "Demos", aqlKey: "demos" },
      { name: "Games", aqlKey: "games" },
      { name: "Graphics", aqlKey: "graphics" },
      { name: "Music", aqlKey: "music" },
    ],
    date: [
      { name: "1980", aqlKey: "1980" },
      // ... years through 1996+
    ],
    type: [
      { name: "crt", aqlKey: "crt" },
      { name: "d64", aqlKey: "d64" },
      { name: "d71", aqlKey: "d71" },
      { name: "d81", aqlKey: "d81" },
      { name: "sid", aqlKey: "sid" },
      { name: "t64", aqlKey: "t64" },
      { name: "tap", aqlKey: "tap" },
    ],
    sort: [
      { name: "Name", aqlKey: "name" },
      { name: "Year", aqlKey: "year" },
    ],
    order: [
      { name: "Ascending", aqlKey: "asc" },
      { name: "Descending", aqlKey: "desc" },
    ],
  },
  results: [
    {
      name: "JollyDisk",
      entries: [{ filename: "jollydisk.d64", extension: "D64", size: "171K" }],
    },
    {
      name: "Joyride",
      entries: [
        { filename: "joyride.d64", extension: "D64", size: "171K" },
        { filename: "joyride_license.txt", extension: "TXT", size: "1K" },
      ],
    },
    // ... additional fixture results
  ],
};
```

### 9.4 Timing Simulation

- **Synchronous mode** (default for unit tests): Instant screen updates, no delays.
- **Realistic mode** (for integration tests): Configurable per-keystroke delay (default 50ms), per-redraw delay (default 100ms), and optional partial-redraw simulation.

### 9.5 Failure Injection

The mock supports injecting:

- Connection refusal
- Authentication failure
- Mid-action disconnect
- Delayed screen updates (to test timeout handling)
- Missing menu items (to test "item not found" recovery)
- Extra/reordered menu items (to test label-based navigation robustness)
- CommoServe network unavailable (triggers "No Valid Network Link" popup)
- CommoServe server unreachable (triggers "Could not connect" popup)
- CommoServe empty results (returns `< No Items >`)
- CommoServe slow query response (to test extended timeout handling)

### 9.6 Test Verification

Tests use the mock to verify:

- Parser correctly extracts menu items from VT100 output
- Navigator reaches the correct item by label regardless of item order
- Navigator fails gracefully when items are missing
- Recovery logic works when the screen is in an unexpected state
- Authentication completes correctly
- Connection lifecycle (connect, reconnect, idle timeout) works as expected
- CommoServe form fields are correctly detected and populated
- CommoServe dropdown selection works with label matching
- CommoServe search returns results and handles empty results
- CommoServe file entries display correctly and context menus work
- CommoServe network error popups are detected and handled

---

## 10. Action Abstraction

### 10.1 Telnet-Only Actions

These actions are not available via REST and require Telnet:

| Action              | Menu Path                          | Subsystem |
| ------------------- | ---------------------------------- | --------- |
| Power Cycle         | Power & Reset → Power Cycle        | C64       |
| Save REU Memory     | Power & Reset → Save REU Memory    | C64       |
| IEC Turn On         | Software IEC → Turn On             | IEC       |
| IEC Reset           | Software IEC → Reset               | IEC       |
| IEC Set Directory   | Software IEC → Set dir. here       | IEC       |
| Printer Flush/Eject | Printer → Flush/Eject              | Printer   |
| Printer Reset       | Printer → Reset                    | Printer   |
| Printer Turn On     | Printer → Turn On                  | Printer   |
| Save Config to File | Configuration → Save to File       | Config    |
| Clear Flash Config  | Configuration → Clear Flash Config | Config    |
| Clear Debug Log     | Developer → Clear Debug Log        | Developer |
| Save Debug Log      | Developer → Save Debug Log         | Developer |
| Save EDID to File   | Developer → Save EDID to file      | Developer |

### 10.2 Action Executor API

```typescript
interface TelnetActionExecutor {
  executePowerCycle(): Promise<void>;
  executeRebootClearMemory(): Promise<void>;
  executeSaveC64Memory(): Promise<void>;
  executeSaveReuMemory(): Promise<void>;
  executeIecTurnOn(): Promise<void>;
  executeIecReset(): Promise<void>;
  executePrinterFlush(): Promise<void>;
  executePrinterReset(): Promise<void>;
  executePrinterTurnOn(): Promise<void>;
  executeSaveConfigToFile(): Promise<void>;
  executeClearFlashConfig(): Promise<void>;
  // Developer actions omitted from initial implementation
}
```

Each method:

1. Acquires the Telnet scheduler slot via `withTelnetInteraction()`
2. Ensures a Telnet session is connected and authenticated
3. Calls `telnetMenuNavigator.navigate([category, action])`
4. Records trace events via `recordTelnetAction()`
5. Reports success or failure

### 10.3 Capability Registry Integration

Extend the existing action model with a `transport` field:

```typescript
type ActionTransport = "rest" | "telnet" | "rest+telnet";
```

For actions available via both REST and Telnet (e.g., Reset C64), prefer REST. Telnet is used only for actions not available via REST.

### 10.4 Migration Path

When firmware REST API adds coverage for currently Telnet-only actions, the action executor can transparently switch from Telnet to REST by updating the capability registry. No UI changes needed. The Telnet path becomes a fallback for older firmware versions.

---

## 10b. CommoServe Integration

### 10b.1 Overview

CommoServe is an online content search and download service accessible via `F6` from the Telnet file browser. It provides search, browsing, and direct run/mount of C64 software from a remote database.

This is fundamentally different from the action menu (section 10): instead of navigating a fixed hierarchical menu to trigger a device command, CommoServe involves form-based search with text input, server-driven results, multi-level browsing, and file actions. The client must handle:

- **Text input**: Typing characters into form fields
- **Dropdown selection**: Choosing from server-provided preset lists
- **Asynchronous results**: Waiting for network responses with appropriate timeouts
- **Three-level browsing**: Search results → file entries → file actions
- **Network dependency**: Internet access required on the device (not just LAN)

### 10b.2 Firmware Architecture (Evidence)

| Component                   | Source                                                  | Role                                                                  |
| --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| `AssemblyInGui`             | `assembly_search.h:384-442`                             | Registers as `ObjectWithMenu`, handles F6 via `S_OpenSearch()`        |
| `AssemblySearch`            | `assembly_search.h:40-51`, `assembly_search.cc:37-56`   | TreeBrowser subclass; manages search UI lifecycle                     |
| `AssemblySearchForm`        | `assembly_search.h:13-26`, `assembly_search.cc:190-321` | Form state: field navigation, text edit, dropdown, submit             |
| `AssemblyResultsView`       | `assembly_search.h:28-38`, `assembly_search.cc:323-355` | Results list navigation; delegates file browsing to TreeBrowser       |
| `BrowsableQueryField`       | `assembly_search.h:53-206`                              | Individual form field with text or dropdown behavior                  |
| `BrowsableQueryResult`      | `assembly_search.h:281-356`                             | Single search result with path to `/a64/{id}/{category}/`             |
| `BrowsableDirEntryAssembly` | `assembly_entry.h:9-83`                                 | File entry wrapping standard `BrowsableDirEntry` for FileType actions |
| `Assembly`                  | `assembly.h:18-48`                                      | Network client: `get_presets()`, `send_query()`, `request_entries()`  |
| `FileSystemA64`             | `filesystem_a64.cc:23-121`                              | Virtual filesystem; downloads files to `/Temp/` cache on demand       |

### 10b.3 Key Firmware Behaviors

1. **Preset fetching**: On first F6, `BrowsableAssemblyRoot::fetchPresets()` calls `assembly.get_presets()` which fetches dropdown options from the server. Presets include category, date, type, sort, order with both display names and AQL keys.

2. **Query construction**: `AssemblySearchForm::send_query()` builds an AQL (Assembly Query Language) string from form fields: `(name:"value") & (category:games) & (type:d64)`. Text fields are quoted; dropdown fields use the `aqlKey` from presets.

3. **Network check**: `AssemblyInGui::S_OpenSearch()` calls `NetworkInterface::DoWeHaveLink()` before proceeding. If no network, a "No Valid Network Link" popup appears. If the server is unreachable, "Could not connect." appears.

4. **File caching**: Files are downloaded to `/Temp/` on the device via `FileSystemA64::file_open()`. Subsequent access of the same file uses the cached copy. The path format is `/a64/{id}/{category}/{filename}`.

5. **File actions**: `BrowsableDirEntryAssembly` wraps a standard `BrowsableDirEntry`, so all standard FileType actions (Run Disk, Mount Disk, View, etc.) work on downloaded files. The available actions depend on the file extension.

6. **Screen ownership**: `AssemblySearch` creates its own 40-column `Window` centered on screen. It handles keys directly at form level (level 0) and delegates to `TreeBrowser` at results/entries levels (level >= 1).

### 10b.4 CommoServe Executor API

```typescript
interface CommoServeExecutor {
  /** Search for content matching the given query */
  search(query: CommoServeQuery): Promise<CommoServeResult[]>;

  /** Get file entries for a specific search result */
  getEntries(resultIndex: number): Promise<CommoServeFileEntry[]>;

  /** Execute a file action (e.g., "Run Disk") on a specific file entry */
  executeFileAction(fileIndex: number, action: string): Promise<void>;

  /** Close the CommoServe search and return to file browser */
  close(): Promise<void>;

  /** Check if CommoServe is available (network + Telnet) */
  isAvailable(): Promise<boolean>;
}
```

Each method:

1. Acquires the Telnet scheduler slot via `withTelnetInteraction()`
2. Ensures a Telnet session is connected and authenticated
3. Delegates to the CommoServe navigator (section 8.6)
4. Records trace events via `recordTelnetAction()`
5. Reports success or failure with structured error types

### 10b.5 Error Types

```typescript
type CommoServeError =
  | { type: "no_network"; message: string }
  | { type: "server_unreachable"; message: string }
  | { type: "no_results" }
  | { type: "timeout"; phase: string; timeoutMs: number }
  | { type: "field_not_found"; field: string; available: string[] }
  | { type: "option_not_found"; field: string; option: string; available: string[] }
  | { type: "result_not_found"; index: number; count: number }
  | { type: "file_not_found"; index: number; count: number }
  | { type: "action_not_found"; action: string; available: string[] }
  | { type: "connection_lost" };
```

### 10b.6 Session State Management

CommoServe is stateful across multiple user interactions within a single search session. The executor must track the current screen state:

```typescript
type CommoServeSessionState =
  | { screen: "closed" }
  | { screen: "form"; fields: FormFieldState[] }
  | { screen: "results"; results: CommoServeResult[]; selectedIndex: number }
  | { screen: "entries"; entries: CommoServeFileEntry[]; selectedIndex: number }
  | { screen: "file_action_menu"; actions: string[]; selectedIndex: number };
```

Navigation between screens (e.g., returning from results to form to modify the query) uses LEFT/ESCAPE, matching the firmware's `TreeBrowser` level model.

---

## 11. UI Placement

### 11.1 Home Page — Quick Actions Section

Add to the existing "Quick Actions" grid in `MachineControls`:

| Action             | Icon                   | Variant  | Position                                |
| ------------------ | ---------------------- | -------- | --------------------------------------- |
| Power Cycle        | `RefreshCw` (or `Zap`) | `danger` | After existing Reboot, before Power Off |
| Reboot (Clear Mem) | `Trash2` + `Power`     | `danger` | After Power Cycle                       |

These are placed alongside Reset, Reboot, and Power Off because they are the same class of machine control action.

### 11.2 Home Page — Memory Section

Add under a new "Memory" subsection or alongside existing Save RAM controls:

| Action          | Icon       | Position                    |
| --------------- | ---------- | --------------------------- |
| Save C64 Memory | `Download` | Alongside existing Save RAM |
| Save REU Memory | `Download` | Alongside Save C64 Memory   |

### 11.3 Drive Manager Section

Add IEC controls to the existing Drive Manager component:

| Action          | Position          |
| --------------- | ----------------- |
| IEC Turn On/Off | Software IEC card |
| IEC Reset       | Software IEC card |

### 11.4 Printer Manager Section

Add controls to the existing Printer Manager component:

| Action              | Position     |
| ------------------- | ------------ |
| Printer Flush/Eject | Printer card |
| Printer Reset       | Printer card |
| Printer Turn On/Off | Printer card |

### 11.5 Configuration Actions

Config-related Telnet actions (Save to File, Clear Flash Config) belong in the existing configuration management dialogs on the Home page.

### 11.6 Developer Actions

Developer actions (Debug Log, EDID) should remain behind Settings → Diagnostics. They are not surfaced on the Home page.

### 11.7 Telnet Availability Indicator

When Telnet is unavailable (web platform, connection failure), Telnet-only action buttons are:

- Disabled with a tooltip: "Requires native app (Android/iOS)"
- Or hidden entirely if the platform is detected as web at startup

### 11.8 Telnet Transport Badge

The existing `useC64Connection` hook should be extended to track Telnet connectivity separately. A small indicator in the Home page header or Quick Actions section shows Telnet status when relevant (connected / disconnected / unavailable).

### 11.9 CommoServe Search UI

CommoServe provides a content search and download experience that should be surfaced as a dedicated feature in C64 Commander, not as a Telnet action button.

#### 11.9.1 Recommended Placement

A **"CommoServe"** entry point in the navigation — either:

- A card in the Home page Quick Actions section (icon: `Search` or `Globe`), or
- A dedicated tab/page accessible from the tab bar or a prominent Home page link

The entry point opens a native search UI that translates user input into CommoServe Telnet operations behind the scenes.

#### 11.9.2 Search Page Design

The search page should present the CommoServe query fields as native form controls rather than exposing the raw Telnet form:

| Field    | Control Type                 | Source                        |
| -------- | ---------------------------- | ----------------------------- |
| Name     | Text input                   | Free text                     |
| Group    | Text input                   | Free text                     |
| Handle   | Text input                   | Free text                     |
| Event    | Text input                   | Free text                     |
| Category | Native dropdown / chip group | Presets from server           |
| Date     | Native dropdown / picker     | Year presets from server      |
| Type     | Native dropdown / chip group | File type presets from server |
| Sort     | Native dropdown              | Sort presets from server      |
| Order    | Toggle (Asc/Desc)            | Order presets from server     |

#### 11.9.3 Results Page Design

Search results display as a scrollable list with:

- **Title** (release name)
- **Group** and **year** as secondary metadata when available
- Tap to expand → show file entries with type and size
- Tap a file entry → show available actions (Run Disk, Mount Disk, etc.)

#### 11.9.4 Availability and Platform Gating

- CommoServe requires both **Telnet connectivity** (native platform) and **internet access** on the device
- On web platform: the CommoServe entry point is hidden entirely
- On native without network: the entry point is visible but displays a "Device requires internet connection" message on activation
- Loading states must be prominent — search queries can take several seconds due to server latency

#### 11.9.5 Hook Design

```typescript
interface UseCommoServeReturn {
  /** Whether CommoServe is available (Telnet + network) */
  isAvailable: boolean;
  /** Whether a search is in progress */
  isSearching: boolean;
  /** Current search results */
  results: CommoServeResult[];
  /** File entries for the selected result */
  entries: CommoServeFileEntry[];
  /** Execute a search query */
  search: (query: CommoServeQuery) => Promise<void>;
  /** Select a result to view its entries */
  selectResult: (index: number) => Promise<void>;
  /** Execute a file action */
  executeFileAction: (fileIndex: number, action: string) => Promise<void>;
  /** Close the search session */
  close: () => Promise<void>;
  /** Error state */
  error: CommoServeError | null;
}
```

---

## 12. Platform Support Strategy

### 12.1 Android

- **Native plugin**: `TelnetSocketPlugin.kt` implementing `java.net.Socket` with `InputStream`/`OutputStream`.
- **Plugin interface**: `connect(host, port)`, `send(data)`, `read(timeoutMs)`, `disconnect()`, `isConnected()`.
- **Threading**: Socket I/O on a background thread (Kotlin coroutine or executor), results dispatched to JS via Capacitor bridge.
- **Pattern**: Follows existing `FtpClientPlugin.kt` structure.

### 12.2 iOS

- **Native plugin**: Swift Capacitor plugin using `NWConnection` (Network framework, available since iOS 12).
- **Plugin interface**: Same as Android.
- **Note**: iOS builds are CI-only. The plugin skeleton is created; full iOS testing deferred to CI pipeline.

### 12.3 Web

- **No raw TCP**: Browsers cannot open TCP sockets.
- **Telnet features disabled**: On web platform, `isTelnetAvailable()` returns `false`. Telnet-only action buttons are hidden or disabled.
- **Future option**: A WebSocket-to-Telnet proxy could be added to the Vite dev server for development/testing. This is not part of the initial implementation.

### 12.4 Detection

```typescript
function isTelnetAvailable(): boolean {
  if (isNativePlatform()) return true; // Android or iOS
  return false; // Web
}
```

---

## 13. Firmware Compatibility Strategy

### 13.1 Label-Based Navigation

The navigator never relies on menu item positions. It matches by label text. If the firmware adds, removes, or reorders items, the navigator still works as long as labels remain recognizable.

### 13.2 Fuzzy Label Tolerance

If an exact label match fails, the navigator:

1. Tries case-insensitive match (already default)
2. Tries prefix match (e.g., "Reboot (Clr" matches "Reboot (Clr Mem)")
3. Logs a warning about the partial match
4. Fails if no match is found

### 13.3 Menu Structure Discovery

On first connection (or on demand), the navigator can perform a full menu scan:

1. Open action menu (F5)
2. Enumerate all categories
3. For each category, enter submenu and enumerate actions
4. Record the discovered menu tree
5. Cache the tree for the session (invalidated on reconnect)

This discovered tree is used for:

- Diagnostics (show available Telnet actions)
- Capability detection (which actions are available on this firmware)
- Validation (verify expected actions exist before attempting navigation)

### 13.4 Firmware Version Detection

The title line contains the firmware version: `*** C64 Ultimate (V1.49) 1.1.0 *** Remote ***`. The parser extracts and stores this version string. If known-incompatible versions are discovered in the future, the Telnet client can warn or disable specific features.

---

## 14. Risks, Non-Goals, and Migration

### 14.1 Risks

| Risk                                                    | Mitigation                                                                       |
| ------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Firmware changes label text                             | Fuzzy matching + logged warnings + menu discovery                                |
| Firmware changes VT100 behavior                         | Parser is resilient to unknown sequences (ignores them)                          |
| Concurrent Telnet + REST causes subsystem mutex timeout | Existing backoff/retry handles occasional NO_LOCK; Telnet actions are rare       |
| Connection drops during navigation                      | Reconnect and retry full action from start                                       |
| Web users cannot use Telnet features                    | Clear UI indication; REST covers most common actions                             |
| Archive service unavailable or slow                     | Generous timeouts (15s query); clear error messaging; cached presets per session |
| CommoServe presets change server-side                   | Presets are fetched dynamically; UI adapts to available options                  |
| Device has no internet for CommoServe                   | Detect via firmware popup; disable CommoServe entry point with clear message     |

### 14.2 Non-Goals

- **Interactive terminal emulator**: This is not a general-purpose Telnet client. It automates specific actions and CommoServe search only.
- **File browser via Telnet**: File browsing uses FTP. Telnet is for action menu items and CommoServe search.
- **Streaming via Telnet**: Video/audio/debug streams have dedicated REST endpoints.
- **Multi-session Telnet**: Only one Telnet session per device is maintained.
- **Full CommoServe parity**: The native search UI presents the most useful fields. Obscure or rarely used server-side options may be omitted from the initial implementation.

### 14.3 REST Migration Path

When firmware REST API gains coverage for a currently Telnet-only action:

1. Add the REST endpoint to `c64api.ts`
2. Update the capability registry to mark the action as `rest+telnet`
3. The action executor automatically prefers REST
4. Telnet path remains as fallback for older firmware

---

## 15. Implementation Plan

### Phase 1: Transport and Parser (Foundation)

1. Create `telnetTypes.ts` with all shared type definitions (including CommoServe types)
2. Create `telnetClient.ts` transport abstraction
3. Create Android `TelnetSocketPlugin.kt` native plugin
4. Create `telnetSession.ts` with connect/auth/disconnect
5. Create `telnetScreenParser.ts` VT100 parser with screen type detection and form parsing
6. Create `telnetMock.ts` deterministic mock (action menu + CommoServe)
7. Unit tests for parser, mock, and session

### Phase 2: Navigator and Executor (Action Menu)

1. Create `telnetMenuNavigator.ts` label-based navigation state machine
2. Create `telnetActionExecutor.ts` high-level action API
3. Add `withTelnetInteraction()` to `deviceInteractionManager.ts`
4. Add `telnetScheduler` to device interaction infrastructure
5. Add Telnet tracing to `traceSession.ts`
6. Unit tests for navigator, executor, and scheduling

### Phase 3: UI Integration (Action Menu)

1. Add Power Cycle and Reboot (Clear Memory) to `MachineControls`
2. Add `useTelnetActions()` hook
3. Add Telnet availability detection (`isTelnetAvailable()`)
4. Add Save C64/REU Memory to memory section
5. Add Printer and IEC controls
6. Add Telnet status indicator
7. Update Home page layout

### Phase 4: CommoServe Navigator and Executor

1. Create `commoserveNavigator.ts` form-based navigation (text input, dropdown selection, submit)
2. Create `commoserveExecutor.ts` high-level search/browse/action API
3. Extend `telnetMock.ts` with CommoServe form, results, and file entry simulation
4. Unit tests for CommoServe navigator, executor, and mock

### Phase 5: CommoServe UI

1. Create `useCommoServe()` hook
2. Create CommoServe search page with native form controls
3. Create results list and file entry views
4. Add CommoServe entry point to Home page or navigation
5. Add platform and network availability gating
6. Loading states and error handling for network-dependent operations

### Phase 6: Polish and Hardening

1. iOS native plugin skeleton
2. End-to-end Playwright tests using Telnet mock (action menu + CommoServe)
3. Real-device integration testing (action menu + CommoServe)
4. Menu discovery and diagnostics integration
5. Documentation updates

---

## 16. Acceptance Criteria

### Transport

- [ ] Android native TCP socket plugin connects to device on port 23
- [ ] Authentication succeeds with correct password, fails with incorrect
- [ ] Reconnection works after connection drop

### Parser

- [ ] Parser correctly renders 60×24 screen from VT100 stream
- [ ] Parser detects bordered menu overlays
- [ ] Parser identifies selected item via reverse video
- [ ] Parser extracts menu item labels correctly
- [ ] Parser classifies screen types (file browser, action menu, search form, results, entries)
- [ ] Parser detects CommoServe form fields with labels, values, and empty state
- [ ] Parser detects CommoServe dropdown popups

### Navigator

- [ ] Navigator opens action menu with F5
- [ ] Navigator finds categories by label regardless of position
- [ ] Navigator enters submenus and finds actions by label
- [ ] Navigator fails gracefully when target not found (descriptive error)
- [ ] Navigator recovers from desynchronized state

### Mock

- [ ] Mock renders screens matching real firmware VT100 output format
- [ ] Mock maintains correct menu/cursor state across key inputs
- [ ] Mock supports fixture-based menu customization
- [ ] Mock supports failure injection (disconnect, timeout, missing items)
- [ ] Mock simulates CommoServe search form with field navigation and text input
- [ ] Mock simulates CommoServe dropdown popups with preset options
- [ ] Mock returns configurable search results and file entries
- [ ] Mock simulates CommoServe network errors (no link, connection failed)

### Actions

- [ ] Power Cycle executes successfully via Telnet
- [ ] Reboot (Clear Memory) executes successfully via Telnet
- [ ] All Telnet-only actions listed in section 10.1 execute correctly
- [ ] Actions record trace events for diagnostics

### Scheduling

- [ ] Telnet actions use independent scheduler (concurrency 1)
- [ ] Concurrent REST+Telnet does not corrupt device state
- [ ] Circuit breaker applies to Telnet errors
- [ ] Device state gating blocks Telnet during UNKNOWN/ERROR states

### CommoServe

- [ ] F6 opens CommoServe search form via Telnet
- [ ] Free-text fields accept typed input and confirm with ENTER
- [ ] Dropdown fields open popup and select by label
- [ ] Submit triggers search and returns results or empty set
- [ ] Result selection shows file entries with type and size
- [ ] File actions (Run Disk, Mount Disk, etc.) execute correctly
- [ ] Network error popups are detected and reported
- [ ] Timeout handling works for slow server responses

### UI

- [ ] Power Cycle appears in Quick Actions on Home page (Android/iOS)
- [ ] Telnet-only actions are hidden/disabled on web platform
- [ ] Loading/disabled states show correctly during Telnet action execution
- [ ] Error toasts appear on Telnet action failure
- [ ] CommoServe search page presents native form controls
- [ ] CommoServe results display as scrollable list with metadata
- [ ] CommoServe entry point is hidden on web platform
- [ ] CommoServe shows clear message when device has no internet

### Coverage

- [ ] Branch coverage >= 91% globally after all Telnet code is added
- [ ] All parser edge cases covered (empty screen, partial redraw, unknown escapes)
- [ ] Navigator edge cases covered (missing items, reordered items, truncated labels)

---

## 17. Open Questions

1. **Action menu key mapping**: On Ultimate 64 devices, F5 opens the action menu (firmware keymapper: F5 → KEY_TASKS). On C64 Ultimate devices, F1 opens the action menu directly. The client must detect the device type from the title line and use the correct key. **Resolution**: `c64u-telnet-spec.md` has been updated to document both mappings.

2. **Listen backlog limit**: The firmware Telnet server has a listen backlog of 2. If a Telnet session is already active (e.g., from a real terminal client) and C64 Commander connects, the firmware accepts the connection and creates a second independent UserInterface instance. Both sessions are fully independent. However, if the listen backlog is exhausted, connection will fail. **Mitigation**: C64 Commander maintains only one Telnet session per device and reconnects as needed.

3. **Authentication timing**: The firmware implements exponential delay on failed login attempts (250ms → 4s over 5 attempts). C64 Commander should pass the correct password on the first attempt. If the password is wrong, the user should be prompted to correct it rather than retrying automatically.

4. **CommoServe branding**: The C64 Ultimate shows "CommoServe File Search" while the Ultimate 64 shows "Assembly 64 Query Form". The parser must recognize both title strings to detect the search form screen. The UI uses either "CommoServe" (if using a C64U) or "Assembly 64" (all other devices).

5. **CommoServe preset stability**: Dropdown presets (Category, Date, Type, Sort, Order) are fetched from the archive service at runtime. If the service changes presets, the UI must adapt. The native search UI should populate dropdown options from the fetched presets rather than hardcoding values.

6. **CommoServe session exclusivity**: While a CommoServe search session is active on the Telnet connection, action menu operations cannot be performed simultaneously (the firmware routes keys to the `AssemblySearch` TreeBrowser, not the main browser). The Telnet scheduler must prevent action menu operations while a CommoServe session is open, or close CommoServe first.

7. **File download latency**: When a user selects "Run Disk" on a CommoServe result, the firmware downloads the file from the archive service to `/Temp/` before executing. This introduces variable latency (seconds to tens of seconds depending on file size and network). The UI must show appropriate loading state and the timeout must account for this.

---

## 18. UX Integration Design

This chapter specifies how Telnet-only features integrate into C64 Commander's existing user experience. The design follows the project's established UX principles — progressive disclosure, source transparency, intent-driven language, and small-screen-first layout — so that users experience a single cohesive app regardless of whether a feature uses REST, FTP, or Telnet.

### 18.1 Design Principles

#### 18.1.1 Transport Transparency

Users never see "Telnet", "REST", or "FTP" in the UI. The transport layer is an implementation detail. A user tapping "Power Cycle" on the Home page does not know or care that it uses Telnet while "Reset" uses REST. Both feel identical: tap → loading spinner → done/error toast.

This follows the existing pattern where FTP-based file browsing and REST-based config reads appear as a single unified experience. The `docs/ux-guidelines.md` principle of source transparency ("consistent handling, no source-kind text labels") extends directly to Telnet actions.

#### 18.1.2 Progressive Disclosure

Telnet-only features are introduced at the appropriate level of detail for each surface:

- **Quick Actions grid**: Power Cycle and Reboot (Clear RAM) already appear alongside REST-based Reset and Reboot — no additional disclosure needed.
- **Drive, Printer, and IEC cards**: Telnet-only controls (Flush, Reset, Turn On) appear inline within existing cards, revealed only when the card is expanded or the device is in a relevant state.
- **CommoServe**: Appears as a content source alongside Local, C64U, and HVSC — not as a separate "Telnet feature" but as another way to find and run C64 software.

#### 18.1.3 Intent-Driven Language

Following `docs/ux-guidelines.md`, all labels describe what the user wants to accomplish, not how it is achieved:

| Telnet action label    | Intent-driven label used in UI |
| ---------------------- | ------------------------------ |
| Power Cycle            | Power Cycle                    |
| Reboot (Clr Mem)       | Reboot (Clear RAM)             |
| Save C64 Memory        | Save RAM (already exists)      |
| Save REU Memory        | Save REU                       |
| Software IEC → Turn On | Turn On / Turn Off             |
| Software IEC → Reset   | Reset                          |
| Printer → Flush/Eject  | Flush                          |
| Printer → Reset        | Reset                          |
| Printer → Turn On      | Turn On / Turn Off             |
| CommoServe search      | CommoServe                     |

#### 18.1.4 Small Screen First

All Telnet features must work on compact-profile devices (narrowest supported width). The existing `ProfileActionGrid` component handles the profile-aware quick-action density, and the Home quick-actions grid currently renders four columns across compact, medium, and expanded profiles. New action buttons use `QuickActionCard` with the same density-adaptive sizing. Cards and inline controls use the existing `useDisplayProfile()` hook to adjust layout.

### 18.2 Home Page — Quick Actions Grid

The existing Quick Actions grid (`MachineControls.tsx`) uses a `ProfileActionGrid` with `QuickActionCard` components. It currently has 8 buttons: Reset, Reboot, Pause/Resume, Menu, Save RAM, Load RAM, Power Cycle, Power Off.

#### 18.2.1 Additions

Add **Power Cycle** to the grid. This is the only new Quick Action button needed — it is a common power management operation that belongs alongside Reset, Reboot, and Power Off.

| Button      | Icon                | Variant  | Grid Position              |
| ----------- | ------------------- | -------- | -------------------------- |
| Power Cycle | `RefreshCw` + `Zap` | `danger` | After Reboot, before Pause |

The grid grows from 8 to 9 items. On compact screens (2 columns) this adds one half-row. On medium/expanded (4 columns) it flows into a third row.

#### 18.2.2 Existing Buttons Backed by Telnet

Two existing Quick Action buttons currently trigger placeholder operations or incomplete flows. With Telnet, they gain real implementations:

| Button             | Current transport | With Telnet                                    |
| ------------------ | ----------------- | ---------------------------------------------- |
| Reboot (Clear RAM) | Placeholder/REST  | Telnet → Power & Reset → Reboot (Clr Mem)      |
| Save RAM           | REST (partial)    | Existing dialog stays; "Save REU" option added |

No visual change is needed for these buttons. The transport switch is invisible to the user.

#### 18.2.3 Power Cycle Button Behavior

- **Tap**: Executes immediately (no confirmation dialog) — matches Reset and Reboot behavior.
- **Loading**: Icon pulses while Telnet action is in progress.
- **Disabled**: When disconnected, when another machine task is busy, or on web platform.
- **Error**: Toast notification on failure, matching existing error pattern.
- **Platform gating**: On web, this button is hidden entirely (not disabled) because Telnet is unavailable and there is no REST fallback for Power Cycle.

#### 18.2.4 Platform Visibility Rules

On web platform where Telnet is unavailable, buttons that have no REST fallback are hidden rather than disabled. This prevents clutter and avoids user confusion. The grid adjusts layout automatically.

| Button             | REST available | Web behavior |
| ------------------ | -------------- | ------------ |
| Reset              | Yes            | Visible      |
| Reboot             | Yes            | Visible      |
| Pause / Resume     | Yes            | Visible      |
| Menu               | Yes            | Visible      |
| Save RAM           | Yes (partial)  | Visible      |
| Load RAM           | Yes            | Visible      |
| Reboot (Clear RAM) | No             | Hidden       |
| Power Cycle        | No             | Hidden       |
| Power Off          | Yes            | Visible      |

### 18.3 Home Page — Save RAM Dialog

The existing Save RAM dialog (`SaveRamDialog.tsx`) presents snapshot type options: Program Snapshot, Basic Snapshot, Screen Snapshot, Custom Snapshot. Each is a card button in a vertical list.

#### 18.3.1 Save REU Addition

Add a **Save REU** option to the Save RAM dialog as an additional card at the bottom of the list:

```text
Save RAM
Choose the memory region to snapshot.

  [ Program Snapshot          ]
  [ Basic Snapshot            ]   ← existing
  [ Screen Snapshot           ]
  [ Custom Snapshot           ]
  [ Save REU                  ]   ← new, Telnet-only

  [ Cancel ]
```

- **Label**: "Save REU"
- **Subtitle**: "REU expansion memory"
- **Behavior**: Tap triggers Telnet action `Power & Reset → Save REU Memory`
- **Platform gating**: The Save REU card is hidden on web platform. The dialog otherwise renders identically.
- **Loading state**: The card shows a spinner while the Telnet action runs. Other cards are disabled during this time (existing mutual-exclusion pattern).

This approach is preferred over a separate button because saving REU memory is conceptually the same operation class as saving C64 RAM — selecting a memory region to snapshot. Grouping them in one dialog follows progressive disclosure.

### 18.4 Home Page — Drives Section

The existing Drives section (`DriveManager.tsx`) shows cards for Drive A, Drive B, and Soft IEC Drive. Each card has an ON/OFF toggle, mount/eject controls, bus ID and type selectors, and status display.

#### 18.4.1 Soft IEC Drive — Telnet Controls

The Soft IEC Drive card currently shows ON/OFF toggle, path, bus ID, and status. Add Telnet-only controls inline:

```text
┌─────────────────────────────────────────┐
│ SOFT IEC DRIVE                    [OFF] │
│                                         │
│ Path  /USB0/                            │
│ Bus ID  11                              │
│ Status  OK                              │
│                                         │
│         [ Reset ]  [ Set Dir ]          │  ← new Telnet actions
└─────────────────────────────────────────┘
```

| Control | Telnet Path                  | Appearance                                     |
| ------- | ---------------------------- | ---------------------------------------------- |
| Reset   | Software IEC → Reset         | Outline button, matches existing Reset buttons |
| Set Dir | Software IEC → Set dir. here | Outline button                                 |

- **Visibility**: These buttons appear only when the Soft IEC Drive is ON and Telnet is available. When OFF or on web platform, they are hidden.
- **Layout**: A row of small outline buttons below the status line, using the same spacing as the existing printer control rows. On compact profile, buttons stack vertically.
- **Loading state**: Individual button shows spinner; other buttons disabled.

The existing ON/OFF toggle for Soft IEC uses REST config writes. The Turn On action via Telnet (`Software IEC → Turn On`) is used only as a fallback when the REST config path is unavailable or when the firmware requires the Telnet command path for initial activation. This is transparent to the user — the ON/OFF toggle always works.

### 18.5 Home Page — Printers Section

The existing Printer section (`PrinterManager.tsx`) shows a card with ON/OFF toggle, bus ID, and configuration dropdowns (Output type, Ink density, Emulation, etc.).

#### 18.5.1 Printer Telnet Controls

Add Telnet-only controls as a button row at the bottom of the Printer card:

```text
┌─────────────────────────────────────────┐
│ PRINTER                           [OFF] │
│                                         │
│ Bus ID  4    Type  PNG B/W              │
│ Ink  Medium  Emulation  MPS             │
│ CBM charset  US/UK  Epson  Basic        │
│ IBM  Intl 1                             │
│                                         │
│   [ Flush ]   [ Reset ]                 │  ← new Telnet actions
└─────────────────────────────────────────┘
```

| Control | Telnet Path           | Appearance     |
| ------- | --------------------- | -------------- |
| Flush   | Printer → Flush/Eject | Outline button |
| Reset   | Printer → Reset       | Outline button |

- **Visibility**: Buttons appear only when the Printer is ON and Telnet is available. When OFF or on web, hidden.
- **Turn On/Off**: The existing ON/OFF toggle already covers enable/disable via REST config writes. The Telnet `Printer → Turn On` path serves as fallback.
- **Layout**: Same pattern as Section 18.4.1 — a row of small outline buttons at the card bottom.
- **Section Reset button**: The existing "Reset" button in the Printers section header (`SectionHeader` with `resetAction`) continues to use the REST reset endpoint. The new per-printer "Reset" button inside the card uses the Telnet path. Labels match intentionally — both reset the printer — but they are visually distinguished by position (section-level vs card-level).

### 18.6 Home Page — Config Section

The existing Config section at the bottom of the Home page uses a `ProfileActionGrid` with `QuickActionCard` buttons: Save (to flash), Load (from flash), Reset (to default), Save (to App), Load (from App), Revert Changes, Manage App Configs.

#### 18.6.1 Config Telnet Additions

Add two Telnet-only config actions to the grid:

| Button       | Icon       | Telnet Path                        | Position                         |
| ------------ | ---------- | ---------------------------------- | -------------------------------- |
| Save to File | `FileDown` | Configuration → Save to File       | After existing Save/Load buttons |
| Clear Flash  | `Trash2`   | Configuration → Clear Flash Config | After Save to File               |

- **Save to File**: Saves the current device configuration to a file on the device's USB storage. This is a convenience action for backup purposes.
- **Clear Flash**: Clears all saved configuration from flash, resetting to factory defaults. This is a destructive action.

#### 18.6.2 Clear Flash Confirmation

Because Clear Flash is destructive and irreversible, it requires a confirmation dialog before execution:

```text
Clear Flash Configuration?
This will reset all saved settings to factory defaults.
This cannot be undone.

  [ Cancel ]   [ Clear Flash ]
```

This follows the existing pattern of `PowerOffDialog` — a simple confirmation modal with a destructive-styled confirm button.

#### 18.6.3 Platform Gating

Both buttons are hidden on web platform. The Config section grid adjusts layout automatically.

### 18.7 CommoServe

CommoServe is the most significant UX addition. Rather than exposing it as a Telnet feature, it is presented as a **content source** — a way to find and run C64 software from an online database, conceptually parallel to the existing Local, C64U, and HVSC sources.

#### 18.7.1 Entry Point: Home Page Quick Actions

Add a **CommoServe** button to the Quick Actions grid:

| Button     | Icon    | Variant   | Grid Position         |
| ---------- | ------- | --------- | --------------------- |
| CommoServe | `Globe` | `default` | Last position in grid |

This brings the grid to 10 items (or 9 on web, since Power Cycle is hidden). On compact screens (2 columns) this is 5 rows; on medium/expanded (4 columns) this is 3 rows with 2 remaining slots.

Tapping "CommoServe" opens the CommoServe search sheet (section 18.7.3).

#### 18.7.2 Entry Point: Play Page Source Picker

The existing "Add items" dialog (`ItemSelectionDialog`) shows source options: Local, C64U, HVSC. Add a fourth source:

```text
Add items
Select items from the chosen source to add.

Choose source

  [ Local                     ]
  [ C64U                      ]
  [ HVSC                      ]
  [ CommoServe                ]   ← new

  [ Cancel ]
```

- **Label**: "CommoServe"
- **Subtitle**: "Search online content database"
- **Icon**: `Globe` (using `FileOriginIcon` pattern)
- **Platform gating**: Hidden on web platform. Hidden when Telnet is not connected.
- **Behavior**: Selecting this source opens the CommoServe search flow within the ItemSelectionDialog, replacing the file browser with the search form.

This is the most natural placement because CommoServe is functionally a content source — users search for SID files, disk images, and cartridges, then add them to their playlist or run them. The source picker already abstracts away whether files come from local storage, the device's USB, or the HVSC database.

#### 18.7.3 CommoServe Search Sheet

The search UI is a bottom sheet (on compact/medium) or dialog (on expanded), following the existing `AppSheet` / `AppDialog` pattern used by `ItemSelectionDialog`. It presents a native search form that maps to the CommoServe Telnet form fields.

**Layout — Compact Profile:**

```text
┌─────────────────────────────────────┐
│ CommoServe                    ✕  │
│ Search the online content database. │
│                                     │
│ Name     [________________________] │
│ Group    [________________________] │
│ Category [  Any              ▼    ] │
│ Type     [  Any              ▼    ] │
│ Year     [  Any              ▼    ] │
│                                     │
│ Sort by  [ Name ▼]  [ Asc ▼]       │
│                                     │
│         [ Search ]                  │
└─────────────────────────────────────┘
```

**Field layout decisions:**

- **Name** is always visible and auto-focused — it is the most common search parameter.
- **Group** is visible below Name — the second most common search parameter for demoscene content.
- **Handle** and **Event** are hidden behind an "Advanced" disclosure toggle. These are specialist fields used rarely. This follows progressive disclosure.
- **Category**, **Type**, and **Year** use native `Select` dropdowns. Each has an "Any" default option that means "do not filter". Dropdown options are populated from server presets fetched via Telnet at search form open time.
- **Sort** and **Order** are combined on a single row as a `Select` + `Select` pair.
- The **Search** button is a primary-styled `Button` at the bottom.

**Advanced fields (disclosed on tap):**

```text
│ ▼ Advanced                          │
│ Handle   [________________________] │
│ Event    [________________________] │
```

#### 18.7.4 CommoServe Results View

After search submission, results replace the form (with a back arrow to return to the form):

```text
┌─────────────────────────────────────┐
│ ← Results for "joyride"         ✕   │
│ 12 results                          │
│                                     │
│ Q Filter results...                 │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ Joyride                         │ │
│ │ TRIAD · 2018                    │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ Joyride (Competition)           │ │
│ │ CENSOR · 1993                   │ │
│ └─────────────────────────────────┘ │
│ ...                                 │
└─────────────────────────────────────┘
```

- Results use the `SelectableActionList` pattern — tappable cards in a scrollable list.
- Each card shows the release name as primary text and group + year as secondary text.
- A filter input at the top filters results client-side by name (same pattern as disk library filter).
- Tapping a result navigates into file entries.

#### 18.7.5 CommoServe File Entries View

File entries for a selected result:

```text
┌─────────────────────────────────────┐
│ ← Joyride                       ✕  │
│ TRIAD · 2018                        │
│                                     │
│ ┌─────────────────────────────────┐ │
│ │ 💾 joyride.d64            171K  │ │
│ │    Disk Image                   │ │
│ └─────────────────────────────────┘ │
│ ┌─────────────────────────────────┐ │
│ │ 📄 joyride_readme.txt      2K  │ │
│ │    Text File                    │ │
│ └─────────────────────────────────┘ │
│ ...                                 │
└─────────────────────────────────────┘
```

- Each file entry shows filename, file type icon (based on extension), and size.
- File type description (e.g., "Disk Image" for .d64) appears as secondary text.
- Tapping a file entry opens a context action sheet.

#### 18.7.6 CommoServe File Action Sheet

When a file entry is tapped, a bottom action sheet presents available actions:

```text
┌─────────────────────────────────────┐
│ joyride.d64                         │
│ Disk Image · 171K                   │
│                                     │
│ [ ▶ Run Disk                      ] │
│ [ 💿 Mount Disk                   ] │
│ [ 💿 Mount Disk (Read Only)       ] │
│ [ 👁 View                         ] │
│                                     │
│ [ Cancel                          ] │
└─────────────────────────────────────┘
```

- Available actions come from the firmware — they depend on the file extension (see `c64u-telnet.yaml` filesystem context menus for the full mapping).
- Action labels use intent-driven language matching the firmware labels.
- Tapping an action triggers the Telnet executor, shows a loading spinner on the tapped action, and disables other actions during execution.
- The file download latency (firmware downloads from the archive service to `/Temp/`) is communicated via a "Downloading..." intermediate state before the action executes.

#### 18.7.7 CommoServe Loading States

CommoServe involves network-dependent operations with variable latency. Loading states must be prominent and informative:

| Phase            | UI State                                               | Duration     |
| ---------------- | ------------------------------------------------------ | ------------ |
| Opening search   | Sheet opens immediately; fields disabled with skeleton | 1–5 seconds  |
| Preset loading   | Dropdown fields show "Loading..." placeholder          | 1–3 seconds  |
| Searching        | Search button shows spinner; "Searching..." text       | 2–15 seconds |
| Loading entries  | Result card shows inline spinner                       | 1–10 seconds |
| Downloading file | Action button shows spinner; "Downloading..." text     | 2–30 seconds |
| Executing action | Action button shows spinner; "Running..." text         | 1–3 seconds  |

The extended timeouts require more prominent loading indicators than typical REST operations. A determinate or indeterminate progress bar below the sheet header communicates that a network operation is in progress.

#### 18.7.8 CommoServe Error States

Errors are shown as inline banners within the sheet, not as toasts, because the user needs to take action within the search context:

| Error                  | Display                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| Device has no internet | Banner: "Your C64 device needs an internet connection to search online content." |
| Server unreachable     | Banner: "Online content server is not responding. Try again later."              |
| Search timeout         | Banner: "Search took too long. Try a more specific query."                       |
| No results             | Empty state: "No results found. Try different search terms."                     |
| Connection lost        | Banner: "Connection to device lost." with Retry button.                          |

#### 18.7.9 CommoServe on Play Page

When CommoServe is accessed from the Play page source picker (section 18.7.2), the flow operates within the `ItemSelectionDialog`:

1. User taps "CommoServe" in source picker
2. Source picker transitions to the CommoServe search form (replacing the file browser)
3. User searches, selects a result, sees file entries
4. For SID files: user can select entries and tap "Add to playlist" (matching the existing add-items flow)
5. For disk/cartridge files: user can tap to run/mount directly (these are not playlist items)

The key distinction: SID files from CommoServe can enter the playlist workflow (search → select → add to playlist → play). Disk images and cartridges are run/mounted directly because they are not playlist-compatible content.

### 18.8 Developer Actions

Developer Telnet actions (Clear Debug Log, Save Debug Log, Save EDID to File) are not placed on the Home page. They belong behind Settings → Diagnostics, which is the existing location for developer-facing tools.

#### 18.8.1 Diagnostics Panel Additions

Add Telnet developer actions as a new section within the diagnostics overlay:

| Action          | Telnet Path                   | Control             |
| --------------- | ----------------------------- | ------------------- |
| Clear Debug Log | Developer → Clear Debug Log   | Button with confirm |
| Save Debug Log  | Developer → Save Debug Log    | Button              |
| Save EDID       | Developer → Save EDID to file | Button              |

These are hidden on web platform. They follow the existing diagnostics panel layout — a list of labeled buttons with descriptive text.

### 18.9 Connection and Status Indicators

#### 18.9.1 Telnet Connection State

The existing `ConnectivityIndicator` in the `AppBar` shows device connection status. Telnet connection state is tracked separately but is **not** surfaced as a distinct indicator. Rationale:

- Telnet connects lazily on first Telnet action — showing "Telnet disconnected" before any Telnet action would confuse users.
- When a Telnet action fails due to connection issues, the error toast provides sufficient feedback.
- Adding a second connection indicator adds visual clutter without actionable information.

#### 18.9.2 Telnet in Diagnostics

The diagnostics panel (`DiagnosticsActivityIndicator`) is extended to show Telnet session state when active:

- **Session idle**: "Telnet: connected (idle)" — shown only when a session exists
- **Session active**: "Telnet: action in progress" — shown during Telnet action execution
- **Session disconnected**: Not shown (lazy connection means no persistent state to display)

This gives power users visibility into Telnet without cluttering the main UI.

### 18.10 Interaction Timing and Feedback

Telnet actions have different timing characteristics than REST. The UI must account for this:

#### 18.10.1 Action Duration Expectations

| Action Class         | Typical Duration | UI Feedback                                    |
| -------------------- | ---------------- | ---------------------------------------------- |
| Simple device action | 1–3 seconds      | Button spinner (same as REST)                  |
| CommoServe form open | 2–5 seconds      | Sheet skeleton / shimmer                       |
| CommoServe search    | 3–15 seconds     | Progress bar + "Searching..." text             |
| CommoServe file run  | 3–30 seconds     | Progress bar + "Downloading..." / "Running..." |

#### 18.10.2 Mutual Exclusion

While a Telnet action is in progress, all other Telnet-backed buttons are disabled. This is the same pattern as the existing `machineTaskBusy` gate in `MachineControls`. REST-backed buttons remain enabled — the schedulers are independent.

The `machineTaskBusy` state is extended to cover Telnet actions:

```typescript
const isAnyTelnetActionActive = useTelnetActionState();
const effectiveBusy = machineTaskBusy || isAnyTelnetActionActive;
```

Telnet-only buttons use `effectiveBusy` for their disabled state. REST-only buttons continue using `machineTaskBusy` alone.

### 18.11 Responsive Layout Summary

The following table summarizes how each Telnet feature adapts across display profiles:

| Feature                 | Compact (2 col)         | Medium (4 col)       | Expanded (4 col)   |
| ----------------------- | ----------------------- | -------------------- | ------------------ |
| Quick Actions grid      | 2 rows × 4              | 2 rows × 4           | 2 rows × 4         |
| Power Cycle button      | Full-width in grid cell | Standard grid cell   | Standard grid cell |
| Save REU in dialog      | Full-width card         | Full-width card      | Full-width card    |
| IEC inline buttons      | Stacked vertically      | Row of buttons       | Row of buttons     |
| Printer inline buttons  | Stacked vertically      | Row of buttons       | Row of buttons     |
| Config actions grid     | 2 col grid              | 4 col grid           | 4 col grid         |
| CommoServe sheet        | Full-screen sheet       | Centered sheet (80%) | Centered dialog    |
| CommoServe results      | Full-width list         | Full-width list      | Full-width list    |
| CommoServe file actions | Bottom action sheet     | Bottom action sheet  | Dialog             |

### 18.12 Accessibility

- All Telnet-backed buttons have `aria-label` attributes describing the action.
- Loading states set `aria-busy="true"` on the active element.
- Disabled states set `aria-disabled="true"` and `tabindex="-1"`.
- CommoServe search form fields have proper `label` associations.
- Error banners use `role="alert"` for screen reader announcement.
- Action sheets use `role="dialog"` with `aria-modal="true"`.

### 18.13 UX Acceptance Criteria

- [ ] Power Cycle button appears in Quick Actions grid on native platforms
- [ ] Power Cycle button is hidden on web platform
- [ ] Save REU appears in Save RAM dialog on native platforms
- [ ] Soft IEC Drive card shows Reset and Set Dir buttons when drive is ON and Telnet available
- [ ] Printer card shows Flush and Reset buttons when printer is ON and Telnet available
- [ ] Config section shows Save to File and Clear Flash buttons on native platforms
- [ ] Clear Flash shows confirmation dialog before executing
- [ ] CommoServe button appears in Quick Actions on native platforms
- [ ] CommoServe source appears in Play page Add Items source picker on native platforms
- [ ] CommoServe search sheet opens with native form controls
- [ ] CommoServe dropdown fields populate from server presets
- [ ] CommoServe results display in scrollable card list
- [ ] CommoServe file entries show filename, type, and size
- [ ] CommoServe file action sheet presents available actions for file type
- [ ] Loading states are prominent and descriptive for all network-dependent operations
- [ ] Error states display as inline banners with actionable messages
- [ ] All Telnet features are hidden on web platform
- [ ] All Telnet-backed buttons disable during active Telnet action
- [ ] REST-backed buttons remain functional during Telnet actions
- [ ] Layout adapts correctly across compact, medium, and expanded profiles
- [ ] No UI element exposes transport terminology (Telnet, REST, FTP) to the user
