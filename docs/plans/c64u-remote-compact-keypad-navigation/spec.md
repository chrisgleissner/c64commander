# C64U Remote compact keypad navigation

## Design principles

C64U Remote is the keypad-focused Android build variant of C64 Commander and shares its pages, focus system, Remote Input, and playback engine. Its keypad model is therefore one model across the app, not a separate product UI.

- One press has one owner. The highest active context consumes it before lower contexts can see it.
- **D-pad Centre/OK goes in; Left Soft Key comes out; Right Soft Key opens choices.** F1 and F3 are not another navigation system.
- Input has two explicit domains. In normal app navigation, F1/F3 run their user-assigned app shortcuts; the high-value defaults are F1 Play/Pause and F3 Next tune. Wherever the UI explicitly sends keys to the C64, they always send literal C64 F1/F3 instead. There are no per-page mappings or implicit fallbacks.
- Short press is the default. No command requires a long press or chord. D-pad repeat may move focus, adjust a value, or pan; command keys ignore OS auto-repeat.
- A visible ring identifies focus and scrolls with it. A compact hint bar names the current Left Soft Key, D-pad Centre/OK, and Right Soft Key actions; C64 input surfaces additionally state `F1/F3: C64`. Touch hides app-navigation hints until the next physical-key action.
- Destructive actions always open a confirmation. Touch remains equivalent and convenient, never required for recovery.

## Physical keypad

Canonical names and positions, with the phone open, upright, and facing the user:

| Physical band       | Left              | Centre                                               | Right              |
| ------------------- | ----------------- | ---------------------------------------------------- | ------------------ |
| Upper controls      | **Left Soft Key** | **D-pad Up**                                         | **Right Soft Key** |
| Call and navigation | **Send/Call**     | **D-pad Left**, **D-pad Centre/OK**, **D-pad Right** | **End Call**       |
| Lower navigation    |                   | **D-pad Down**                                       |                    |
| Function keys       | **F1**            | **Commodore C=**                                     | **F3**             |
| T9 row 1            | **1**             | **2 / ABC**                                          | **3 / DEF**        |
| T9 row 2            | **4 / GHI**       | **5 / JKL**                                          | **6 / MNO**        |
| T9 row 3            | **7 / PQRS**      | **8 / TUV**                                          | **9 / WXYZ**       |
| T9 row 4            | **Star (`*`)**    | **0**                                                | **Pound (`#`)**    |

The mappings below are the product contract. Where delivery through the target OS compatibility layer is unproven, the named fallback remains available.

## Interaction model

### Normal navigation

| Physical key       | Recommended action                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| D-pad Up / Down    | Move through siblings in reading order; repeat moves repeatedly.                                                                       |
| D-pad Left / Right | Adjust the focused slider, tab, segmented control, or radio group; otherwise move to the previous/next sibling.                        |
| D-pad Centre/OK    | Enter a group, or activate the focused leaf.                                                                                           |
| Left Soft Key      | Back: leave the group, then return to the previous route. A visible Back/Close CTA plus D-pad Centre/OK is the fallback.               |
| Right Soft Key     | Open the focused item's menu; if it has none, open the Quick menu. The visible item-menu or app-bar Quick menu button is the fallback. |
| Send/Call          | Same as D-pad Centre/OK; D-pad Centre/OK is the fallback.                                                                              |
| End Call           | Reserved to the OS. It has no app command; if it backgrounds the app, all held C64 input is released.                                  |
| F1 / F3            | Run the configured app shortcut below. Defaults: F1 Play/Pause; F3 Next tune.                                                         |
| Commodore C=       | Open Search. `7` is the tested-key fallback until its event is verified.                                                               |
| 1–6                | Open Home, Play, Disks, Config, Settings, and Docs respectively.                                                                       |
| 7                  | Open Search.                                                                                                                           |
| 8                  | Pause/resume the C64 itself.                                                                                                           |
| 9                  | Open the confirmation for C64 reset; never reset directly.                                                                             |
| 0                  | Open Game Mode. If unavailable, explain why and keep the current page usable.                                                          |
| Star (`*`)         | Open Diagnostics.                                                                                                                      |
| Pound (`#`)        | Open Switch device; if only one device exists, show that state rather than doing nothing.                                              |

Each function key has one independently persisted **app shortcut**: Unassigned, Search, Quick menu, Game Mode, Play/Pause, or Next tune. A non-Unassigned action may be assigned to only one key. Assignments apply immediately and appear under Settings > Remote Input and in the Quick menu; Restore defaults sets F1 to Play/Pause and F3 to Next tune. No Back, OK, page jump, destructive action, macro, long press, or per-page assignment is offered. Playback shortcuts act without navigating to Play. If a configured action is unavailable, the app stays put and explains why.

Up or Down selects a group; D-pad Centre/OK enters at its first enabled child. Left Soft Key returns to the group header without leaving the page. At root it navigates back. F1/F3 app shortcuts act once on non-repeat key-down; key-up has no app action. An Unassigned press is consumed but does nothing.

### Dialogs, sheets, and item menus

