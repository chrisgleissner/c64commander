# HIL prompt — the keypad user who keeps coming home

A ready-to-execute briefing for a hardware-in-the-loop hunt, the fixes it produces, an adversarial
review of both, and the release of `1.0.5-rc2`.

## Who this is for

One user, and every criterion below is written from their position:

- They hold the 8020-class handset: 480x640 at DPR 1.5, so **320x426.7 CSS px**, no touchscreen, a
  **physical keypad** (arrows, centre, digits, BACK), no Google Play Services.
- They **arrive home and leave again, several times a day**. The phone sleeps in a pocket, drops off
  the home network, rejoins it, and the app is backgrounded for minutes to hours in between.
- When they are at home they want to **do one thing quickly**: start a tune, reset the machine, type
  something on the C64, change the volume. They are not exploring the app; they are using it the way
  someone uses a light switch.

Two failure shapes matter more than anything else for them, and both are about time and certainty:

1. **Arrival.** Between unlocking the phone and the first control that actually reaches the C64,
   how many key presses and how many seconds pass, and does anything on screen ever lie about
   whether the machine is reachable?
2. **Departure.** When they walk away, does the app leave the Ultimate in a clean state, or does it
   leave a stream running, a telnet session half-open, or a config apply in flight?

## Rig and standing constraints

- Devices: **c64u and u2 only.** The U64 is reserved for Software IEC work by another agent and must
  not be driven, including probes. `AGENTS.md` carries the same rule.
- Pixel 4, serial `9B081FFAZ001WX`. Both editions may be installed; `uk.gleissner.c64uremote` is the
  8020 edition and `uk.gleissner.c64commander` is the ordinary one. Stop the one not under test —
  either will hold an AudioTrack and a DevTools socket.
- Audible stages are authorised without asking. Phone volume 3 of 25, never above 10.
- The merge gate needs **native geometry**. If a scenario below sets `wm size`/`wm density`, reset
  both, relaunch the app and re-attach `adb forward` before any gate run.
- `docs/agentic/` is git-ignored, so its helper scripts may be missing in a fresh worktree. Use
  `scripts/bughunt-cdp.mjs` and `droid_input` for everything here.

## Preconditions, every session

Run all of these before the first measurement. Three of the four have produced a full run of
believable-looking nonsense before.

```bash
grep -E "c64u|u2" /etc/hosts                                   # IPs are DHCP-volatile
curl -s -o /dev/null -w "%{http_code} %{time_total}s\n" --max-time 5 http://c64u/v1/version
adb -s 9B081FFAZ001WX shell wm size                            # must be 1080x2280 with no override
adb -s 9B081FFAZ001WX shell dumpsys power | grep -m1 mWakefulness
adb -s 9B081FFAZ001WX shell 'ps -A -o PID,NAME | grep c64'     # stop the edition not under test
```

**The device the app is on is not the device your commands are on.** Read it, do not assume it:

```bash
node scripts/bughunt-cdp.mjs eval '(()=>{const s=JSON.parse(localStorage.getItem("c64u_saved_devices:v1"));
  const d=s.devices.find(x=>x.id===s.selectedDeviceId);
  return JSON.stringify({selected:d&&{host:d.host,name:d.name},
    streams:localStorage.getItem("c64u_device_streams_running")})})()'
```

Then confirm on the wire which Ultimate is actually sending, because the app's own record has been
wrong about this:

```bash
python3 - <<'EOF'
import socket, struct, time, collections
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); s.bind(("", 11001))
s.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP,
             struct.pack("4s4s", socket.inet_aton("239.0.1.65"), socket.inet_aton("<host ip>")))
s.settimeout(3); senders = collections.Counter(); audible = collections.Counter(); end = time.time() + 4
while time.time() < end:
    try: d, a = s.recvfrom(4096)
    except socket.timeout: break
    senders[a[0]] += 1
    if any(d[2:]): audible[a[0]] += 1
print("senders", dict(senders), "with audio", dict(audible))
EOF
```

