# C64U Remote compact keypad navigation

## Design principles

C64U Remote is the keypad-focused Android build variant of C64 Commander and shares its pages, focus system, Remote Input, and playback engine. Its keypad model is therefore one model across the app, not a separate product UI.

- One press has one owner. The highest active context consumes it before lower contexts can see it.
- **D-pad Centre/OK goes in; F1 or Left Soft Key comes out; F3 or Right Soft Key opens choices.** F1 and F3 are the easy-to-reach lower equivalents of the two soft actions. Their labels change only for the conventional Done/Delete pair in text and when the clearly signalled C64-control mode gives the printed F1/F3 keys to the C64.
- Short press is the default. No command requires a long press or chord. D-pad repeat may move focus, adjust a value, or pan; command keys ignore OS auto-repeat.
- A visible ring identifies focus and scrolls with it. A compact hint bar names the current `F1 / Left Soft Key`, D-pad Centre/OK, and `F3 / Right Soft Key` actions; touch hides the ring and hints until the next physical-key action.
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

| Physical key        | Recommended action                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| D-pad Up / Down     | Move through siblings in reading order; repeat moves repeatedly.                                                                       |
| D-pad Left / Right  | Adjust the focused slider, tab, segmented control, or radio group; otherwise move to the previous/next sibling.                        |
| D-pad Centre/OK     | Enter a group, or activate the focused leaf.                                                                                           |
| F1 / Left Soft Key  | Back: leave the group, then return to the previous route. A visible Back/Close CTA plus D-pad Centre/OK is the fallback.               |
| F3 / Right Soft Key | Open the focused item's menu; if it has none, open the Quick menu. The visible item-menu or app-bar Quick menu button is the fallback. |
| Send/Call           | Same as D-pad Centre/OK; D-pad Centre/OK is the fallback.                                                                              |
| End Call            | Reserved to the OS. It has no app command; if it backgrounds the app, all held C64 input is released.                                  |
| Commodore C=        | Open Search. `7` is the tested-key fallback until its event is verified.                                                               |
| 1–6                 | Open Home, Play, Disks, Config, Settings, and Docs respectively.                                                                       |
| 7                   | Open Search.                                                                                                                           |
| 8                   | Pause/resume the C64 itself.                                                                                                           |
| 9                   | Open the confirmation for C64 reset; never reset directly.                                                                             |
| 0                   | Open Game Mode. If unavailable, explain why and keep the current page usable.                                                          |
| Star (`*`)          | Open Diagnostics.                                                                                                                      |
| Pound (`#`)         | Open Switch device; if only one device exists, show that state rather than doing nothing.                                              |

Up or Down selects a group; D-pad Centre/OK enters at its first enabled child. F1 or Left Soft Key returns to the group header without leaving the page. At root it navigates back. F1/F3 auto-repeat is ignored, and key-up has no normal-navigation action.

### Dialogs, sheets, and item menus

The topmost surface owns all keys. Up/Down move among its controls, Left/Right adjust a control or move between peers, and D-pad Centre/OK or Send/Call activates. F1 or Left Soft Key closes the surface; in nested surfaces it closes only the top one. F3 or Right Soft Key opens a menu only when the surface advertises one and never opens the page-level Quick menu behind a dialog. End Call remains OS-reserved.

Digits, Star, Pound, and Commodore C= do not invoke global actions while a dialog, sheet, item menu, confirmation, key-capture prompt, or tour owns the screen. F1 and F3 perform only the surface's visibly labelled left and right actions; an absent action is a no-op. Touch can operate every control and dismissal affordance.

### Text entry