The topmost surface owns all keys. Up/Down move among its controls, Left/Right adjust a control or move between peers, and D-pad Centre/OK or Send/Call activates. Left Soft Key closes the surface; in nested surfaces it closes only the top one. Right Soft Key opens a menu only when the surface advertises one and never opens the page-level Quick menu behind a dialog. End Call remains OS-reserved.

Digits, Star, Pound, F1, Commodore C=, and F3 do not invoke app shortcuts while an app-owned dialog, sheet, item menu, confirmation, key-capture prompt, or tour owns the screen. Key Explorer and binding capture may observe F1/F3 without executing them. The Remote Input host sheet delegates F1/F3 to its active surface; C64 Quick Keys and keyboard surfaces use the literal behavior below. Touch can operate every control and dismissal affordance.

### Text entry

| Physical key                 | Action while a field is engaged                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0–9                          | Multi-tap text; hostname mode inserts digits directly. OS auto-repeat is ignored.                                        |
| Star (`*`)                   | In hostname mode, cycle `.`, `:`, `-`, `_`, `/`; in multi-tap mode, toggle the last letter's case.                       |
| Pound (`#`)                  | Toggle Hostname/Multitap mode; show the active mode beside the field.                                                    |
| D-pad Left / Right           | Commit the pending character, then move the caret.                                                                       |
| D-pad Up / Down              | Commit and move to the previous/next field or control.                                                                   |
| D-pad Centre/OK or Send/Call | Commit the pending character; submit only when the field visibly labels OK as Submit/Connect.                            |
| Right Soft Key               | Delete one character; repeat may continue deleting. A visible Delete/Backspace control reached by D-pad is the fallback. |
| Left Soft Key                | Done: commit and return focus to the owning row without discarding text. D-pad Up/Down is the fallback.                  |
| F1, Commodore C=, F3         | Unused, so text entry cannot trigger app shortcuts, Search, or navigation.                                               |
| End Call                     | Reserved to the OS.                                                                                                      |

Touch and the software keyboard remain available. Leaving a field never silently clears it.

### Playback

F1/F3 have no implicit transport meaning. On Playback and every other normal page they run only their configured app shortcuts; an assigned Play/Pause or Next tune works without changing route. Play/Pause, Previous, and Next remain in the focus ring, and Android media buttons retain their dedicated transport behavior.

### Remote Input and Game Mode

Right Soft Key opens a **Controls** overlay containing Joystick/Keys, Watch, Listen, Game Mode, Release all, Exit Game Mode, and Close Remote Input as applicable. In ordinary Remote Input, Pound is a fallback that opens Controls; in Game Mode it toggles the compact Quick Keys/Watch/Listen overlay, which also includes Exit and Close. Controls is app-owned and suppresses F1/F3; Quick Keys is C64-owned and sends them literally. Both overlays are operable with D-pad plus D-pad Centre/OK; Pound closes Quick Keys and Left Soft Key closes the top overlay.

In the ordinary Keys surface, the D-pad navigates the on-screen C64 keyboard and D-pad Centre/OK or Send/Call taps the selected C64 key. Pound opens Controls. Digits, Star, and Commodore C= are unused; they never leak to global app shortcuts. Physical F1/F3 send the identically labelled C64 keys. Left Soft Key closes Remote Input, Right Soft Key opens Controls, and End Call remains OS-reserved.

In Joystick and Game Mode, key-down asserts input and key-up releases it; OS repeats are ignored because a held key is already asserted. The D-pad supplies directions and D-pad Centre/OK supplies fire. The default upright layout is **5 up, 7 left, 9 right, 0 down, 8 fire**. Classic T9 and custom layouts remain options. Direction slots rotate with the handset; fire does not. Simultaneous directions form diagonals only when the handset reports both keys held.

In Joystick, Game Mode's blue C64-control state, Keys, and Quick Keys, F1/F3 always target the C64 and app assignments are suppressed. With full `machine:input`, non-repeat key-down asserts the identically labelled C64 key and matching key-up releases it. On the KERNAL keyboard-buffer fallback, initial key-down injects one F1/F3 PETSCII code and key-up does nothing. Commodore C= remains suppressed until its event identity is known. Send/Call is unused while driving, Right Soft Key opens Controls, and unmapped game digits are unused. Star enters View only while a picture exists; otherwise it opens Controls with Watch focused. Left Soft Key exits Game Mode or Remote Input. Pound exposes visible Exit and Close fallbacks. End Call remains OS-reserved.

Before changing control/view mode, changing orientation, opening an overlay, exiting, closing, switching device, losing focus, backgrounding, or encountering a relay error, release every held C64 key and joystick input. Re-resolve still-held directions after rotation only after releasing their old meanings.

### View adjustment

Star is the sole direct toggle between **C64** (blue border) and **View** (amber border); the phrase “menu key” is not used. Entering View releases all C64 input. In View:

