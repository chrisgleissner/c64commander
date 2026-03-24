# C64 Ultimate Telnet Control Specification

## 1. Scope

This specification defines:

- Deterministic interaction with the C64 Ultimate (C64U) via Telnet
- Menu structure and navigation model
- Strategy to reach actions without positional assumptions
- Mapping between Telnet actions and REST API capabilities
- Requirements for client and mock implementations

This document is **normative** for Telnet-based control in C64 Commander.

---

## 2. Telnet Session Basics

### 2.1 Connection

- Protocol: Telnet (TCP)
- Default port: 23
- Host: configurable (e.g., `c64u`)

### 2.2 Initial State

After connection, the device presents:

- File browser view
- No action menu open

### 2.3 Enter Action Menu

| Action                    | Key             | Notes                                       |
| ------------------------- | --------------- | ------------------------------------------- |
| Open action menu          | `F1` or `F5`   | C64U uses F1; Ultimate 64 uses F5           |
| Open CommoServe / A64     | `F6`            | Online content search (requires internet)   |
| Exit Telnet               | `CTRL + ] quit` |                                             |

NOTE: On C64 Ultimate devices, F1 opens the action menu directly. On Ultimate 64 devices, the keymapper remaps F5 → KEY_TASKS (action menu) and F1 → KEY_PAGEUP. Clients must detect the device type and use the correct key.

---

## 3. Input Model

### 3.1 Supported Keys

| Key     | Meaning                                  |
| ------- | ---------------------------------------- |
| UP/DOWN | Navigate vertical menu                   |
| LEFT    | Leave submenu                            |
| RIGHT   | Enter submenu                            |
| ENTER   | Execute action / edit field              |
| F1      | Open action menu (C64U) or Page Up (U64) |
| F5      | Open action menu (U64)                   |
| F6      | Open CommoServe / Assembly64 search      |
| F7      | Help (U64) or Page Down                  |

---

## 4. Screen Model

### 4.1 Characteristics

- Full-screen ASCII UI
- Fixed layout
- Menu overlays on right side
- No explicit machine-readable structure

### 4.2 Parsing Requirements

Client MUST:

- Treat screen as full frame (not incremental)
- Detect active menu and submenu
- Identify selected item via highlight

Client MUST NOT:

- Rely on timing
- Rely on fixed coordinates
- Assume menu order stability

---

## 5. Menu Structure

### 5.1 Hierarchy

| Level 1             | Level 2               | Level 3 |
| ------------------- | --------------------- | ------- |
| Power & Reset       | Reset C64             |         |
|                     | Reboot C64            |         |
|                     | Reboot (Clear Memory) |         |
|                     | Power OFF             |         |
|                     | Power Cycle           |         |
|                     | Save C64 Memory       |         |
|                     | Save REU Memory       |         |
| Built-in Drive A    | Turn Off              |         |
|                     | Reset                 |         |
|                     | Switch to 1571        |         |
|                     | Switch to 1581        |         |
|                     | Insert Blank          |         |
| Built-in Drive B    | Turn On               |         |
|                     | Switch to 1541        |         |
|                     | Switch to 1571        |         |
|                     | Switch to 1581        |         |
| Software IEC        | Turn On               |         |
|                     | Reset                 |         |
|                     | Set directory here    |         |
| Printer             | Flush/Eject           |         |
|                     | Reset                 |         |
|                     | Turn On               |         |
| Configuration       | Save to Flash         |         |
|                     | Save to File          |         |
|                     | Reset from Flash      |         |
|                     | Reset to Defaults     |         |
|                     | Clear Flash Config    |         |
| Streams             | VIC Stream            |         |
|                     | Audio Stream          |         |
| Developer           | Clear Debug Log       |         |
|                     | Save Debug Log        |         |
|                     | Save EDID to File     |         |
|                     | Debug Stream          |         |
| Return to Main Menu |                       |         |

---

## 5b. CommoServe / Assembly64 Search

### 5b.1 Overview

CommoServe (C64 Ultimate branding) / Assembly64 (Ultimate 64 branding) is an online content search and download feature. It opens a modal search form over the file browser, queries a remote server, and allows browsing/running results directly from Telnet.

- **Trigger**: `F6` from the file browser
- **Requires**: Active network connection to the internet
- **Backend**: Assembly64 server (`hackerswithstyle.se/leet`)
- **UI model**: Distinct from the action menu — a separate multi-screen modal flow

### 5b.2 Screen Flow

```
File Browser
  │
  F6
  ▼
Search Form (modal overlay, 40 columns)
  │
  Submit
  ▼
Results List (titles matching query)
  │
  ENTER / RIGHT
  ▼
File Entries (files within selected result)
  │
  ENTER (context menu)
  ▼
File Actions (Run Disk, Mount Disk, etc.)
```