## Traps already paid for

These were measured on 2026-09-18 and cost most of a session each. Do not rediscover them; use them
as instrumentation.

| Trap                                                                                                            | How it presents                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| The app is selected on one Ultimate while the harness probes another                                            | `input` reports 0 frames held and `av-clarity` reports 0 tone bursts, in the same run       |
| `streams:start` state lives in the firmware until `streams:stop`                                                | A device the app has left keeps sending; two senders in one group corrupt every audio grade |
| `c64u_device_streams_running` can name a device the app is no longer on                                         | The mirror toggle reads "on" while nothing streams from the selected device                 |
| Applying a settings file has no REST endpoint: the app walks the device menu over Telnet, about 18 s end to end | The Play page disables every control while it runs, with a 90 s deadline behind it          |
| The firmware caps Telnet at 4 sessions and leaks half-open ones                                                 | "Too many connections", and config apply stops working until the leak clears                |
| An Android WebView freezes a hidden page after about 60 s                                                       | Timers and workers stop even with a wake lock; only audible audio exempts the page          |
| CapacitorHttp reuses a dead socket pool after the Ultimate reboots                                              | The app reports offline for about 30 s after a reboot that already finished                 |
| A dialog footer button can render below a 320x427 viewport                                                      | A keypad-only user can reach the dismiss action and never the primary one                   |

## Delegated in parallel — the nightly fuzz job times out

Hand this to a subagent at the start of the session. It needs no hardware, so it runs alongside the
HIL work, and its fix ships in the same `1.0.5-rc2`.

The nightly `fuzz` workflow does not finish. Most recent failure:
<https://github.com/chrisgleissner/c64commander/actions/runs/35418281403>, where the job was killed
with "The job has exceeded the maximum execution time of 2h30m0s" and "The operation was canceled."

The measurements from that run, so the subagent does not have to take them again:

| Step                           | Duration              |
| ------------------------------ | --------------------- |
| Everything before the fuzz run | 106 s total           |
| `Run fuzz test`                | **8905 s**, cancelled |
| Teardown, telemetry and upload | 20 s total            |

`.github/workflows/fuzz.yaml` sets `timeout-minutes: 150` on `Fuzz Test (Playwright)` and passes
`--fuzz-time-budget 2h` on the nightly schedule. 2 h is 7200 s, so the run overran its own budget by
**1705 s, about 28 minutes**, and the job cap then killed it. The deterministic job in the same
workflow is healthy: a 5 m budget finished in 305 s.

So the first question is not "is the cap too low" but **why a 2 h budget runs for 2 h 28**. Read
`scripts/run-fuzz.mjs` and establish what the budget actually governs: whether it only gates the
start of new sessions, whether per-session teardown, trace and video processing run outside it, and
whether a retry can begin after the deadline has passed.

Required outcome:

- The time budget is a **deadline for the whole run**, including teardown and artifact writing, not
  a gate on starting new work. A run given 2 h finishes, with its report written, inside 2 h.
- The nightly completes inside the job cap with room to spare, and uploads a classified report.
  Pick the budget from the measured overrun rather than by guessing, and leave a stated margin for
  setup and upload.
- A cancelled or deadline-stopped run still produces `README.md`, `fuzz-issue-summary.md` and
  `fuzz-issue-report.json` for the sessions that did complete. A nightly that dies with no report is
  worth nothing the next morning, which is the state it has been in.
- A unit test covers the deadline: given a budget already exceeded, the runner stops rather than
  starting more work. Prove it fails without the fix.

Do not simply raise `timeout-minutes` and call it fixed. If the cap does need to move after the
overrun is fixed, say why in the PR, with the measured run length behind it.

Secondary, same file, only if it costs nothing: the workflow's `actions/*@v4` steps log Node 20
deprecation warnings and are being forced onto Node 24, and `ubuntu-latest` migrates to Ubuntu 26 on
2026-10-19. Note them; do not let them expand the change.

## Phase 1 — the hunt

