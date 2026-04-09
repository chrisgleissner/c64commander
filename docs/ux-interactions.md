# UX Interactions & Test Coverage

## Overview

This document provides a comprehensive inventory of all user-facing interactions (CTAs - Call To Actions) and multi-step user flows in C64 Commander. Each interaction is classified by importance and mapped to test coverage.

**Last Updated**: 2026-03-27
**Total CTAs Documented**: TBD
**Test Coverage Target**: 100%

---

## Legend

### Importance Levels

- **CRITICAL**: Core functionality; app unusable without it
- **HIGH**: Key user workflows; frequently used features
- **MEDIUM**: Secondary features; quality-of-life improvements
- **LOW**: Nice-to-have; rarely used or edge-case features

### Test Coverage Status

- ✅ **FULL**: Complete test coverage with assertions
- ⚠️ **PARTIAL**: Some test coverage but gaps remain
- ❌ **NONE**: No test coverage identified
- 🔄 **PLANNED**: Test identified as needed, implementation pending

---

## Interstitial Model

Every interstitial in the app must be exactly one of:

### Modal

- Decision-only
- Blocking
- Short-lived
- Explicit confirmation or acknowledgement

Examples:

- Demo Mode prompt
- Source selection chooser
- Restore Snapshot confirmation
- Delete confirmations
- Rename prompts

### Bottom Sheet

- Workflow-only
- Scrollable or exploratory
- May stay open while the user browses, filters, or edits
- Keeps background context visible

Examples:

- Source browser
- Playlist and disk “View all”
- Lighting Studio
- Diagnostics
- Snapshot browser
- Manage App Configs
- Load from App

### Invariant

- Never choose modal vs bottom sheet by screen size or height.
- Never combine selection and confirmation in the same interstitial.
- Split hybrid flows into a workflow sheet plus a separate decision modal.

Concrete application rules:

- Demo Mode stays a modal.
- Source selection stays a modal.
- Source browsing stays a bottom sheet.
- Lighting Studio stays a bottom sheet.
- Diagnostics stays a bottom sheet.
- Snapshot browsing stays a bottom sheet and restore confirmation stays a modal.

---

## 1. Play Page (PlayFilesPage)

### 1.1 Primary CTAs

| CTA         | Label                           | Purpose                       | Importance   | Test Coverage | Test File                        | Notes                               |
| ----------- | ------------------------------- | ----------------------------- | ------------ | ------------- | -------------------------------- | ----------------------------------- |
| Button      | "Add items" / "Add more items"  | Open source selection modal   | **CRITICAL** | ✅ FULL       | ui.spec.ts:174                   | Primary acquisition flow            |
| Button      | "Play" / "Stop"                 | Start/stop playback           | **CRITICAL** | ✅ FULL       | playback.spec.ts:359             | Transport control                   |
| Button      | "Pause" / "Resume"              | Pause/resume playback         | **CRITICAL** | ✅ FULL       | playback.spec.ts:359             | Transport control                   |
| Button      | "Prev"                          | Previous track                | **HIGH**     | ✅ FULL       | playback.spec.ts:328             | Transport control                   |
| Button      | "Next"                          | Next track                    | **HIGH**     | ✅ FULL       | playback.spec.ts:328             | Transport control                   |
| Checkbox    | "Shuffle"                       | Enable shuffle mode           | **MEDIUM**   | ✅ FULL       | playlistControls.spec.ts:85      | Playlist option                     |
| Checkbox    | "Repeat"                        | Enable repeat mode            | **MEDIUM**   | ✅ FULL       | playlistControls.spec.ts:107     | Playlist option                     |
| Button      | "Reshuffle"                     | Re-randomize playlist         | **LOW**      | ✅ FULL       | playlistControls.spec.ts:113     | Requires shuffle enabled            |
| Button      | "Select all"                    | Select all playlist items     | **HIGH**     | ✅ FULL       | playback.spec.ts:407             | Bulk action                         |
| Button      | "Deselect all"                  | Clear selection               | **HIGH**     | ✅ FULL       | uxInteractions.spec.ts:173       | Bulk action                         |
| Button      | "Remove selected"               | Delete selected from playlist | **HIGH**     | ✅ FULL       | playback.spec.ts:407             | Destructive bulk action             |
| Button      | "View all"                      | Show full playlist sheet      | **MEDIUM**   | ✅ FULL       | uxInteractions.spec.ts:463       | Workflow bottom sheet               |
| Link/Button | Item title                      | Navigate to item details      | **MEDIUM**   | ⚠️ PARTIAL    | -                                | Interaction exists, limited testing |
| Menu        | "..." (more actions)            | Item-specific actions         | **MEDIUM**   | ⚠️ PARTIAL    | -                                | Per-item dropdown                   |
| Menu Item   | "Set duration"                  | Override song duration        | **MEDIUM**   | ✅ FULL       | playlistControls.spec.ts:126,172 | Advanced feature                    |
| Menu Item   | "Choose subsong"                | Select SID subsong            | **MEDIUM**   | ✅ FULL       | playlistControls.spec.ts:229     | SID-specific                        |
| Checkbox    | Item checkbox                   | Select/deselect item          | **HIGH**     | ✅ FULL       | playback.spec.ts:407             | Selection mechanism                 |
| Button      | "Close" / "Cancel" (in dialogs) | Dismiss current interstitial  | **HIGH**     | ✅ FULL       | ui.spec.ts:174                   | Modal or bottom-sheet dismissal     |

