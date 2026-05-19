# CTA Inventory - Distinct Interaction Types To Exercise

## Why this list exists

"Test all features" is unbounded. "Test every distinct kind of user interaction" is bounded. The soak is built around the latter. Every entry in this table must be exercised at least once during a Phase D soak run, and the agent must record the concrete element it interacted with so the reviewer can verify the claim.

The categorization is by **interaction shape**, not by **business function**. A volume slider and a duration slider are the same shape and counted once - but the soak still hits both, in different pages, to spread the load.

## Interaction shapes

| ID | Shape | Concrete example | Primary oracle |
| --- | --- | --- | --- |
| `TAP_BUTTON` | One-shot button tap | Home -> `Reset` quick action card | Button busy state + REST/state-ref change + diagnostics log line |
| `TAP_ICON_BUTTON` | Compact icon button (no visible label) | Settings -> add saved device (`Plus` icon) | UI state change + saved-devices store update |
| `TAP_CARD_TOGGLE` | Card with toggle behavior (tap to expand/collapse, not a control) | Home -> system info strip expand/collapse | Visible content delta |
| `TAP_NAV_TAB` | Bottom tab bar item | `Home -> Play -> Disks -> Config -> Settings` | Route change + first paint screenshot |
| `LONG_PRESS` | Long-press gesture on a UI element | App bar activity indicator -> "Switch device" picker | Picker visible + log entry |
| `TAP_REPEATED_HIDDEN` | Tap-N-times to unlock a hidden control | About card -> 7 taps within 3 s for developer mode | Developer-mode flag persisted, UI exposes developer controls |
| `SLIDER_DRAG` | Drag a slider through its range | Audio Mixer SID volume slider; PlayFiles default duration slider | Config write event + REST-visible value |
| `SLIDER_TAP_TO_VALUE` | Tap to jump slider to a specific value | List preview limit slider | Same as above |
| `SELECT_OPEN_AND_PICK` | Open a select, choose an option | Drive type select on Home/Disks; safety mode select | Config write + UI label change |
| `CHECKBOX_TOGGLE` | Toggle a checkbox/switch | Drive enabled toggle; demo mode checkbox | Persisted setting + downstream effect |
| `TEXT_INPUT_TYPE_AND_BLUR` | Type into an input and lose focus | Settings -> device hostname; archive overrides | Persisted setting + visible value |
| `TEXT_INPUT_TYPE_AND_ENTER` | Type into input and press Enter | Settings -> startup discovery window (numeric inputs accept Enter) | Persisted setting |
| `FILTER_TYPE` | Type into a filter input that affects a list | Config category search; playlist filter; disk library filter | Filtered row count |
| `LIST_BULK_SELECT_ALL` | Bulk action: select all visible | Playlist `select all` | Selection count |
| `LIST_BULK_DESELECT_ALL` | Bulk action: deselect all | Playlist `deselect all` | Selection count |
| `LIST_REMOVE_SELECTED` | Bulk remove of selected rows | Disk library remove-selected | Persistent store delta |
| `LIST_VIEW_ALL` | Switch from preview list to full list view | Playlist view-all toggle | Visible row count delta |
| `ITEM_MENU_ACTION` | Open a per-row action menu and pick an action | Disk row -> rename | Persistent store delta |
| `DIALOG_CONFIRM_DESTRUCTIVE` | Open destructive dialog and confirm | Settings -> select Relaxed safety mode -> confirm dialog | Persisted setting + dialog dismissal |
| `DIALOG_CANCEL_DESTRUCTIVE` | Open destructive dialog and cancel | Same as above but cancel | No persisted change + dialog dismissal |
| `ACCORDION_OPEN_CLOSE` | Open and close an accordion section | Docs page sections; Config browser category accordion | Visible content delta |
| `SWIPE_NAV` | Horizontal swipe gesture for navigation | `SwipeNavigationLayer` between adjacent tabs | Route change |
| `SCROLL_LONG_LIST` | Scroll a long virtualized list | Disk library full view | Frame timing in screen recording |
| `FOLDER_PICKER_PICK` | Native folder picker -> pick a folder | RAM dump folder selection; HVSC songlengths picker | Persisted SAF URI |
| `FILE_PICKER_PICK` | Native file picker -> pick a file | Songlengths file pick | Persisted file handle + parsed entries |
| `SOURCE_BROWSE_AND_IMPORT` | Source browser: navigate, toggle checkboxes, confirm | Add to playlist from Local; from C64U FTP; from HVSC | Playlist row count + source attribution |
| `MOUNT_DISK_TO_DRIVE` | Mount-disk dialog flow | Disks -> mount to Drive A | Drive state REST round-trip |
| `EJECT_DISK_FROM_DRIVE` | Eject action | Disks -> eject Drive A | Drive state REST round-trip |
| `ROTATE_GROUPED_DISK` | Prev/Next on a grouped disk | Disks -> Prev/Next | Mounted-disk REST state |
| `TRANSPORT_PLAY` | Start playback | Play -> Play | Runner REST + c64scope A/V if signal-sensitive |
| `TRANSPORT_PAUSE_RESUME` | Pause then resume | Play -> Pause -> Resume | Machine state REST + audio-mixer state |
| `TRANSPORT_NEXT_PREV` | Skip forward/backward | Play -> Next, Prev | Current-item delta |
| `TRANSPORT_STOP` | Stop playback | Play -> Stop | Runner state cleared |
| `STREAM_START_STOP` | Start then stop a UDP stream | Home -> start audio stream, stop it | Stream state + REST round-trip |
| `STREAM_EDIT_ENDPOINT` | Edit a stream endpoint and validate | Home -> edit stream endpoint | Persisted endpoint, validation message if any |
| `MACHINE_PAUSE_RESUME` | Machine-level pause then resume | Home -> Pause then Resume | Machine state REST + recovery |
| `MACHINE_MENU` | Open ROM menu over Telnet path | Home -> Menu | Telnet log + machine state |
| `RAM_SAVE` | Save RAM dump to chosen folder | Home -> Save RAM | SAF write artifact present |
| `RAM_LOAD` | Load RAM dump | Home -> Load RAM (valid image) | Machine recovers, runner state |
| `DEVICE_SWITCH_QUICK` | Switch saved device via quick picker | App bar long-press -> pick other device | New active device, verified state |
| `DEVICE_SWITCH_VIA_SETTINGS` | Switch via Settings list | Settings -> tap row | Same |
| `SETTINGS_EXPORT` | Export non-sensitive settings | Settings -> Export | Downloaded `c64commander-settings.json` |
| `SETTINGS_IMPORT` | Import a previously-exported settings file | Settings -> Import | Settings values applied |
| `DIAGNOSTICS_OPEN_AND_CLOSE` | Open the global diagnostics dialog and close it | App bar diagnostics indicator | Dialog visible + close + open-latency under budget |
| `DIAGNOSTICS_SHARE` | Share diagnostics zip for one tab | Diagnostics dialog -> share | Cache-written ZIP path captured |
| `DIAGNOSTICS_CLEAR` | Clear logs/traces | Diagnostics dialog -> clear | Stores empty after action |
| `CONFIG_RESET_AUDIO_MIXER` | Reset Audio Mixer category | Config -> Audio Mixer -> Reset | Mixer values reset, REST round-trip |
| `CONFIG_SOLO_SID` | Solo a SID channel and unsolo | Config -> Audio Mixer -> Solo | Other channels mute, then restore |
| `CONFIG_SYNC_CLOCK` | Clock sync action | Config -> Clock Settings -> Sync clock | Clock items updated |
| `HVSC_DOWNLOAD_INGEST` | Long-running HVSC download + ingest | Play -> HVSC -> Download | Filesystem artifacts + final ready status |
| `HVSC_CANCEL` | Cancel a long-running HVSC operation | Play -> HVSC -> Stop | UI returns to idle, no partial state |
| `EXTERNAL_LINK_OPEN` | External link tap | Docs -> external link | Open intent fires (browser launches) |
| `RELOAD_AFTER_CONFIG_CHANGE` | Refresh a category | Config -> Refresh on an open category | Re-fetched data visible |
| `THEME_SWITCH` | Cycle theme Light/Dark/System | Settings -> Appearance | DOM theme attribute |
| `BACK_BUTTON` | Android system back press | While on Licenses page -> back | Route returns to Settings |
| `APP_BACKGROUND_FOREGROUND` | App moved to background and back | Home key, then re-open | Connection state retained, diagnostics indicator intact |
| `SCREEN_LOCK_UNLOCK_DURING_PLAY` | Lock screen, wait, unlock during playback | Play -> start -> lock | Background-execution log + timeline reconciliation |

