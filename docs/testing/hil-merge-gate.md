# The hardware merge gate

`node tools/hil/merge_gate.mjs` is the set of checks a Pixel 4 and a real Ultimate have to agree
on before a pull request is merged. It exists because every property in it has shipped broken at
least once while CI was green, and because checking them by hand — in a different order, with a
different stimulus, against a memory of the last run — is not a gate.

```bash
# Full run, in someone's room: sets the phone to volume 5, plays only while measuring.
node tools/hil/merge_gate.mjs --host c64u --iface <this host's LAN ip> --json artifacts/hil-gate.json

# A password-protected Ultimate. One flag covers the gate and every harness it starts.
node tools/hil/merge_gate.mjs --host c64u --password pwd --iface <this host's LAN ip>

# Everything that makes no sound, for iterating on a non-audio change.
node tools/hil/merge_gate.mjs --quiet-check

# One stage.
node tools/hil/merge_gate.mjs --only input
```

Prerequisites: the branch's APK installed and foregrounded on the attached Pixel, `adb forward`
pointed at its WebView (the `hil-attach` skill), the Ultimate reachable, and a microphone in front
of the phone for the audible stages.

## When it is mandatory

Whenever the user asks to **complete a PR**, **converge a PR**, get something **merge-ready**,
**ship**, or **release**. See `AGENTS.md`, "Hardware merge gate". A PR that changes input relay,
Live View, audio, playback or the streaming pipeline is not merge-ready on green CI alone.

If no rig is attached, say so explicitly in the PR and in the completion summary, and name the
stages that were therefore not run. Do not describe the work as verified.

## The stages

| Stage | What it asserts | Why CI cannot |
| --- | --- | --- |
| `preflight` | Phone attached, Ultimate answering, WebView reachable over CDP, speaker unmuted and at or below the volume ceiling | There is no rig in CI, and every later stage misreads a bad rig as a defect |
| `input` | A held direction keeps moving the C64, and the key-to-direction mapping survives rotation | The assertion is made at the CIA, at the far end of a network relay |
| `wire` | What the Ultimate **sends**, measured on the host's own link: sequence loss and inter-arrival jitter | Rules the network in or out before anything is blamed on the app — the most common wrong turn in this area |
| `av-clarity` | The tone ladder as it leaves the phone's speaker, graded per note for length, pitch, dropouts and correct progression | Needs a microphone in a room and a real speaker |
| `av-latency` | How long a sound takes to get from the Ultimate's wire to the air in front of the phone | Needs the multicast and the microphone captured against one clock |
| `sid-remote` | A SID played by the Ultimate, graded through the phone's speaker | **Not yet wired** |
| `sid-local` | The same tune rendered by the on-device engine, graded the same way | **Not yet wired** |
| `crossfade` | The join between two tunes: seamless, gapped, hard cut or ragged | **Not yet wired** |

The last three are listed by the runner as `pending` rather than omitted, and the summary prints
`NOT YET COVERED` for them. A green run does **not** clear them. Wiring them is tracked work, not
an optional extra: `sid-remote` and `sid-local` reach the speaker through different code and have
sounded materially different before, and a crossfade cannot be settled by listening once.

What each of the three has to do when it is wired:

- **`sid-remote`** — play a known SID on the Ultimate through the app's own Play flow, record the
  speaker, and grade with `mic_playback_quality.py analyse --expect-hz`. The stimulus must be a
  generated tune with a known pitch and cadence (`make_tone_ladder_sid.py`), not music: a listener
  cannot tell a stall from a rest in real music, and neither can a detector.
- **`sid-local`** — the same tune with the on-device engine selected, so the two paths are compared
  under one microphone in one room. `local_vs_mirror_mic.py` already captures that pair.
- **`crossfade`** — two generated tunes holding steady, well-separated tones, recorded across one
  track change and graded by `crossfade_probe.py`, which already classifies the join.

## Audio discipline

This runs next to somebody. The rules are enforced by the runner, not left to judgement:

- The phone is set to **volume 5 of 25** for the run and restored afterwards. The runner **refuses**
  to run above **10**, which is a hard ceiling from `AGENTS.md` and not a tuning parameter.
- Every grader is band-limited to **300–6000 Hz**. The room's noise is almost all below 300 Hz,
  which a phone speaker barely reproduces, so a quiet phone still measures — 27 dB median SNR at
  volume 10 with the microphone at the grille. A broadband reading of the same recording looks
  hopeless and has caused an agent to wrongly conclude the microphone was unusable.