### 1.2 Item Selection Dialog (Source Selection)

| CTA      | Label                     | Purpose                     | Importance   | Test Coverage | Test File                    | Notes               |
| -------- | ------------------------- | --------------------------- | ------------ | ------------- | ---------------------------- | ------------------- |
| Button   | "Local" / "Local Files"   | Select local file source    | **CRITICAL** | ✅ FULL       | uxInteractions.spec.ts:30    | Source selection    |
| Button   | "C64 Ultimate" / "C64U"   | Select C64U FTP source      | **CRITICAL** | ✅ FULL       | uxInteractions.spec.ts:79    | Source selection    |
| Button   | "Add folder"              | Pick Android folder         | **HIGH**     | ❌ NONE       | -                            | Native picker       |
| Button   | "Up" / "Back"             | Navigate up one level       | **HIGH**     | ✅ FULL       | uxInteractions.spec.ts:114   | Navigation          |
| Button   | "Root"                    | Jump to source root         | **MEDIUM**   | ⚠️ PARTIAL    | uxInteractions.spec.ts:584   | Quick navigation    |
| Button   | "Select all" (in browser) | Select all files in view    | **MEDIUM**   | ✅ FULL       | uxInteractions.spec.ts:173   | Bulk selection      |
| Button   | "Add selected"            | Confirm and add to playlist | **CRITICAL** | ✅ FULL       | ui.spec.ts:174               | Confirmation        |
| Checkbox | "Recurse folders"         | Include subfolders          | **MEDIUM**   | ✅ FULL       | playlistControls.spec.ts:181 | Option toggle       |
| Dropdown | File type filter          | Filter by PRG/SID/etc       | **MEDIUM**   | ❌ NONE       | -                            | Filter control      |
| Checkbox | File/folder checkbox      | Select for addition         | **HIGH**     | ✅ FULL       | uxInteractions.spec.ts:173   | Selection mechanism |

Interaction split:

- Source chooser: modal
- Source browser: bottom sheet
- Add selected: footer action inside the bottom sheet workflow

### 1.3 HVSC-Specific Features

| CTA          | Label                   | Purpose                        | Importance | Test Coverage | Test File                | Notes                |
| ------------ | ----------------------- | ------------------------------ | ---------- | ------------- | ------------------------ | -------------------- |
| Button       | "Download HVSC"         | Download HVSC library          | **MEDIUM** | ✅ FULL       | hvsc.spec.ts:79          | One-time setup       |
| Button       | "Check for updates"     | Query HVSC version             | **LOW**    | ✅ FULL       | hvsc.spec.ts:133         | Maintenance          |
| Progress bar | HVSC installation       | Show library download progress | **MEDIUM** | ✅ FULL       | hvsc.spec.ts:79          | Feedback             |
| Button       | "Cancel" (HVSC install) | Abort installation             | **MEDIUM** | ❌ NONE       | -                        | Installation control |
| Button       | "Retry" (HVSC error)    | Retry failed operation         | **MEDIUM** | ✅ FULL       | hvsc.spec.ts:481,491,501 | Error recovery       |

---

## 2. Disks Page (DisksPage / HomeDiskManager)

### 2.1 Drive Control CTAs