| Physical key                                  | Action                                                                       |
| --------------------------------------------- | ---------------------------------------------------------------------------- |
| D-pad Up / Down / Left / Right; 2 / 8 / 4 / 6 | Pan; repeat is allowed.                                                      |
| 3 or 9                                        | Zoom in.                                                                     |
| 1 or 7                                        | Zoom out.                                                                    |
| 0 or 5                                        | Fit the full screen.                                                         |
| D-pad Centre/OK or Send/Call                  | Lock/unlock tracking at the crosshair.                                       |
| Star (`*`) or Left Soft Key                   | Return to C64 control.                                                       |
| Right Soft Key                                | Open Controls; no page-level Quick menu.                                     |
| Pound (`#`)                                   | Toggle the Game Mode quick overlay when in Game Mode; otherwise unused.      |
| F1, Commodore C=, F3, End Call                | Suppressed or OS-reserved as above; neither app shortcuts nor C64 keys fire. |

View adjustment returns to C64 control after its existing inactivity timeout. If Watch stops or is unavailable, the app returns to C64 control, releases all input, and keeps Controls, Exit, and Close reachable. Touch gestures and on-screen zoom, fit, follow, and lock controls remain equivalent alternatives.

## Context precedence

Highest priority wins; consumption stops propagation and prevents a second action:

1. OS lifecycle/interception: background or focus loss releases all C64 input.
2. Owner of an already-held key: its key-up returns to the key-down owner.
3. Key Explorer or custom-binding capture: observe/bind only; trigger nothing else.
4. Topmost app-owned confirmation, dialog, item menu, tour, Quick menu, or Controls overlay; the Remote Input host sheet delegates to its active surface.
5. Engaged text field/T9 composer.
6. View adjustment.
7. C64 keyboard surface, Quick Keys, Joystick, or blue C64-control relay.
8. Configured F1/F3 app shortcuts.
9. Global page and device shortcuts.
10. Normal focus navigation.

Every transition clears held state before the new owner starts. A key-up is routed to the owner that accepted its key-down, even if the visible context changes meanwhile. After release-all, that owner consumes the eventual physical key-up without sending a second release or starting a new action.

## Changes from current behaviour

| Current user-visible behaviour                                                   | Recommended behaviour                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| F1 globally plays/pauses and F3 skips, even away from Playback.                  | F1 defaults to Play/Pause and F3 to Next tune; both are user-selectable, and every C64 input surface sends literal C64 F1/F3 instead. |
| Manual says F2 is Menu; the handset has Commodore C= instead, and C= is unbound. | Remove F2 from the handset model. Right Soft Key is Menu; once its event is verified, C= opens Search, with `7` retained as fallback. |
| “Back” and “menu key” do not identify pictured keys.                             | Left Soft Key is Back; Right Soft Key is Menu; Star alone toggles C64/View.                                                           |
| `8` and `9` app commands exist but are absent from the manual shortcut table.    | Document `8` C64 pause/resume and confirmed-only `9` reset.                                                                           |
| Game Mode's Pound overlay is mainly quick keys and stream switches.              | It also exposes keypad-operable Exit Game Mode and Close Remote Input recovery actions.                                               |
| Context guards are distributed and the Game overlay can compete with C64 relay.  | One precedence stack gives each press and its release exactly one owner.                                                              |
| View/control transitions do not state a release contract.                        | Every ownership transition releases all held C64 input before switching.                                                              |
| A held global command can follow OS key repeat.                                  | Digits, soft/call keys, F1, Commodore C=, and F3 issue at most one app command per physical press.                                    |

## Hardware verification still required

| Physical key                                         | Expected event or observation                                                                              | Context                                                                | Pass condition                                                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Left Soft Key, Right Soft Key                        | Key Explorer records distinct key-down identities; a temporary diagnostic also observes key-up and repeat. | Normal page and open dialog through the target OS compatibility layer. | Both reach the app without an OS action, with stable identities that can be mapped separately.                                    |
| Send/Call                                            | A distinct key-down reaches the WebView; key-up is observable.                                             | Normal page and Remote Input.                                          | The event is delivered without opening the dialler or changing app visibility.                                                    |
| End Call                                             | Determine whether the OS intercepts, backgrounds, terminates, or forwards it.                              | Normal page and while a Game Mode direction is held.                   | The OS outcome and any lifecycle callback are recorded; no forwarded event is duplicated after interception.                      |
| Commodore C=                                         | Key Explorer records its exact identity.                                                                   | Normal page, text field, dialog, and Game Mode.                        | One stable identity reaches the app without an OS shortcut intercepting it.                                                       |
| F1 and F3                                            | Confirm distinct key-down identities, repeat, key-up, and OS interception.                                 | Key Explorer opened from normal navigation and from Remote Input.      | Each key reaches the app with one stable identity on key-down and key-up, repeat is identifiable, and no OS action intercepts it. |
| D-pad, D-pad Centre/OK, 0–9, Star (`*`), Pound (`#`) | Record exact key-down/key-up identities and test keypad rollover for two simultaneous direction keys.      | Key Explorer, T9, Game Mode, and View.                                 | Presses and releases are distinct and reliable; the rollover result is documented without assuming simultaneous-key support.      |