| Physical key                 | Action while a field is engaged                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| 0–9                          | Multi-tap text; hostname mode inserts digits directly. OS auto-repeat is ignored.                                        |
| Star (`*`)                   | In hostname mode, cycle `.`, `:`, `-`, `_`, `/`; in multi-tap mode, toggle the last letter's case.                       |
| Pound (`#`)                  | Toggle Hostname/Multitap mode; show the active mode beside the field.                                                    |
| D-pad Left / Right           | Commit the pending character, then move the caret.                                                                       |
| D-pad Up / Down              | Commit and move to the previous/next field or control.                                                                   |
| D-pad Centre/OK or Send/Call | Commit the pending character; submit only when the field visibly labels OK as Submit/Connect.                            |
| F3 / Right Soft Key          | Delete one character; repeat may continue deleting. A visible Delete/Backspace control reached by D-pad is the fallback. |
| F1 / Left Soft Key           | Done: commit and return focus to the owning row without discarding text. D-pad Up/Down is the fallback.                  |
| Commodore C=                 | Unused, so text entry cannot trigger Search or navigation.                                                               |
| End Call                     | Reserved to the OS.                                                                                                      |

Touch and the software keyboard remain available. Leaving a field never silently clears it.

### Playback

F1 and F3 keep their app-wide Back and Menu roles on the Playback page; they are not transport keys. Play/Pause, Previous, and Next remain in the focus ring and are operable with D-pad Centre/OK or touch. Android media buttons keep their dedicated transport behavior. Playback never changes a keypad key's meaning merely because audio is active.

### Remote Input and Game Mode

F3 or Right Soft Key opens a **Controls** overlay containing Joystick/Keys, Watch, Listen, Game Mode, Release all, Exit Game Mode, and Close Remote Input as applicable. In ordinary Remote Input, Pound is a fallback that opens Controls; in Game Mode it toggles the compact quick-key/Watch/Listen overlay, which also includes Exit and Close. Both overlays take focus and are operated with D-pad plus D-pad Centre/OK; Pound closes the quick overlay and F1 or Left Soft Key closes either overlay first.

In the ordinary Keys surface, the D-pad navigates the on-screen C64 keyboard and D-pad Centre/OK or Send/Call taps the selected C64 key. Pound opens Controls. Digits, Star, and Commodore C= are unused; they never leak to global app shortcuts. While the blue C64-control state is visible, physical F1 and F3 send the identically labelled C64 F1 and F3 keys. Left Soft Key closes Remote Input, Right Soft Key opens Controls, and End Call remains OS-reserved.

In Joystick and Game Mode, key-down asserts input and key-up releases it; OS repeats are ignored because a held key is already asserted. The D-pad supplies directions and D-pad Centre/OK supplies fire. The default upright layout is **5 up, 7 left, 9 right, 0 down, 8 fire**. Classic T9 and custom layouts remain options. Direction slots rotate with the handset; fire does not. Simultaneous directions form diagonals only when the handset reports both keys held.

In the blue C64-control state, physical F1/F3 key-down asserts the identically labelled C64 key and matching key-up releases it; repeat is ignored. Commodore C= remains suppressed until its event identity is known. Send/Call is unused while driving, Right Soft Key opens Controls, and digits not present in the active joystick layout are unused; none becomes C64 input accidentally. Star enters View only while a picture exists; otherwise it opens Controls with Watch focused. Left Soft Key exits View adjustment first, then Game Mode, then Remote Input on successive presses. Pound's Controls overlay provides visible Exit and Close fallbacks. End Call remains OS-reserved.

Before changing control/view mode, changing orientation, opening an overlay, exiting, closing, switching device, losing focus, backgrounding, or encountering a relay error, release every held C64 key and joystick input. Re-resolve still-held directions after rotation only after releasing their old meanings.

### View adjustment

Star is the sole direct toggle between **C64** (blue border) and **View** (amber border); the phrase “menu key” is not used. Entering View releases all C64 input. In View:

| Physical key                                  | Action                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------- |
| D-pad Up / Down / Left / Right; 2 / 8 / 4 / 6 | Pan; repeat is allowed.                                                 |
| 3 or 9                                        | Zoom in.                                                                |
| 1 or 7                                        | Zoom out.                                                               |
| 0 or 5                                        | Fit the full screen.                                                    |
| D-pad Centre/OK or Send/Call                  | Lock/unlock tracking at the crosshair.                                  |
| Star (`*`), F1, or Left Soft Key              | Return to C64 control.                                                  |
| F3 or Right Soft Key                          | Open Controls; no page-level Quick menu.                                |
| Pound (`#`)                                   | Toggle the Game Mode quick overlay when in Game Mode; otherwise unused. |
| Commodore C=, End Call                        | Suppressed or OS-reserved as above.                                     |