| CTA          | Label                 | Purpose                          | Importance   | Test Coverage | Test File                     | Notes                 |
| ------------ | --------------------- | -------------------------------- | ------------ | ------------- | ----------------------------- | --------------------- |
| Button       | "Mount"               | Mount disk to active drive       | **CRITICAL** | ✅ FULL       | diskManagement.spec.ts:232    | Core disk operation   |
| Button       | "Eject"               | Unmount disk from drive          | **CRITICAL** | ✅ FULL       | diskManagement.spec.ts:232    | Core disk operation   |
| Button       | "◀ Prev"              | Rotate to previous disk in group | **HIGH**     | ✅ FULL       | diskManagement.spec.ts:232    | Multi-disk navigation |
| Button       | "Next ▶"              | Rotate to next disk in group     | **HIGH**     | ✅ FULL       | diskManagement.spec.ts:232    | Multi-disk navigation |
| Radio/Button | "Drive A" / "Drive B" | Select active drive              | **HIGH**     | ✅ FULL       | diskManagement.spec.ts:232    | Drive selection       |
| Toggle       | Drive enable/disable  | Turn drive on/off                | **MEDIUM**   | ❌ NONE       | -                             | Drive configuration   |
| Button       | "Add disks"           | Open disk browser                | **CRITICAL** | ✅ FULL       | itemSelection.spec.ts:434,505 | Primary acquisition   |

### 2.2 Disk Library Management

| CTA       | Label                 | Purpose                    | Importance | Test Coverage | Test File                                              | Notes                   |
| --------- | --------------------- | -------------------------- | ---------- | ------------- | ------------------------------------------------------ | ----------------------- |
| Button    | "Select all"          | Select all disks           | **HIGH**   | ✅ FULL       | diskManagement.spec.ts:324                             | Bulk action             |
| Button    | "Deselect all"        | Clear selection            | **HIGH**   | ⚠️ PARTIAL    | uxInteractions.spec.ts:173                             | Bulk action             |
| Button    | "Remove selected"     | Delete from library        | **HIGH**   | ✅ FULL       | diskManagement.spec.ts:324                             | Destructive bulk action |
| Button    | "View all"            | Show full disk list sheet  | **MEDIUM** | ✅ FULL       | diskManagement.spec.ts:264, uxInteractions.spec.ts:463 | Workflow bottom sheet   |
| Menu      | "..." (disk actions)  | Per-disk actions           | **MEDIUM** | ⚠️ PARTIAL    | diskManagement.spec.ts:307                             | Item menu               |
| Menu Item | "Rename"              | Change disk label          | **MEDIUM** | ✅ FULL       | diskManagement.spec.ts:307                             | Metadata edit           |
| Menu Item | "Set group"           | Assign to multi-disk group | **MEDIUM** | ❌ NONE       | -                                                      | Organization            |
| Menu Item | "Remove from library" | Delete single disk         | **MEDIUM** | ⚠️ PARTIAL    | diskManagement.spec.ts:324                             | Destructive action      |
| Checkbox  | Disk checkbox         | Select for bulk action     | **HIGH**   | ✅ FULL       | diskManagement.spec.ts:324                             | Selection mechanism     |

### 2.3 Disk Browser (Item Selection)

| CTA      | Label                      | Purpose                    | Importance   | Test Coverage | Test File                 | Notes               |
| -------- | -------------------------- | -------------------------- | ------------ | ------------- | ------------------------- | ------------------- |
| Button   | "Local"                    | Select local disk source   | **CRITICAL** | ✅ FULL       | itemSelection.spec.ts:505 | Source selection    |
| Button   | "C64 Ultimate"             | Select C64U FTP source     | **CRITICAL** | ✅ FULL       | itemSelection.spec.ts:434 | Source selection    |
| Button   | "Add selected"             | Confirm and add to library | **CRITICAL** | ✅ FULL       | itemSelection.spec.ts:434 | Confirmation        |
| Checkbox | File filter (D64/D71/etc)  | Filter disk formats        | **MEDIUM**   | ❌ NONE       | -                         | File type filter    |
| Checkbox | Disk checkbox (in browser) | Select disk                | **HIGH**     | ✅ FULL       | itemSelection.spec.ts:434 | Selection mechanism |

---

## 3. Home Page (HomePage)

### 3.1 Quick Actions