### 5b.3 Search Form Fields

| Field    | Input Type | Values                                          |
| -------- | ---------- | ----------------------------------------------- |
| Name     | Free text  | Any string                                      |
| Group    | Free text  | Any string                                      |
| Handle   | Free text  | Any string                                      |
| Event    | Free text  | Any string                                      |
| Category | Dropdown   | Apps, Demos, Games, Graphics, Music             |
| Date     | Dropdown   | Years (1980–1996+)                              |
| Type     | Dropdown   | crt, d64, d71, d81, sid, t64, tap               |
| Sort     | Dropdown   | Name, Year                                      |
| Order    | Dropdown   | Ascending, Descending                           |

NOTE: Dropdown presets are fetched from the Assembly64 server at connection time and may change. The values above are observed from firmware V1.49 1.1.0.

### 5b.4 Search Form Interaction

| Action                  | Key                     |
| ----------------------- | ----------------------- |
| Move between fields     | UP / DOWN               |
| Edit free-text field    | Type + ENTER            |
| Open dropdown selector  | ENTER or RIGHT          |
| Select dropdown item    | UP/DOWN + ENTER         |
| Cycle dropdown with +/- | `+` / `-`               |
| Clear current field     | HOME / DEL              |
| Clear all fields        | CLEAR                   |
| Submit query            | ENTER on `<< Submit >>` |
| Close search            | LEFT or ESC or RUN/STOP |

### 5b.5 Results List

After submitting, results appear as a list of titles:

```
JollyDisk
GUI64
UltimateTerm
Joyride
CCGMS Ultimate
Anykey
```

- Each result shows the release name (and optionally group + year)
- `< No Items >` is shown when the query returns no results
- ENTER or RIGHT on a result shows its file entries

### 5b.6 File Entries

Selecting a result shows its downloadable files:

```
joyride.d64                 D64  171K
joyride_license.txt         TXT    1K
```

- Each entry shows filename, extension, and size
- Status bar shows the Assembly64 path: `/a64/{id}/{category}/`
- Files are downloaded on demand (cached to `/Temp/` on device)

### 5b.7 File Actions

ENTER on a file entry opens the standard file context menu:

| Action                  |
| ----------------------- |
| Run Disk                |
| Mount Disk              |
| Mount Disk Read Only    |
| Mount Disk Unlinked     |
| Mount Disk on B         |
| Mount Disk R/O on B     |
| Mount Disk Unl. on B    |
| View                    |

NOTE: Available actions depend on the file type. The actions above are for `.d64` files. Other file types (`.sid`, `.crt`, `.t64`, etc.) have their own context menus determined by the firmware's FileType system.

---

## 6. Deterministic Navigation Strategy

### 6.1 Problem

Menu item positions are NOT stable across firmware versions.

### 6.2 Solution: Label-Based Navigation

Client MUST implement:

1. Open action menu (`F1` on C64U, `F5` on U64)
2. Scan visible menu items
3. Match target label (string comparison)
4. Move cursor until match is selected
5. Enter submenu if required
6. Repeat recursively

### 6.3 Algorithm

```
navigate(path):
  open_menu_if_needed()

  for segment in path:
    while current_selection != segment:
      press_down()

    if segment has submenu:
      press_right()
```

### 6.4 Requirements

- Matching must be exact or normalized (trim, case-insensitive)
- Must handle partial redraws
- Must verify selection after each input

### 6.5 Failure Handling

- If item not found → abort with error
- If screen inconsistent → retry full scan

---

## 7. Telnet Action Table

| Action                | Path                              | Keys                               |
| --------------------- | --------------------------------- | ---------------------------------- |
| Reset C64             | Power & Reset → Reset C64         | F1 → ↓ → → → ENTER                 |
| Reboot C64            | Power & Reset → Reboot C64        | F1 → ↓ → → → ↓ → ENTER             |
| Reboot (Clear Memory) | Power & Reset → Reboot (Clr Mem)  | F1 → ↓ → → → ↓↓ → ENTER            |
| Power OFF             | Power & Reset → Power OFF         | F1 → ↓ → → → ↓↓↓ → ENTER           |
| Power Cycle           | Power & Reset → Power Cycle       | F1 → ↓ → → → ↓↓↓↓ → ENTER          |
| Save C64 Memory       | Power & Reset → Save C64 Memory   | F1 → ↓ → → → ↓↓↓↓↓ → ENTER         |
| Save REU Memory       | Power & Reset → Save REU Memory   | F1 → ↓ → → → ↓↓↓↓↓↓ → ENTER        |
| Drive A Off           | Built-in Drive A → Turn Off       | F1 → ↓ → → ↓ → → ENTER             |
| Drive A Reset         | Built-in Drive A → Reset          | F1 → ↓ → → ↓ → → ↓ → ENTER         |
| Drive A Mode          | Built-in Drive A → Switch         | F1 → ↓ → → ↓ → → ↓↓ → ENTER        |
| IEC Set Dir           | Software IEC → Set directory here | F1 → ↓ → → ↓↓↓ → → ↓↓ → ENTER      |
| Printer Flush         | Printer → Flush/Eject             | F1 → ↓ → → ↓↓↓↓ → → ENTER          |
| Config Save Flash     | Configuration → Save to Flash     | F1 → ↓ → → ↓↓↓↓↓ → → ENTER         |
| Config Reset Default  | Configuration → Reset to Defaults | F1 → ↓ → → ↓↓↓↓↓ → → ↓↓ → ENTER    |
| Start VIC Stream      | Streams → VIC Stream              | F1 → ↓ → → ↓↓↓↓↓↓ → → ENTER        |
| Start Audio Stream    | Streams → Audio Stream            | F1 → ↓ → → ↓↓↓↓↓↓ → → ↓ → ENTER    |
| Debug Stream          | Developer → Debug Stream          | F1 → ↓ → → ↓↓↓↓↓↓↓ → → ↓↓↓ → ENTER |