View adjustment returns to C64 control after its existing inactivity timeout. If Watch stops or is unavailable, the app returns to C64 control, releases all input, and keeps Controls, Exit, and Close reachable. Touch gestures and on-screen zoom, fit, follow, and lock controls remain equivalent alternatives.

## Context precedence

Highest priority wins; consumption stops propagation and prevents a second action:

1. OS lifecycle/interception: background or focus loss releases all C64 input.
2. Key Explorer or custom-binding capture: observe/bind only; trigger nothing else.
3. Confirmation, dialog, sheet, item menu, tour, or Controls overlay.
4. Engaged text field/T9 composer.
5. View adjustment.
6. Game Mode or Remote Input C64 relay.
7. Global page and device shortcuts.
8. Normal focus navigation.

Every transition clears held state before the new owner starts. A key-up is routed to the owner that accepted its key-down, even if the visible context changes meanwhile; closing a context performs release-all as the final safety net.

## Changes from current behaviour

| Current user-visible behaviour                                                   | Recommended behaviour                                                                                                                 |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| F1 globally plays/pauses and F3 skips, even away from Playback.                  | In app-owned contexts F1 mirrors the labelled left action and F3 the labelled right action. Only blue C64 control sends C64 F1/F3.    |
| Manual says F2 is Menu; the handset has Commodore C= instead, and C= is unbound. | Remove F2 from the handset model. Right Soft Key is Menu; once its event is verified, C= opens Search, with `7` retained as fallback. |
| “Back” and “menu key” do not identify pictured keys.                             | F1/Left Soft Key is Back; F3/Right Soft Key is Menu; Star alone toggles C64/View.                                                     |
| `8` and `9` app commands exist but are absent from the manual shortcut table.    | Document `8` C64 pause/resume and confirmed-only `9` reset.                                                                           |
| Game Mode's Pound overlay is mainly quick keys and stream switches.              | It also exposes keypad-operable Exit Game Mode and Close Remote Input recovery actions.                                               |
| Context guards are distributed and the Game overlay can compete with C64 relay.  | One precedence stack gives each press and its release exactly one owner.                                                              |
| View/control transitions do not state a release contract.                        | Every ownership transition releases all held C64 input before switching.                                                              |
| A held global command can follow OS key repeat.                                  | Digits, soft/call keys, F1, Commodore C=, and F3 issue at most one app command per physical press.                                    |

## Hardware verification still required

| Physical key                                         | Expected event or observation                                                                              | Context                                                                 | Pass condition                                                                                                                         |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Left Soft Key, Right Soft Key                        | Key Explorer records distinct key-down identities; a temporary diagnostic also observes key-up and repeat. | Normal page and open dialog through the target OS compatibility layer.  | Both reach the app without an OS action, with stable identities that can be mapped separately.                                         |
| Send/Call                                            | A distinct key-down reaches the WebView; key-up is observable.                                             | Normal page and Remote Input.                                           | The event is delivered without opening the dialler or changing app visibility.                                                         |
| End Call                                             | Determine whether the OS intercepts, backgrounds, terminates, or forwards it.                              | Normal page and while a Game Mode direction is held.                    | The OS outcome and any lifecycle callback are recorded; no forwarded event is duplicated after interception.                           |
| Commodore C=                                         | Key Explorer records its exact identity.                                                                   | Normal page, text field, dialog, and Game Mode.                         | One stable identity reaches the app without an OS shortcut intercepting it.                                                            |
| F1 and F3                                            | Confirm the physical keys emit identities the app can distinguish; observe repeat and key-up.              | Normal page, text field, dialog, blue C64 control, and View adjustment. | Each reaches its labelled app action outside C64 control; in blue C64 control, key-down/key-up produces exactly one C64 press/release. |
| D-pad, D-pad Centre/OK, 0–9, Star (`*`), Pound (`#`) | Record exact key-down/key-up identities and test keypad rollover for two simultaneous direction keys.      | Key Explorer, T9, Game Mode, and View.                                  | Presses and releases are distinct and reliable; the rollover result is documented without assuming simultaneous-key support.           |