| CTA             | Label                | Purpose                                               | Importance | Test Coverage | Test File                                          | Notes                                    |
| --------------- | -------------------- | ----------------------------------------------------- | ---------- | ------------- | -------------------------------------------------- | ---------------------------------------- |
| QuickActionCard | "Reset"              | Hard reset C64                                        | **HIGH**   | ✅ FULL       | homeInteractivity.spec.ts:120                      | Machine control                          |
| QuickActionCard | "Reboot"             | Reboot via REST without clearing RAM                  | **HIGH**   | ⚠️ PARTIAL    | tests/unit/lib/deviceControl/deviceControl.test.ts | Uses REST reboot only                    |
| QuickActionCard | "Pause" / "Resume"   | Pause or resume emulation                             | **MEDIUM** | ✅ FULL       | homeInteractivity.spec.ts:120                      | Machine control                          |
| QuickActionCard | "Menu"               | Toggle C64U menu                                      | **HIGH**   | ⚠️ PARTIAL    | tests/unit/lib/deviceControl/deviceControl.test.ts | Serialized REST toggle                   |
| QuickActionCard | "Save RAM"           | Open RAM snapshot export flow                         | **HIGH**   | ⚠️ PARTIAL    | HomePage.ramActions.test.tsx                       | Folder-backed export                     |
| QuickActionCard | "Load RAM"           | Open unified RAM and REU restore flow                 | **HIGH**   | ⚠️ PARTIAL    | HomePage.ramActions.test.tsx                       | Snapshot sheet with REU-specific actions |
| QuickActionCard | "Power Cycle"        | Full power cycle via Telnet                           | **MEDIUM** | ⚠️ PARTIAL    | tests/unit/pages/HomePage.ramActions.test.tsx      | Telnet-only routing                      |
| QuickActionCard | "Power Off"          | Power down C64                                        | **LOW**    | ✅ FULL       | homeInteractivity.spec.ts:120                      | Machine control - destructive            |
| Overflow action | "Reboot (Clear RAM)" | Reboot with clear RAM, Telnet first and REST fallback | **MEDIUM** | ⚠️ PARTIAL    | tests/unit/pages/HomePage.ramActions.test.tsx      | Quick Actions overflow menu              |
| Overflow action | "Save REU"           | Save REU through staged FTP plus Telnet workflow      | **MEDIUM** | ⚠️ PARTIAL    | tests/unit/pages/HomePage.ramActions.test.tsx      | Quick Actions overflow menu              |

### 3.2 Configuration Management

| CTA             | Label                  | Purpose                   | Importance | Test Coverage | Test File                            | Notes                 |
| --------------- | ---------------------- | ------------------------- | ---------- | ------------- | ------------------------------------ | --------------------- |
| QuickActionCard | "Apply"                | Send config to device     | **HIGH**   | ⚠️ PARTIAL    | homeConfigManagement.spec.ts:74      | Config sync           |
| QuickActionCard | "Save" (to app)        | Save to local storage     | **HIGH**   | ✅ FULL       | homeConfigManagement.spec.ts:121     | Config persistence    |
| QuickActionCard | "Load" (from app)      | Load from local storage   | **HIGH**   | ✅ FULL       | homeConfigManagement.spec.ts:143     | Config restoration    |
| QuickActionCard | "Revert"               | Discard pending changes   | **MEDIUM** | ❌ NONE       | -                                    | Config rollback       |
| QuickActionCard | "Manage" (app configs) | Open config manager sheet | **MEDIUM** | ⚠️ PARTIAL    | homeConfigManagement.spec.ts:180,220 | Workflow bottom sheet |

### 3.3 Config Manager

| CTA    | Label                 | Purpose            | Importance | Test Coverage | Test File                        | Notes              |
| ------ | --------------------- | ------------------ | ---------- | ------------- | -------------------------------- | ------------------ |
| Button | "Load" (per config)   | Load this config   | **HIGH**   | ✅ FULL       | homeConfigManagement.spec.ts:143 | Config selection   |
| Button | "Rename" (per config) | Change config name | **MEDIUM** | ✅ FULL       | homeConfigManagement.spec.ts:180 | Metadata edit      |
| Button | "Delete" (per config) | Remove config      | **MEDIUM** | ✅ FULL       | homeConfigManagement.spec.ts:220 | Destructive action |
| Button | "Close" (sheet)       | Dismiss manager    | **MEDIUM** | ✅ FULL       | homeConfigManagement.spec.ts:180 | Workflow dismissal |

Interaction split:

- Manager list: bottom sheet
- Rename: modal
- Delete: modal

### 3.4 Drive Status Cards

| CTA         | Label                 | Purpose                | Importance | Test Coverage | Test File | Notes            |
| ----------- | --------------------- | ---------------------- | ---------- | ------------- | --------- | ---------------- |
| Button/Card | "Drive A" status card | Navigate to Disks page | **MEDIUM** | ❌ NONE       | -         | Quick navigation |
| Button/Card | "Drive B" status card | Navigate to Disks page | **MEDIUM** | ❌ NONE       | -         | Quick navigation |