NOTE: Key sequences are illustrative. Implement label-based navigation instead.

---

## 8. REST vs Telnet Capability Table

| Capability            | Telnet | REST Method | REST Path                    |
| --------------------- | ------ | ----------- | ---------------------------- |
| Reset C64             | Yes    | PUT         | /v1/machine:reset            |
| Reboot C64            | Yes    | PUT         | /v1/machine:reboot           |
| Reboot (Clear Memory) | Yes    | No          | -                            |
| Power OFF             | Yes    | PUT         | /v1/machine:poweroff         |
| Power Cycle           | Yes    | No          | -                            |
| Save C64 Memory       | Yes    | No          | -                            |
| Save REU Memory       | Yes    | No          | -                            |
| Drive On/Off          | Yes    | PUT         | /v1/drives/{drive}:on/off    |
| Drive Reset           | Yes    | PUT         | /v1/drives/{drive}:reset     |
| Drive Mode            | Yes    | PUT         | /v1/drives/{drive}:set_mode  |
| Insert Blank Disk     | Yes    | Partial     | /v1/files:create\_\*         |
| Set Directory         | Yes    | No          | -                            |
| IEC Reset             | Yes    | No          | -                            |
| Printer Control       | Yes    | No          | -                            |
| Save Config Flash     | Yes    | PUT         | /v1/configs:save_to_flash    |
| Load Config Flash     | Yes    | PUT         | /v1/configs:load_from_flash  |
| Reset Defaults        | Yes    | PUT         | /v1/configs:reset_to_default |
| Save Config File      | Yes    | No          | -                            |
| Clear Flash Config    | Yes    | No          | -                            |
| Start Video Stream    | Yes    | PUT         | /v1/streams/video:start      |
| Start Audio Stream    | Yes    | PUT         | /v1/streams/audio:start      |
| Debug Stream          | Yes    | PUT         | /v1/streams/debug:start      |
| Debug Log Ops         | Yes    | No          | -                            |
| CommoServe Search     | Yes    | No          | -                            |
| CommoServe Browse     | Yes    | No          | -                            |
| CommoServe Run/Mount  | Yes    | No          | -                            |

---

## 9. Client Requirements

Client MUST:

- Use label-based navigation for action menus
- Maintain screen model
- Verify state after each action
- Retry on inconsistencies
- For CommoServe: detect form fields by label, handle both free-text and dropdown input types
- For CommoServe: handle multi-screen flow (search form → results → entries → file actions)
- For CommoServe: detect `< No Items >` as empty result set

Client SHOULD:

- Cache menu structure
- Provide idempotent operations
- For CommoServe: cache server presets (categories, types, etc.) for the session

---

## 10. Telnet Mock Requirements

Mock MUST:

- Implement full action menu hierarchy
- Implement CommoServe search form with configurable presets
- Implement CommoServe results and file entry views
- Maintain cursor state across all screen types
- Respond to key inputs deterministically
- Render exact ASCII frames

Mock SHOULD:

- Simulate delays
- Simulate partial redraws
- Simulate failure modes
- Simulate CommoServe network errors (no connection, timeout, empty results)

---

## 11. Design Constraints

- Telnet is **UI-driven**, not API-driven
- Behavior is **stateful and fragile**
- REST should replace Telnet when available
- CommoServe requires internet connectivity on the device (not just local network)

---

## 12. Conclusion

Telnet provides:

- Full control surface
- No formal API guarantees
- Required fallback for missing REST endpoints

This specification ensures:

- Deterministic control
- Testability via mock
- Forward compatibility with REST replacement
