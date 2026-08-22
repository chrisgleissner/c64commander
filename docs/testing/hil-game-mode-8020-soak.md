# Game Mode HIL soak — Callback 8020

Hardware-in-the-loop soak of Game Mode, run against `refactor/internal-structure` @ 1db2e0e6.
The two defects it found have their own notes:

- [S2-GAMEMODE-8020-LANDSCAPE-CONNECT-UNREACHABLE](agentic-tests/full-cta-coverage/defects/S2-GAMEMODE-8020-LANDSCAPE-CONNECT-UNREACHABLE.md)
- [S3-GAMEMODE-8020-JOYSTICK-SHOWN-WITH-NO-PICTURE](agentic-tests/full-cta-coverage/defects/S3-GAMEMODE-8020-JOYSTICK-SHOWN-WITH-NO-PICTURE.md)

Target: Game Mode must work flawlessly for a keypad-only Callback 8020 user who does not know the
app, presses wrong buttons and abuses them. They must never be lost; the app must stay graceful,
supportive and intuitive.

Rig: Pixel 4 (9B081FFAZ001WX). App built from `refactor/internal-structure` @ 1db2e0e6,
version 0.9.9-rc2-1db2e.

## Device allocation (agreed with session 1541ultimate-15, user-approved)

- **c64u 192.168.1.148 + the u2: theirs, permanently.** The U2+L has no keyboard or video of its
  own (machine:input returns HTTP 501), so it can only be driven through the c64u it is plugged
  into. There is no "u2 alone".
- **u64 192.168.1.15: mine**, once their in-flight run finishes. Verified live at 11:2x that they
  really were running on both (PIDs 2880301 u64, 2890612 u2@c64u, plus an ESTABLISHED telnet socket
  to 192.168.1.15:23).
- On resume: check c64u **Cartridge Preference** — their tests need it set to `External`.
- Their suites run over **telnet**; this firmware has a documented 4-session cap with a half-open
  leak, so avoid piling telnet sessions on while they work.

## Configurations

| #   | Edition            | Screen         | CSS     | Profile | Keys      | Orientation |
| --- | ------------------ | -------------- | ------- | ------- | --------- | ----------- |
| A   | c64commander       | 1080x2280 @440 | 393x799 | medium  | classicT9 | portrait    |
| B   | c64commander       | landscape      | —       | —       | classicT9 | landscape   |
| C   | c64u-remote (8020) | 480x640 @240   | 320x427 | compact | diamond8  | portrait    |
| D   | c64u-remote (8020) | 640x480 @240   | 427x320 | compact | diamond8  | landscape   |

8020 variant defaults: `default_game_mode_on_launch: true`, `default_game_mode_joystick: hidden`,
`default_joystick_key_layout: diamond8`, `default_display_profile: compact`, full-screen.

diamond8: 5=up, 7=left, 9=right, 0=down, 8=fire. classicT9: 2=up, 4=left, 6=right, 8=down, 5=fire.

## Findings

