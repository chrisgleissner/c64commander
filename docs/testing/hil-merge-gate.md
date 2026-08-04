# The hardware merge gate

`node tools/hil/merge_gate.mjs` is the set of checks a Pixel 4 and a real Ultimate have to agree
on before a pull request is merged. It exists because every property in it has shipped broken at
least once while CI was green, and because checking them by hand — in a different order, with a
different stimulus, against a memory of the last run — is not a gate.

```bash
# Full run, in someone's room: sets the phone to volume 5, plays only while measuring.
node tools/hil/merge_gate.mjs --host c64u --iface <this host's LAN ip> --json artifacts/hil-gate.json

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

## Reading a failure

The stages are ordered so that the first failure is the most likely cause. In particular: if
`av-clarity` fails but `wire` passed, the Ultimate is sending a clean stream and the fault is in the
link or the app — not in the stimulus, and not in the device. Both facts are in one run, which is
the point of running them together.

## Known result, for comparison

Measured on this rig (Pixel 4 on Wi-Fi, C64 Ultimate fw 1.2.0, host on Ethernet), 2026-08-04:

| Measurement | Video off | Video on |
| --- | --- | --- |
| Sender loss, on the host's link | 0.00% | 0.00% |
| Tone ladder, defective notes | 2 of 82 | 46 of 81 |
| Worst pitch wobble within a note | 3.5 cents | 35 cents |
| Adaptive jitter-buffer target, on the phone | 71 ms | 150 ms |
| Wire → speaker latency | not measured separately | **335 ms** |

The sender is clean either way; the phone's own arrival statistics show 767 lost packets and 1217
gaps over 20 ms across the same session, with a worst gap of 396 ms. So the video multicast and the
audio multicast contend on the Wi-Fi link, the audio loses, the phone's adaptive jitter buffer grows
to cover the gaps, and that growth is most of the end-to-end latency. The app's Live View governor
sheds video when audio starves, but it sheds it at the **receiver** — after the packets have already
crossed the link — so it saves CPU and cannot relieve the contention that caused the loss.
