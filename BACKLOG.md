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

Scope, in the order the risk sits:

- **Connection and identity.** Discovery, saved devices, switching between the u2, the u64
  and the c64 while a session is live. Device switching has its own known failure mode:
  the mirror has to be stopped on the old device before the new one is targeted.
- **Config against real firmware.** The config pages are built from what each device reports,
  and the three devices do not report the same things. Read every category on each, and check
  that writes take effect and that the app never invents an option the firmware does not have.
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