## Coverage mapping

Every shape must map to at least one concrete instance and at least one page. The soak scenarios in `soak-scenarios.md` are responsible for actually firing them in order.

| Shape | Primary instance | Page | Soak scenario |
| --- | --- | --- | --- |
| `TAP_BUTTON` | Home `Reset` | Home | `H1` |
| `TAP_ICON_BUTTON` | Settings `+` add-device | Settings | `S1` |
| `TAP_CARD_TOGGLE` | Home system info expand | Home | `H1` |
| `TAP_NAV_TAB` | Tab bar | All | `N1` |
| `LONG_PRESS` | App bar activity indicator | All | `N2` |
| `TAP_REPEATED_HIDDEN` | About card 7 taps | Settings | `S5` |
| `SLIDER_DRAG` | PlayFiles volume | Play | `P3` |
| `SLIDER_TAP_TO_VALUE` | Settings list preview limit | Settings | `S2` |
| `SELECT_OPEN_AND_PICK` | Settings safety mode select | Settings | `S3` |
| `CHECKBOX_TOGGLE` | Home drive enabled | Home | `H2` |
| `TEXT_INPUT_TYPE_AND_BLUR` | Settings device hostname | Settings | `S1` |
| `TEXT_INPUT_TYPE_AND_ENTER` | Settings probe timeout | Settings | `S2` |
| `FILTER_TYPE` | Config search | Config | `C1` |
| `LIST_BULK_SELECT_ALL` | Playlist select-all | Play | `P2` |
| `LIST_BULK_DESELECT_ALL` | Playlist deselect-all | Play | `P2` |
| `LIST_REMOVE_SELECTED` | Disk library remove-selected | Disks | `D2` |
| `LIST_VIEW_ALL` | Playlist view-all | Play | `P2` |
| `ITEM_MENU_ACTION` | Disk rename | Disks | `D2` |
| `DIALOG_CONFIRM_DESTRUCTIVE` | Relaxed safety confirm | Settings | `S3` |
| `DIALOG_CANCEL_DESTRUCTIVE` | Relaxed safety cancel | Settings | `S3` |
| `ACCORDION_OPEN_CLOSE` | Config category | Config | `C1` |
| `SWIPE_NAV` | Swipe between tabs | All | `N1` |
| `SCROLL_LONG_LIST` | Disk library full view | Disks | `D1` |
| `FOLDER_PICKER_PICK` | RAM dump folder | Home | `H3` |
| `FILE_PICKER_PICK` | Songlengths file | Play | `P4` |
| `SOURCE_BROWSE_AND_IMPORT` | Local source import | Play | `P1` |
| `MOUNT_DISK_TO_DRIVE` | Mount to Drive A | Disks | `D1` |
| `EJECT_DISK_FROM_DRIVE` | Eject Drive A | Disks | `D1` |
| `ROTATE_GROUPED_DISK` | Disks Prev/Next | Disks | `D2` |
| `TRANSPORT_PLAY` | Play -> Play | Play | `P3` |
| `TRANSPORT_PAUSE_RESUME` | Play -> Pause/Resume | Play | `P3` |
| `TRANSPORT_NEXT_PREV` | Play -> Next/Prev | Play | `P3` |
| `TRANSPORT_STOP` | Play -> Stop | Play | `P3` |
| `STREAM_START_STOP` | Home audio stream | Home | `H4` |
| `STREAM_EDIT_ENDPOINT` | Home stream endpoint edit | Home | `H4` |
| `MACHINE_PAUSE_RESUME` | Home pause / resume | Home | `H1` |
| `MACHINE_MENU` | Home Menu | Home | `H1` (guarded - safety budget) |
| `RAM_SAVE` | Home Save RAM | Home | `H3` |
| `RAM_LOAD` | Home Load RAM | Home | `H3` |
| `DEVICE_SWITCH_QUICK` | App bar long-press picker | All | `N2` |
| `DEVICE_SWITCH_VIA_SETTINGS` | Settings device row | Settings | `S4` |
| `SETTINGS_EXPORT` | Settings export button | Settings | `S6` |
| `SETTINGS_IMPORT` | Settings import button | Settings | `S6` |
| `DIAGNOSTICS_OPEN_AND_CLOSE` | App bar diagnostics indicator | All | `N3` |
| `DIAGNOSTICS_SHARE` | Diagnostics dialog share | Settings | `S7` |
| `DIAGNOSTICS_CLEAR` | Diagnostics dialog clear | Settings | `S7` |
| `CONFIG_RESET_AUDIO_MIXER` | Config Audio Mixer reset | Config | `C2` |
| `CONFIG_SOLO_SID` | Config Audio Mixer solo | Config | `C2` |
| `CONFIG_SYNC_CLOCK` | Config Clock Sync | Config | `C2` |
| `HVSC_DOWNLOAD_INGEST` | HVSC download+ingest | Play | `P5` (skipped if budget too low) |
| `HVSC_CANCEL` | HVSC stop | Play | `P5` |
| `EXTERNAL_LINK_OPEN` | Docs external link | Docs | `X1` (smoke only, no real navigation away) |
| `RELOAD_AFTER_CONFIG_CHANGE` | Config refresh | Config | `C1` |
| `THEME_SWITCH` | Appearance Light/Dark/System | Settings | `S5` |
| `BACK_BUTTON` | Licenses -> back | Settings | `S8` |
| `APP_BACKGROUND_FOREGROUND` | Home key then re-open | All | `N4` |
| `SCREEN_LOCK_UNLOCK_DURING_PLAY` | Lock during playback | Play | `P3` |

If any row says `TBD` after Phase B closes, the plan is not green and the soak cannot start.