---

## 4. Settings Page (SettingsPage)

### 4.1 Connection Settings

| CTA         | Label                          | Purpose                                   | Importance   | Test Coverage | Test File                              | Notes                                  |
| ----------- | ------------------------------ | ----------------------------------------- | ------------ | ------------- | -------------------------------------- | -------------------------------------- |
| Button list | Saved devices                  | Select the active saved device            | **CRITICAL** | ⚠️ PARTIAL    | tests/unit/pages/SettingsPage.test.tsx | Updates fields from local metadata     |
| Button      | Add / Delete                   | Create or remove saved devices            | **HIGH**     | ⚠️ PARTIAL    | tests/unit/pages/SettingsPage.test.tsx | Keeps at least one device              |
| Input       | Device name / Badge label      | Set user-facing name and compact badge    | **HIGH**     | ⚠️ PARTIAL    | tests/unit/pages/SettingsPage.test.tsx | Badge label is capped at 8 characters  |
| Input       | Hostname / HTTP / FTP / Telnet | Edit the selected device connection tuple | **CRITICAL** | ⚠️ PARTIAL    | tests/unit/pages/SettingsPage.test.tsx | Stored per device                      |
| Input       | Password                       | Set the selected device password          | **HIGH**     | ⚠️ PARTIAL    | tests/unit/secureStorage.test.ts       | Stored in secure storage per device    |
| Button      | "Save & Connect"               | Persist selected device and verify target | **HIGH**     | ⚠️ PARTIAL    | tests/unit/pages/SettingsPage.test.tsx | Uses `/v1/info` after local projection |
| Button      | "Refresh connection"           | Verify connectivity                       | **HIGH**     | ✅ FULL       | settingsConnection.spec.ts:194         | Validation                             |
| Toggle      | "Auto-connect"                 | Connect on app launch                     | **MEDIUM**   | ❌ NONE       | -                                      | Convenience feature                    |
| Toggle      | "Mock mode"                    | Use mock server                           | **LOW**      | ✅ FULL       | settingsConnection.spec.ts:130         | Development only                       |

### 4.2 Appearance Settings

| CTA   | Label          | Purpose                | Importance | Test Coverage | Test File                      | Notes      |
| ----- | -------------- | ---------------------- | ---------- | ------------- | ------------------------------ | ---------- |
| Radio | "Light theme"  | Set light color scheme | **MEDIUM** | ✅ FULL       | settingsConnection.spec.ts:97  | Appearance |
| Radio | "Dark theme"   | Set dark color scheme  | **MEDIUM** | ✅ FULL       | settingsConnection.spec.ts:114 | Appearance |
| Radio | "System theme" | Follow OS theme        | **MEDIUM** | ✅ FULL       | settingsConnection.spec.ts:174 | Appearance |

### 4.3 Diagnostics

| CTA    | Label                       | Purpose                                       | Importance | Test Coverage | Test File                                                                      | Notes                         |
| ------ | --------------------------- | --------------------------------------------- | ---------- | ------------- | ------------------------------------------------------------------------------ | ----------------------------- |
| Button | "Diagnostics"               | Open diagnostics sheet                        | **LOW**    | ✅ FULL       | settingsDiagnostics.spec.ts:41                                                 | Workflow bottom sheet         |
| Button | Saved device rows           | Switch the selected saved device              | **HIGH**   | ✅ FULL       | tests/unit/components/diagnostics/DiagnosticsDialog.savedDeviceSwitch.test.tsx | 2-tap switch from main pages  |
| Button | "Clear All"                 | Clear all diagnostics data                    | **MEDIUM** | ✅ FULL       | settingsDiagnostics.spec.ts:133                                                | Maintenance                   |
| Button | "Share All"                 | Share all diagnostics as ZIP                  | **MEDIUM** | ✅ FULL       | homeDiagnosticsOverlay.spec.ts                                                 | Support tool                  |
| Input  | "Filter entries"            | Filter active diagnostics tab                 | **MEDIUM** | ✅ FULL       | homeDiagnosticsOverlay.spec.ts                                                 | Scoped filtering              |
| Button | Contributor filter "TELNET" | Focus diagnostics on Telnet-attributed issues | **MEDIUM** | ⚠️ PARTIAL    | tests/unit/components/diagnostics/DiagnosticsDialog.test.tsx                   | Available beside App/REST/FTP |
| Button | "Share"                     | Share active tab ZIP export                   | **MEDIUM** | ✅ FULL       | homeDiagnosticsOverlay.spec.ts                                                 | Support tool                  |