| ID  | Cfg   | Severity              | Finding                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Status                      |
| --- | ----- | --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| F1  | A, C  | works                 | Auto Game Mode on `.prg` launch works — the fix in this branch. Verified on both editions and via BOTH user-initiated launch paths (picker "Play" confirm, playlist row play button).                                                                                                                                                                                                                                                                                                                                                    | confirmed                   |
| F2  | A     | works                 | Injected physical keys reach the C64. KEYCODE_2 (classicT9 up) filled the UP arrow on PORT 2 in joyride-c64.prg's own display: key → app → machine:input → CIA1 → C64 program.                                                                                                                                                                                                                                                                                                                                                           | confirmed                   |
| F3  | A     | info                  | fps falls to ~10 under sustained key hammering, recovers to ~48 within 15 s. Documented input-priority behaviour, not a leak.                                                                                                                                                                                                                                                                                                                                                                                                            | measured                    |
| F4  | A     | not a defect          | One navigation to Docs during rapid long-presses. 20 further repetitions of the identical trio + 6 single-key attempts: 0 reproductions.                                                                                                                                                                                                                                                                                                                                                                                                 | closed                      |
| F5  | **C** | **real, open**        | On the 8020, Game Mode with the picture off shows a **full-screen on-screen joystick the device cannot operate**, and nothing else. `resolveJoystickVisibility` opens with `if (!videoLive) return "visible"`, overriding an explicit `hidden`. The variant ships `hidden` precisely because that handset has no touchscreen. Proven both ways: mirror off → dead joystick, no picture; mirror on → picture fills the sheet, joystick correctly hidden.                                                                                  | **needs a design decision** |
| F6  | C     | my error              | I first read a zoomed stage as a "collapsed canvas". Wrong: viewport was legitimately zoomed 2.424x, the corner thumbnail was the **minimap**, cx=0.580 is inside the clamp range [0.206, 0.794], transform maths correct. Not persisted (starts FIT_VIEWPORT); a keypad user cannot zoom. No risk.                                                                                                                                                                                                                                      | closed                      |
| F7  | C     | works                 | 19 wrong/unbound keys sent one at a time in Game Mode (unmapped digits, `*`, `#`, all d-pad directions, centre, ENTER, MENU, SEARCH, CLEAR, DEL, both volume keys). Every one: Game Mode intact, route stable, guidance bar present, 45–51 fps.                                                                                                                                                                                                                                                                                          | confirmed                   |
| F8  | C     | minor                 | 10 consecutive BACK presses never strand the user and never exit the app; settles on Home. But press 3 goes Home → Play (forward, not back) — a history-stack bounce.                                                                                                                                                                                                                                                                                                                                                                    | observation                 |
| F9  | C     | closed, unreproduced  | After 200 random keys the Play page rendered **completely blank** once — tab bar and guidance only, textLen 64 vs ~2000 healthy, focusables 6 vs ~50. It recovered on any tab press. Reproduction attempts: 10 rounds of rapid page-jumping, then **20 full rounds of the identical 200-key mash from a Game Mode launch** (5 on c64u, 15 on u64). **0 reproductions.** Closed under the standing bar of ~20 repetitions. Recorded as seen-once-never-forced, not as never-happened.                                                     | closed                      |
| F10 | C     | works                 | Stream integrity, 27 s on the 8020: audio 0 dropped / 0 concealed / 0 underruns; video 8 lost packets, **0 lost frames**, 4 partial; 0 A/V sync pops; 100% effective rate at 51 fps; pipeline residence P99 13 ms. Cross-checks the split Audio/Video loss counters the manual documents.                                                                                                                                                                                                                                                | confirmed healthy           |
| F11 | D     | resolved              | Landscape initially unreachable — the app locks portrait via `ScreenOrientation.lock`; a localStorage write does not move it. Reached via Settings → Appearance → Landscape.                                                                                                                                                                                                                                                                                                                                                             | resolved                    |
| F12 | **D** | **BLOCKING for 8020** | **In landscape (427x320) the discovery dialog's primary action is unreachable.** Content is 363 px in a 320 px viewport; **"Connect" renders at y=285–329, off-screen**; only "Not now" (dismiss) is visible. 8×DPAD_DOWN never leaves "Not now"; up/left/right → "Close"; Tab reaches the host input at y=178, also `visible:false`, and focus does **not** scroll it into view. A keypad-only user types into a field they cannot see and can never reach Connect — **first-run setup is impossible**. I had to click Connect via CDP. | **open, verified**          |
| F13 | C     | scoping F12           | The focus ring is not generally broken: 22 focus steps down Settings left only one element "off-screen", and that was a section container taller than the viewport, not a stranded control. F12 is specific to that dialog's footer button. Portrait very likely unaffected (363 px content fits 427 px) — inferred from the measurement, not separately observed, since the dialog stops appearing once a device is saved.                                                                                                              | analysed                    |
| F14 | C     | works                 | Orientation is recoverable in-app: Settings → Appearance → Portrait restored 320x427 cleanly.                                                                                                                                                                                                                                                                                                                                                                                                                                            | confirmed                   |
| F15 | C/D   | works                 | The variant pins `default_display_profile: compact`, so the 8020 stays compact at 16 px root in BOTH orientations. My guess that 427 px would flip it to medium was wrong.                                                                                                                                                                                                                                                                                                                                                               | confirmed                   |
| F16 | C     | works                 | With no network the app degrades well — a clear "No C64 found" prompt with a host/IP field, not a blank or stuck screen.                                                                                                                                                                                                                                                                                                                                                                                                                 | confirmed                   |

### Note on F5

`if (!videoLive) return "visible"` is deliberate and unit-tested: "Hiding it with no picture to give
the space to would empty the sheet: no controls, and nothing in the space they used to occupy."
Sound for a touchscreen; wrong for the 8020, where the joystick is not a control because nobody can
touch it. Reordering the rule merely trades a dead joystick for an empty sheet. A real fix needs a
third input — whether the joystick is _operable_ here — plus something useful in that space (e.g.
"the picture is off; press X to turn it on"). That is a design change to a tested decision, so it is
the user's call, not something to fold silently into a refactor branch.

## Still to do

2. **F12** — confirm portrait is unaffected by clearing saved devices to bring the dialog back.
3. **S2 on u64** — re-verify diamond8 steering against the C64's own display.
4. Game Mode screen-real-estate assessment in landscape (S7) with video live.
