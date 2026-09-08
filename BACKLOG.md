# Backlog

Work that is agreed but not yet scheduled. Each item says what is wanted, why, and what
would count as done. `PLANS.md` is the Ralph loop's running log and `WORKLOG.md` the record
of what happened; this file is the queue in front of them.

## Thorough hardware-in-the-loop test across the whole bench

**Requested 2026-09-08.** The bench is now fully available: the c64, the u2, the u64 and the
Pixel 4. Until this point the release walkthrough held the phone in flight mode and no real
device could be touched, so every recent proof came from Demo Mode against the app's own
loopback servers. That proves the app works against a simulation of an Ultimate. It does not
prove it works against three real ones.

What is wanted is a full HIL pass with the app on the Pixel 4 talking to the actual devices,
not to Demo Mode.

The bench, read from `/v1/info` on 2026-09-08:

| Host | Product | Firmware | Core | Unique id |
|---|---|---|---|---|
| `c64u` | C64 Ultimate | 1.2RC | 1.4F | 5D0464 |
| `u64` | Ultimate 64 Elite | 3.15 | 1.4F | 38C1BA |
| `u2` | Ultimate II+L | 3.15 | none | F13E69 |

Three different products on two firmware lines, and the II+L reports no core version
at all because it is a cartridge rather than a machine. The config pages are built from
what each device reports, so these three cannot agree, and that disagreement is the
point of testing against all of them. Addresses are DHCP-volatile: re-read `/etc/hosts`
before trusting any of them.

Scope, in the order the risk sits:

- **Connection and identity.** Discovery, saved devices, switching between the u2, the u64
  and the c64 while a session is live. Device switching has its own known failure mode:
  the mirror has to be stopped on the old device before the new one is targeted.
- **Config against real firmware.** The config pages are built from what each device reports,
  and the three devices do not report the same things. Read every category on each, and check
  that writes take effect and that the app never invents an option the firmware does not have.

  `GET /v1/configs` on 2026-09-08 returned 22 categories from the C64 Ultimate, 20 from the
  Ultimate 64 Elite and 13 from the II+L, so "the page renders everything the device reports"
  is a different assertion on each. The differences are not cosmetic:

  - Only the C64 Ultimate has `Speaker Mixer`, `Keyboard Lighting`, and a `SID Socket 1/2:
    ARMSID` pair named after the hardware actually fitted.
  - Only the Ultimate 64 Elite has `Machine Monitor Bookmarks`.
  - The II+L has neither `SID Sockets Configuration` nor `UltiSID Configuration` nor
    `LED Strip Settings` nor `Data Streams`, and it calls its audio category
    `Audio Output Settings` where the other two call theirs `Audio Mixer`.

  A page built from a fixed list rather than from the device would look right on one of these
  and wrong on the other two, which is exactly what this exercise is for.
- **Live View and audio.** Multicast video and audio from a real device, at each display
  profile. Video competing with audio on Wi-Fi is a measured problem, not a hypothesis.
- **Disks and drives.** Mount, swap and unmount against real drives, including the soft IEC
  drive, and the archive and FTP paths that put files on the device.
- **Remote input.** The joystick and the keyboard driving the real CIA matrix.
- **Playback.** Both the device-hosted path and the on-device SID engine, against real
  hardware rather than the loopback library.

Constraints that still apply: the Pixel 4's media volume never goes above 10 of 25; the bench
is shared with other agents, so ask before an install or a gate and never kill another
agent's process; and anything that interrupts a running session on a device is confirmed
first.

Done means: each area exercised against at least one real device, defects recorded with the
evidence that identifies them as app faults rather than firmware or network faults, and a
written statement of what was covered and what was not.

**First pass run 2026-09-08**, results in `docs/hil/2026-09-08-hil-findings.md`. Covered:
connection and identity against all three devices, config completeness against all three
(222, 214 and 148 items, all rendered), Live View from the c64u, and remote input driving the
real keyboard matrix. Not yet covered: disks and drives, playback, and audio through the
speaker. The pass found one high-severity defect, recorded below.

## The II+L is reported unhealthy because the app asks it for categories it never advertised

**Found 2026-09-08 on the bench.** Connecting to the Ultimate II+L shows
"system unhealthy, 4 problems" on a device that is working correctly.

The app requests `/v1/configs/SID Sockets Configuration` and
`/v1/configs/U64 Specific Settings/Palette Definition`. Both return HTTP 404: the II+L is a
cartridge with no SID sockets and no U64-specific hardware, and it advertises 13 categories,
neither of them these. The 404s are then counted as device problems.

The Config page itself is correct — it renders exactly the 13 categories the device reports —
so whatever issues these two requests is working from a different, hardcoded list. That is the
rule this project already holds: config comes from the device, never from a fixed list.

Done means: every config request derives from the category list the connected device returned,
and a 404 for a category the device never advertised never reaches the health count. A II+L on
the bench makes this testable.

## Mount disk raises a source chooser the user did not ask for

**Found 2026-09-08, on the Pixel 4 in Demo Mode.** Tapping a drive's Mount disk
button opens the mount sheet and, on top of it, the "Add items / Choose source"
dialog. One `adb shell input tap` on the button reproduces it with no automation
involved, so it is what a person gets too.

The sheet's own "Add disks" button renders only while the disk collection is
empty (`HomeDiskManager`, `sortedDisks.length === 0`) and it sits in the sheet
header. The sheet animates up to where the finger just was, and the newly mounted
button receives the click that opened the sheet — a click-through, the same class
of problem as a tap landing on an element that appeared under it.

Anyone whose collection is empty meets this on their first attempt to mount a
disk, which is the worst possible audience for it. The release walkthrough now
cancels the dialog to film the sheet behind it
(`c64u-remote-dist/.maestro/showcase.yaml`), which is a workaround in the
recording, not a fix in the app.

Done means: opening the mount sheet leaves the sheet on screen and nothing else,
with a test that fails if the click reaches a control the sheet mounted under the
pointer.