Diagnostics tools follow the same model:

- Diagnostics root: bottom sheet
- Saved-device switch list: inline section inside the diagnostics root sheet
- Filters, latency analysis, config drift, decision state, and history: bottom sheets
- Clear All confirmation: modal

### 4.4 Playback Settings

| CTA    | Label                 | Purpose                                                             | Importance | Test Coverage | Test File | Notes                                          |
| ------ | --------------------- | ------------------------------------------------------------------- | ---------- | ------------- | --------- | ---------------------------------------------- |
| Select | "Disk first-PRG load" | Choose KERNAL LOAD or DMA (Direct Memory Access) for disk autostart | **MEDIUM** | ❌ NONE       | -         | DMA loads faster; some loaders may not like it |

### 4.5 About

| CTA             | Label                 | Purpose                | Importance | Test Coverage | Test File     | Notes       |
| --------------- | --------------------- | ---------------------- | ---------- | ------------- | ------------- | ----------- |
| Button/Card     | "About" section       | Show version info      | **LOW**    | ⚠️ PARTIAL    | ui.spec.ts    | Information |
| Secret Tap (7x) | Developer mode toggle | Enable hidden features | **LOW**    | ⚠️ PARTIAL    | ui.spec.ts:61 | Easter egg  |

---

## 5. Config Browser Page (ConfigBrowserPage)

### 5.1 Category Navigation

| CTA    | Label             | Purpose                   | Importance | Test Coverage | Test File                        | Notes      |
| ------ | ----------------- | ------------------------- | ---------- | ------------- | -------------------------------- | ---------- |
| Button | Category expander | Expand/collapse section   | **HIGH**   | ✅ FULL       | ui.spec.ts:136                   | Navigation |
| Button | "Reset category"  | Restore category defaults | **MEDIUM** | ✅ FULL       | navigationBoundaries.spec.ts:250 | Bulk reset |

### 5.2 Config Item Controls

| CTA                 | Label                      | Purpose                  | Importance | Test Coverage | Test File      | Notes            |
| ------------------- | -------------------------- | ------------------------ | ---------- | ------------- | -------------- | ---------------- |
| Various             | Config widget interactions | Edit config values       | **HIGH**   | ✅ FULL       | ui.spec.ts:100 | Primary function |
| Button              | "Refresh" (per item)       | Reload value from device | **MEDIUM** | ✅ FULL       | ui.spec.ts:100 | Sync control     |
| Slider/Input/Toggle | Value editors              | Modify settings          | **HIGH**   | ✅ FULL       | ui.spec.ts:100 | Edit controls    |

---

## 6. Audio Mixer (Solo Feature)

| CTA    | Label                   | Purpose            | Importance | Test Coverage | Test File          | Notes         |
| ------ | ----------------------- | ------------------ | ---------- | ------------- | ------------------ | ------------- |
| Button | "Solo" toggle (per SID) | Isolate single SID | **MEDIUM** | ✅ FULL       | solo.spec.ts:43,57 | Audio routing |
| Button | "Disable solo"          | Restore normal mix | **MEDIUM** | ✅ FULL       | solo.spec.ts:70    | Audio routing |

---

## 7. Multi-Step User Flows

### 7.1 CRITICAL Flows

| Flow                            | Steps                                                                                                             | Importance   | Test Coverage | Test File                     | Notes               |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ | ------------- | ----------------------------- | ------------------- |
| **Add local files to playlist** | 1. Click "Add items"<br>2. Select "Local"<br>3. Navigate folders<br>4. Select files<br>5. Click "Add selected"    | **CRITICAL** | ✅ FULL       | playback.spec.ts:258          | Core acquisition    |
| **Add C64U files to playlist**  | 1. Click "Add items"<br>2. Select "C64 Ultimate"<br>3. Navigate FTP<br>4. Select files<br>5. Click "Add selected" | **CRITICAL** | ✅ FULL       | playback.spec.ts:166          | Core acquisition    |
| **Play a song**                 | 1. Add items to playlist<br>2. Click "Play"                                                                       | **CRITICAL** | ✅ FULL       | playback.spec.ts:359          | Core playback       |
| **Mount a disk**                | 1. Navigate to Disks<br>2. Select drive<br>3. Click disk<br>4. Click "Mount"                                      | **CRITICAL** | ✅ FULL       | diskManagement.spec.ts:232    | Core disk operation |
| **Add disks to library**        | 1. Click "Add disks"<br>2. Select source<br>3. Browse and select<br>4. Click "Add selected"                       | **CRITICAL** | ✅ FULL       | itemSelection.spec.ts:434,505 | Core acquisition    |

