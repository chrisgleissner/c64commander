# S3-GAMEMODE-8020-JOYSTICK-SHOWN-WITH-NO-PICTURE — Game Mode fills a keypad handset's screen with a joystick it cannot operate

- ID: S3-GAMEMODE-8020-JOYSTICK-SHOWN-WITH-NO-PICTURE
- Title: With the picture off, Game Mode shows the on-screen joystick even where the setting says hidden
- Severity: S3 — nothing breaks, but the screen carries nothing the user can act on
- Priority: P2
- Product area: Remote Input / Game Mode
- Route: Play → Game Mode (also reachable from Home and the `0` key)
- Overlay/dialog: `RemoteInputSheet`
- Input method: injected physical key events, no touch
- Build identity: `0.9.9-rc2-1db2e` (c64u-remote edition, debug)
- Git SHA: `1db2e0e6`
- Pixel 4 identity: `9B081FFAZ001WX`, emulating the Callback 8020 at 480x640 @240 dpi (320x427 CSS)
- Reproduction rate: 1/1, deterministic
- Preconditions: C64U Remote edition; Live View "Watch" off (the remembered state); launch a `.prg`
  so Game Mode opens by itself.

## What happens

Game Mode opens and the whole screen is an on-screen joystick and a FIRE button, with no C64
picture. The Callback 8020 has no touchscreen, so **none of it can be operated**. There is nothing
else on the screen.

The variant ships `default_game_mode_joystick: hidden` for exactly this reason. From
`variants/variants.yaml`:

> This handset has no touchscreen, so the on-screen joystick is a control nobody there can reach.
> Game Mode gives its space to the live picture from the start.

The setting is not being honoured. `resolveJoystickVisibility` in
`src/lib/remoteInput/gameModeJoystick.ts` opens with:

```ts
if (!videoLive) return "visible";
if (requested !== null) return requested;
if (setting !== "auto") return setting;
return keyDriven ? "hidden" : "visible";
```

The first line wins over an explicit `hidden`.

Proven both ways on the device:

- Live View "Watch" **off** → Game Mode shows the joystick full-screen, no picture.
- Live View "Watch" **on** → the picture fills the sheet and the joystick is correctly hidden.

This matters more than it used to, because Game Mode now opens **by itself** when a game is
launched (that setting is on by default in this edition), so the state is reached without the user
ever choosing it.

## Why this is not simply a bug to invert

The `!videoLive` rule is deliberate and unit-tested. From
`tests/unit/lib/remoteInput/gameModeJoystick.test.ts`:

> Hiding it with no picture to give the space to would empty the sheet: no controls, and nothing in
> the space they used to occupy.

That reasoning is sound on a touchscreen phone, where a visible joystick is at least usable. It does
not hold on a device where the joystick is not a control at all.

So reordering the rule just trades an inoperable joystick for an empty sheet. A real fix needs a
third input — whether the on-screen joystick is _operable on this device_ — and something useful to
put in that space when it is not. The obvious candidate is a short line saying the picture is off and
which key turns it on, which is both supportive and actionable on a keypad.

This is a design decision against a tested behaviour, so it is deliberately left for a human rather
than changed inside a refactor branch.

## Verified working alongside it

- Auto Game Mode on `.prg` launch works on this edition (this is the fix in `refactor/internal-structure`).
- With Watch on, the picture fills the sheet, the joystick hides, and the stream is clean: over 27 s,
  audio 0 dropped packets / 0 concealed / 0 underruns; video 8 lost packets but 0 lost frames; 0 A/V
  sync pops; 100% effective rate at 51 fps.