- Each stage plays only for as long as its grader needs, and the C64 is **silenced between stages**
  with `machine:reset` rather than left running. The total audible time is printed at the end so it
  can be argued down.
- The volume is stepped with the hardware key events. `cmd media_session volume --set` reports
  success and leaves a muted stream where it was, which is how a run once played at 11 of 25.
- **The rig is put back the way it was found** — the phone's own volume and its own Listen and
  Watch, captured in `preflight` so `--only` and a mid-run failure restore them too. A mirror left
  running keeps the Ultimate pushing two multicast streams into the room's Wi-Fi, which is exactly
  the traffic the next measurement is trying to characterise.
- A `machine:reset` that fails is reported rather than swallowed: it means the C64 is still making
  a sound, and that the next audible stage is grading on top of it.

## What the gate refuses to grade

`av-clarity` reads its verdict out of `audio_e2e_probe.py`, and the dangerous failure there is a
MISSING number being read as a good one — a probe that dies before its analysis still leaves the
earlier metrics in the output. So the parser is an exported pure function, `gradeClarityOutput`,
and it throws unless the probe printed its `VERDICT` line. It reads both `defective notes N of M`
and the probe's own `defective notes none of M`; an absent line is neither and is refused.

It is deliberately **not** keyed on the probe's exit code: the probe exits non-zero for its own
strict clean/breaking-up verdict, which is a stricter bar than this gate's thresholds, so treating
that as a crash would fail every run that was merely imperfect.

`tests/unit/tools/mergeGateClarity.test.ts` covers those refusals. It is the part of the gate that
can be checked without a rig, which is why it is worth checking.

## Reading a failure

The stages are ordered so that the first failure is the most likely cause. In particular: if
`av-clarity` fails but `wire` passed, the Ultimate is sending a clean stream and the fault is in the
link or the app — not in the stimulus, and not in the device. Both facts are in one run, which is
the point of running them together.

## Known results, and one conclusion that did not survive

Measured on this rig (Pixel 4 on Wi-Fi, C64 Ultimate fw 1.2.0, host on Ethernet), 2026-08-04.

A full run on the shipped build, with the gate setting Listen and Watch itself:

| Stage | Result |
| --- | --- |
| `preflight` | pass |
| `input` | pass — held direction moved 10 cells; 20/20 rotation checks |
| `wire` | pass — sender loss 0.00%, inter-arrival p99 4.18 ms |
| `av-clarity` | pass — 82 tones, 3 defective, 0% dropout |
| `av-latency` | pass — 527 ms wire → speaker, correlation 0.885 |

**Latency varies a lot between runs**: 315 ms, 335 ms and 527 ms on the same rig within an hour.
There is deliberately no threshold on it yet — three samples cannot support one. Collect more
before adding a gate on this number, and do not read a single figure as a regression.

### The failure that was not what it looked like

The first runs of `av-clarity` graded 46 of 81 and then 11 of 82 tones defective, with the picture
on, and the obvious explanation was there in the numbers: the phone's own arrival statistics showed
767 lost packets and 1217 gaps over 20 ms against a sender measured as flawless, and the adaptive
jitter-buffer target sat at 150 ms with the picture on against 71 ms without it. That reads as the
video multicast starving the audio one on the Wi-Fi link, and the audio pipeline learning the
link's burstiness the slow way — by concealing.

It did not hold up. Rebuilding with a faster-converging cushion controller and then **A/B-ing it
against the unmodified build in the same conditions** put both at 0–3 defective of 82, with the
jitter target at its 30 ms minimum, zero underruns and one lost packet. The change was reverted:
it fixed nothing that was measurably broken, and an unproven behaviour change to a carefully
measured audio controller is worse than none.

What had actually differed was the **state the app happened to be in when the stage ran**. The
stage graded whatever Listen and Watch were left on by the previous stage — once, a stopped mirror,
which it reported as a parse failure rather than as silence. `setMirror` now puts both feeds where
the stage needs them from Home, and the grade has been reproducible since.

So the degraded measurements were real, and their cause is **not identified**. What is ruled out:
the sender (clean on Ethernet), the socket buffer (`/proc/net/snmp` `RcvbufErrors` did not move
across a 30 s window with the picture on), and the cushion controller (A/B above). What is not
ruled out: sustained-session degradation — the arrival counters are cumulative from stream start,
and the session that produced 767 lost packets had been running for about an hour across
backgrounding and screen-off, while a freshly started one shows one lost packet over comparable
periods. Start there.

One thing that was not a defect at all: a report of no sound from the phone. `STREAM_MUSIC` was
muted on the device and the C64 was running the joystick probe, which is silent except for a blip
on fire.