### 7.2 HIGH Priority Flows

| Flow                           | Steps                                                                                   | Importance | Test Coverage | Test File                        | Notes                    |
| ------------------------------ | --------------------------------------------------------------------------------------- | ---------- | ------------- | -------------------------------- | ------------------------ |
| **Remove items from playlist** | 1. Select items<br>2. Click "Remove selected"<br>3. Confirm                             | **HIGH**   | ✅ FULL       | playback.spec.ts:407             | Playlist management      |
| **Navigate playlist**          | 1. Play a song<br>2. Click "Next"/"Prev"                                                | **HIGH**   | ✅ FULL       | playback.spec.ts:328             | Transport control        |
| **Bulk remove disks**          | 1. Select multiple disks<br>2. Click "Remove selected"<br>3. Confirm                    | **HIGH**   | ✅ FULL       | diskManagement.spec.ts:324       | Library management       |
| **Save config to app**         | 1. Modify config<br>2. Click "Save"<br>3. Enter name<br>4. Confirm                      | **HIGH**   | ✅ FULL       | homeConfigManagement.spec.ts:121 | Config persistence       |
| **Load config from app**       | 1. Click "Load"<br>2. Select config in sheet                                            | **HIGH**   | ✅ FULL       | homeConfigManagement.spec.ts:143 | Non-destructive workflow |
| **Download HVSC**              | 1. Navigate to Play<br>2. Click "Download HVSC"<br>3. Confirm<br>4. Wait for completion | **HIGH**   | ✅ FULL       | hvsc.spec.ts:79                  | HVSC setup               |

### 7.3 MEDIUM Priority Flows

| Flow                         | Steps                                                                                        | Importance | Test Coverage | Test File                         | Notes                  |
| ---------------------------- | -------------------------------------------------------------------------------------------- | ---------- | ------------- | --------------------------------- | ---------------------- |
| **Set custom song duration** | 1. Click item menu "..."<br>2. Select "Set duration"<br>3. Enter time (mm:ss)<br>4. Confirm  | **MEDIUM** | ✅ FULL       | playlistControls.spec.ts:126,172  | Advanced playback      |
| **Select SID subsong**       | 1. Click item menu "..."<br>2. Select "Choose subsong"<br>3. Enter song number<br>4. Confirm | **MEDIUM** | ✅ FULL       | playlistControls.spec.ts:229      | SID-specific           |
| **Rotate multi-disk group**  | 1. Mount disk from group<br>2. Click "Next"/"Prev"<br>3. New disk auto-mounts                | **MEDIUM** | ✅ FULL       | diskManagement.spec.ts:232        | Multi-disk convenience |
| **Rename disk**              | 1. Click disk menu "..."<br>2. Select "Rename"<br>3. Enter new name<br>4. Confirm            | **MEDIUM** | ✅ FULL       | diskManagement.spec.ts:307        | Library organization   |
| **Enable shuffle**           | 1. Check "Shuffle"<br>2. Playlist reorders<br>3. Play to test                                | **MEDIUM** | ✅ FULL       | playlistControls.spec.ts:85,113   | Playback mode          |
| **Change theme**             | 1. Navigate to Settings<br>2. Select theme<br>3. UI updates                                  | **MEDIUM** | ✅ FULL       | settingsConnection.spec.ts:97,114 | Appearance             |

### 7.4 LOW Priority Flows

| Flow                           | Steps                                                                                        | Importance | Test Coverage | Test File                            | Notes          |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ---------- | ------------- | ------------------------------------ | -------------- |
| **Check HVSC updates**         | 1. Navigate to Play<br>2. Click "Check for updates"<br>3. Review status                      | **LOW**    | ✅ FULL       | hvsc.spec.ts:133                     | Maintenance    |
| **Share / Export diagnostics** | 1. Navigate to Settings<br>2. Click "Diagnostics"<br>3. Click "Share / Export"               | **LOW**    | ✅ FULL       | settingsDiagnostics.spec.ts:117      | Support tool   |
| **Manage app configs**         | 1. Click "Manage"<br>2. Browse saved configs in sheet<br>3. Rename/Delete in modal as needed | **LOW**    | ✅ FULL       | homeConfigManagement.spec.ts:180,220 | Split workflow |