Run the scenarios in this order. Each one states what to do, what to measure, and what counts as a
pass. A scenario that cannot be measured is a finding in itself: say so rather than asserting the
behaviour looks right.

### S1 Arrival, cold

The phone has been away from the network for at least ten minutes with the app backgrounded.

Method: turn Wi-Fi off, wait ten minutes with the screen off, turn Wi-Fi on, wake the phone and
foreground the app with the keypad alone. Time from the app becoming visible to the first control
that provably reached the machine — prove it with `machine:readmem` or a register read, not with a
green badge.

Pass: the first machine-reaching control lands within **5 s** and within **3 key presses** from the
app becoming visible, measured over 10 arrivals, and no screen in between claims the machine is
reachable before it is. Report p50 and p95 for both numbers.

### S2 Departure with playback running

Method: start a tune, then take the network away mid-playback (Wi-Fi off). Wait 60 s. Restore.

Pass: the app says what happened in words a non-expert reads as an answer; it does not sit on a
disabled page; on restore, playback either resumes or offers a single-press way to resume. Nothing
is left sending on 239.0.1.64/65 once the app has gone: check with the sender snippet above.

### S3 The address moved while they were out

Method: with the app closed, change the saved entry's host to an address that answers nothing, then
arrive as in S1. Then repeat with the Ultimate genuinely on a different IP.

Pass: the app distinguishes "this address answers nothing" from "this device is off", offers
discovery without typing, and a keypad user can complete the recovery. Watch specifically for a
primary action that renders below the viewport in either orientation.

### S4 Two Ultimates, one user

Method: select c64u, use a control, select u2, use a control, return to c64u. At each step read the
selected host, `c64u_device_streams_running`, and the multicast senders.

Pass: the mirror stops on the device being left **before** the new one is targeted; no device keeps
sending after it is deselected; the playlist and the config choices that belong to a device come
back with it; `c64u_device_streams_running` never names a device the app is not on.

### S5 Keypad reachability at 320x427

Method:

```bash
adb -s 9B081FFAZ001WX shell wm size 480x640 && adb -s 9B081FFAZ001WX shell wm density 240
# relaunch the app, re-attach adb forward, then:
node tools/hil/keypad_reachability.mjs --package uk.gleissner.c64uremote --routes 1,2,3,4,5,6 \
  --out artifacts/keypad-8020.json
```

Then repeat in landscape (`wm size 640x480`), reached through Settings → Appearance, because the app
locks orientation and a localStorage write will not move it.

Pass: the focus ring terminates, every stop is scrolled into view, every dialog's **primary** action
is reachable in both orientations, and nothing that a user must press sits outside the viewport.
Reset `wm size` and `wm density` afterwards.

### S6 Time to a control, measured as a distribution

Method: ten arrivals as in S1, each ending in a different one of: start the current tune, reset the
machine, type a line on the C64 keyboard, change the volume.

Pass: report press count and wall time per control as p50/p95. Any control needing more than 5
presses from a cold arrival is a finding, with the shortest path documented.

### S7 A settings file in a hurry

Method: launch an item whose `.cfg` the app will apply, from a cold arrival, and watch the Play page
throughout.

Pass: the page says what it is doing and roughly how long it will take; the user can decline the
config and launch immediately instead; nothing is silently disabled with no explanation. Measure the
apply end to end and compare against the 18 s baseline and the 90 s deadline.

### S8 The phone goes into a pocket

Method: start playback, background the app, leave it 5 minutes, return.

Pass: audio continues; on return the page is live within 2 s, with no frozen timer, no stale clock
and no route that needs a re-navigation to respond. Check `mWakefulness` before blaming the app.

### S9 The Ultimate rebooted while they were out

Method: reboot the Ultimate, then arrive as in S1 within 30 s of it answering `/v1/version`.

Pass: the app reaches the machine as soon as the device answers the host; an offline claim that
outlives the device's own readiness by more than 5 s is a finding.

### S10 Ten arrivals, one leak check

