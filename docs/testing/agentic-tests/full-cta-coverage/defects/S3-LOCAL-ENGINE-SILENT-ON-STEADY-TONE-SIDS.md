# S3-LOCAL-ENGINE-SILENT-ON-STEADY-TONE-SIDS — the on-device engine renders a single held note as silence

- ID: S3-LOCAL-ENGINE-SILENT-ON-STEADY-TONE-SIDS
- Title: "Listen on → Local" plays a steady-tone SID silently while the transport clock advances
- Severity: S3 — no ordinary tune is affected, but the failure is silent and looks like a dead app
- Priority: P2
- Product area: Playback / on-device SID engine
- Route: Play → Listen on → Local
- Build identity: `0.9.9-rc2-76c05` (c64commander edition, debug)
- Git SHA: `76c058b3` (branch `refactor/internal-structure`)
- Rig: Pixel 4 `9B081FFAZ001WX`, Ultimate 64 Elite fw 3.15 at `u64`, room microphone at the phone
- Reproduction rate: 4/4 across four different builds of the stimulus

## What happens

A SID that programs voice 1 once and holds the note plays correctly on the Ultimate and is
**inaudible** when the same tune is played with **Listen on → Local**. The transport says playing
and the elapsed clock advances normally. Nothing is logged: no error, no engine notice, and no
"tune launched on the C64" entry, so the tune really was routed to the on-device engine.

Measured at the phone's speaker with the room microphone, same phone, same volume, same minute:

```
Tone-Low (steady note), Listen on -> Local     peak -75.5 to -80.7 dBFS   tone present 3-7%   (silence)
Tone-Low (steady note), Listen on -> Both      peak -36 dBFS              tone present 100%   (clean)
barcode.sid (multi-note), Listen on -> Local   peak -31.6 dBFS            plays
```

The third line is the control: the on-device engine is working, on this phone, in this session.

## What was ruled out

Four builds of the stimulus, all silent on Local and all correct on the Ultimate:

1. `loadAddress` set in the header, data starting immediately (the generator's own output).
2. `loadAddress` zero with the address embedded in the first two data bytes — the conventional
   PSID form, and the form `barcode.sid` uses.
3. A `play` routine that rewrites the SID registers on every frame, rather than a bare `RTS`.
4. A non-zero attack rate, in case a zero attack with a zero decay left the envelope at zero.

Also ruled out, by direct measurement rather than reasoning:

- **The ROMs are installed.** `c64commander.localEngine.systemRoms.v1` holds a complete set.
- **The on-device engine is enabled.** `c64u_local_engine_enabled` is unset and its default is on.
- **The blob is fetched.** A failed fetch falls through to the C64 and logs "tune launched on the
  C64"; that entry is absent for these plays.
- **The Ultimate's master volume is not involved.** `barcode.sid` played locally at -31.6 dBFS while
  `Audio Mixer / Vol Master` was `OFF`.
- **The phone is audible.** `sid-remote` grades the same tune through the mirror at 100% presence.

## Why it is not fixed here

Nothing on `refactor/internal-structure` touches the playback engine, the native sink or the SID
emulation, and the branch is a refactor plus UI fixes. The remaining difference between a tune that
sounds and one that does not is the shape of the tune itself — one held note against a sequence of
gated notes — which points at envelope handling inside the engine rather than at anything the app
does around it. That is a change to the audio engine and wants its own branch, its own measurements
and its own before/after recordings.

## Effect on the hardware merge gate

`sid-local` and `crossfade` both grade a generated steady tone, so both fail on this. They are the
first runs of those stages to produce a verdict at all — see the gate tooling fixes in the same
commit — so this is not a regression against a previously passing stage. `sid-remote` grades the
same stimulus through the mirror and passes, which is what isolates the fault to the local path.