---

## 8. Edge Cases & Error Handling

| Scenario                       | Expected Behavior            | Importance | Test Coverage | Test File                    | Notes             |
| ------------------------------ | ---------------------------- | ---------- | ------------- | ---------------------------- | ----------------- |
| FTP login failure              | Error toast, retry option    | **HIGH**   | ✅ FULL       | diskManagement.spec.ts:363   | Network error     |
| FTP server unavailable         | Error toast, clear message   | **HIGH**   | ✅ FULL       | diskManagement.spec.ts:384   | Network error     |
| HVSC installation failure      | Error toast, retry button    | **MEDIUM** | ✅ FULL       | hvsc.spec.ts:481,491,501     | Download error    |
| Empty playlist play attempt    | Disabled button or toast     | **MEDIUM** | ⚠️ PARTIAL    | -                            | UX validation     |
| Invalid duration input         | Validation message           | **LOW**    | ⚠️ PARTIAL    | playlistControls.spec.ts:126 | Input validation  |
| Non-disk file imported as disk | Warning toast, file rejected | **MEDIUM** | ✅ FULL       | diskManagement.spec.ts:349   | File validation   |
| Disk mounted, then deleted     | Auto-eject, status updated   | **MEDIUM** | ✅ FULL       | diskManagement.spec.ts:281   | State consistency |

---

## 9. Coverage Summary

### 9.1 Overall Statistics

- **Total CTAs**: ~150
- **Fully Covered**: ~80 (53%)
- **Partially Covered**: ~25 (17%)
- **Not Covered**: ~45 (30%)

### 9.2 By Importance

| Importance | Total | Covered | %   |
| ---------- | ----- | ------- | --- |
| CRITICAL   | 15    | 13      | 87% |
| HIGH       | 50    | 40      | 80% |
| MEDIUM     | 60    | 25      | 42% |
| LOW        | 25    | 2       | 8%  |

### 9.3 By Page

| Page     | Total CTAs | Covered | %   |
| -------- | ---------- | ------- | --- |
| Play     | 40         | 30      | 75% |
| Disks    | 35         | 25      | 71% |
| Home     | 20         | 8       | 40% |
| Settings | 25         | 15      | 60% |
| Config   | 20         | 18      | 90% |

### 9.4 Priority Gaps (CTAs to Test)

#### CRITICAL (Missing Coverage)

1. None currently identified.

#### HIGH (Missing Coverage)

1. ❌ Drive status card navigation
2. ❌ Android folder picker flow

#### MEDIUM (Missing Coverage)

1. ❌ File type filter dropdown
2. ❌ HVSC installation cancel
3. ❌ Drive enable/disable toggle
4. ❌ Set disk group flow
5. ❌ Auto-connect toggle
6. ❌ View logs expansion

---

## 10. Test Implementation Plan

### Phase 1: CRITICAL Gaps (Target: 100%)

- [x] Add disks to library E2E flow

### Phase 2: HIGH Gaps (Target: 95%+)

- [x] Shuffle mode tests
- [x] Home page quick actions
- [ ] Drive navigation from Home
- [ ] Disk browser source selection

### Phase 3: MEDIUM Gaps (Target: 80%+)

- [x] Playlist options (reshuffle, recurse)
- [ ] Filter controls
- [ ] HVSC edge cases
- [ ] Drive configuration
- [ ] Disk organization (groups)
- [x] Settings appearance options

### Phase 4: LOW Priority (Target: 50%+)

- [ ] Debug tools
- [ ] Developer mode features
- [ ] Less common edge cases

---

## 11. Notes & Conventions

### Test Naming

Tests should follow: `[page/component] › [feature] › [specific behavior]`

Example: `Play page › Add items › local source selection works`

### Test Data

Use fixtures in `playwright/fixtures/` for consistent test data.

### Graceful Degradation

Tests marked with `@allow-warnings` document missing UI elements with screenshots rather than failing hard.

### Mock vs Real

- Unit tests: Always use mocks
- E2E tests: Use mock C64U server for reliability
- FTP tests: Use local mock FTP server

---

## 12. Maintenance

This document should be updated when:

- New features are added
- CTAs are modified or removed
- Test coverage changes
- UX flows are refactored

**Document Owner**: Development Team
**Review Frequency**: Every sprint / Before major releases