Method: repeat S1 ten times, then count host-side Telnet sockets and ask the device for its config
once.

```bash
ss -tn "dst 192.168.1.146:23" | tail -n +2 | wc -l
```

Pass: no growth across the ten cycles, and config apply still works at the end.

## Phase 2 — fix what the hunt found

Fix the defects, not the symptom, and not the harness. Two standing rules apply:

- Hiding a bug from the user is not a fix. If a control is unreachable, make it reachable; do not
  remove the message that says it failed.
- Before amending a failing test, ask whether the amended expectation still makes sense to a user.
  If it does not, the production code is what is wrong.

Every fix needs a test that fails without it. Check that by reverting the whole production file, per
commit, rather than the single line the test names.

Then the usual gates, in this order, none skipped:

```bash
npm run typecheck && npx eslint . && npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"
npx vitest run
(cd android && JAVA_HOME=$HOME/.sdkman/candidates/java/21.0.10-amzn ./gradlew :app:testDebugUnitTest)
node scripts/check-file-sizes.mjs
```

A local build rewrites `THIRD_PARTY_NOTICES.md`, `package-lock.json`, `c64scope/package-lock.json`
and the iOS splash PNGs. Revert those before staging, and never `git add -A`.

## Phase 3 — adversarial review

Review the hunt and the fixes together, as an opponent would, and write the review down.

- **Review the subagent's fuzz fix as an opponent too.** Check that the deadline is enforced where
  the overrun actually happened, not somewhere adjacent to it, and that the new budget is justified
  by a measured run length rather than chosen to be safe.
- **Re-measure two findings you did not personally distrust.** The wrong-device trap above produced
  three confident, wrong diagnoses in one run; the only thing that settled it was reading the sender
  address off the wire.
- For every "works" verdict, name the evidence that would have shown a failure, and confirm that
  evidence was actually collected. A stage that cannot fail is not a result.
- For every fix, state what a user does differently now, in one sentence. If that sentence is about
  code rather than about the user, the fix is probably in the wrong place.
- Check the small-screen claims at 320x427 specifically, not at 393 px. The tightest tile track is
  medium at 393 px, so a layout audit that only looks there points at the wrong profile.
- Confirm no finding rests on a subagent's summary alone. Spot-check the artefact it cites.

## Phase 4 — ship 1.0.5-rc2

1. Rebuild and install the branch under test, then run the full hardware merge gate on c64u:

   ```bash
   ./build --skip-tests --install-apk
   git checkout -- THIRD_PARTY_NOTICES.md package-lock.json c64scope/package-lock.json \
     ios/App/App/Assets.xcassets/Splash.imageset/
   node tools/hil/merge_gate.mjs --host c64u --serial 9B081FFAZ001WX
   ```

   The playlist must hold exactly Tone-Low and Tone-High before the run; the playback stages grade a
   known tone and say so rather than grading whatever is queued. `av-clarity` and `sid-remote` are
   each worth one retry with `--only`; more than one retry means something real.

2. Open the PR with the findings table, the measured numbers, and what was not measured. Get CI
   green. `Kilo Code Review` fails on every PR for lack of account credits and is not a signal;
   everything else must pass, including `codecov/patch` at its 94% target.

3. Merge with a merge commit, then tag the merge commit and push:

   ```bash
   git tag 1.0.5-rc2 <merge sha> && git push origin 1.0.5-rc2
   ```

4. Watch the five release workflows to completion and confirm the release carries the APK, the AAB,
   the IPA and the manual PDF.

5. Leave the rig as you found it: mirror off with no sender on the audio group, phone volume back
   where it started, stay-awake off, and the tone playlist in place for the next gate.

## Deliverables

- A findings table in this folder, one row per finding, each with its evidence and its status.
- A defect note per real defect under `docs/testing/agentic-tests/`, following the existing naming.
- Memory entries for any new device-level or rig-level trap, so the next session does not pay for it
  again.
- `1.0.5-rc2`, released, with the hunt's results summarised in the PR description.
