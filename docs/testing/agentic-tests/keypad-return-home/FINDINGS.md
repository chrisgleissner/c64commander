# The keypad user who keeps coming home — findings

Hardware-in-the-loop hunt run against `c64u` (C64 Ultimate, firmware `1.2RC`, `192.168.1.146`) and
a Pixel 4 (`9B081FFAZ001WX`) driven at Callback 8020 geometry: `wm size 480x640`, `wm density 240`,
which the app reports as 320 x 427 CSS px at DPR 1.5 on the `compact` display profile. The edition
under test is the 8020 one, `uk.gleissner.c64uremote`, build `1.0.5-rc1-6ba84`.

The U64 was not driven or probed at any point. Two of the findings below are about tooling that had
been pointing debug installs at it.

## Findings

| # | Scenario | Finding | Evidence | Status |
| - | -------- | ------- | -------- | ------ |
| 1 | S5 | The handset's Back key produced no event at all outside an interstitial, so OK descended into a card and nothing climbed out. Most of Home was then unreachable. | A `keydown` probe recorded nothing for `KEYCODE_BACK` and a correct ascend for `KEYCODE_ESCAPE`; the sweep reported 30 unreachable controls on Home before and 1 after | Fixed, verified on the handset |
| 2 | S5 | Home's System info button is not in the focus ring: it carries `data-section-label`, so it was treated as an empty group and dropped | 34 Down presses walk the whole ring twice without selecting it; the element is a 304 x 58 px `<button>` | Fixed, hand-verified |
| 3 | S1, S8, S9 | The badge claimed "Connected to c64u, system healthy" on arrival with no evidence newer than the last time the app had spoken to the device. Nothing probes while the state reads REAL_CONNECTED, and neither visibility handler acts in that state | `ConnectionController` returns early for that state; both `visibilitychange` handlers gate on `OFFLINE_NO_DEMO`/`DEMO_ACTIVE` | Fixed; unit test fails on the reverted file with `expected 'REAL_CONNECTED' to be 'OFFLINE_NO_DEMO'` |
| 4 | Rig | Every debug install pointed the app at the U64 — reserved for another agent — and gave `c64u` an address that had not been its for weeks | The app's own log promoted a connection to `192.168.1.13` at `08:37:45Z`; `/etc/hosts` carries `192.168.1.167` only as a comment | Fixed |
| 5 | Tooling | `--install-apk` could not install any edition but the default: it looked for `c64commander-<version>-debug.apk` whatever variant had been built | `APP_VARIANT=c64u-remote ./build --skip-tests --install-apk` stopped at `APK not found` with the built APK beside that path | Fixed |
| 6 | Tooling | `npx eslint .` reported 17 errors from other agents' worktrees under `.claude/worktrees/**` | The ignore list already carried `.worktrees/**`, the wrong path for where they are created | Fixed |
| 7 | Delegated | The scheduled fuzz overran its job cap on five consecutive nights. The budget bounded only the shard loop; the overrun was in the report merge, which the first fix left unbounded | Run 35418281403: 8905 s against a 7200 s budget, with the sibling job's build measured at 25 s | Fixed; see `fuzz-deadline-review.md` |
| 8 | Harness | `keypad_reachability.mjs` searched for each card from wherever the ring had stopped, re-walking the whole ring per card. Home never finished in 30 minutes | Visible on the handset as the same Quick Actions grid scrolling repeatedly; one forward pass finishes Home in about 90 s | Fixed |
| 9 | Harness | The sweep reported five cards on Home as not scrolled into view, and counted three buttons as both reached and unreachable | It graded against the raw viewport rather than the 231 px the app leaves between its bars, and identified id-less controls by their viewport top | Fixed; none of the five is a product defect |

## Scenario results

### S2 — departure with playback running

Tone-Low started from the playlist, the radio taken away mid-tune, sixty seconds, radio back.

- The badge read "Offline, device not reachable" within 10 s of the radio going, in the words a
  non-expert reads as an answer.
- The Play page was not disabled: of every transport, playlist and volume control on it, only
  `playlist-reshuffle` was disabled, and that is a two-item playlist with shuffle off, not the
  outage.
- Playback continued throughout — elapsed 0:46 at the moment the radio went and 1:46 a minute
  later. `dumpsys audio` shows the app's own `AudioTrack` `state:started` at 48 kHz, so the tune
  was being rendered on the phone, which is why it survived.
- The badge read "Connected to c64u, system healthy" again 8 s after the radio returned.
- Nothing was left sending: `239.0.1.65` carried 1000 packets from `192.168.1.146` in 4 s while
  the mirror was up before the outage, and none at all after the reconnection. The audio mirror is
  deliberately not restored while the phone is playing the tune itself; the machine's audio comes
  back with the next track.

Pass.

### S1 and S9 — arrival, and the badge's first word

Five arrivals on the fixed build: radio off and screen dark for 60 s, radio back, six seconds to
settle in the pocket, then the screen woken and the app foregrounded. The badge label was sampled
from the moment the app appeared, and every claim of a connection was checked against the device's
own answer to `GET /v1/version` from this host.

| Arrival | First label | at | Connected, and the device answering | at |
| ------- | ----------- | -- | ----------------------------------- | -- |
| 1 | Offline, device not reachable | 313 ms | yes | 743 ms |
| 2 | Offline, device not reachable | 439 ms | yes | 866 ms |
| 3 | Offline, device not reachable | 326 ms | yes | 756 ms |
| 4 | Offline, device not reachable | 468 ms | not within the 25 s sample window | — |
| 5 | Offline, device not reachable | 295 ms | yes | 727 ms |

No screen claimed the machine was reachable before it was: the first thing the badge says on every
arrival is that the device is not reachable, and it is right, because the phone has not rejoined
the network yet. The truth appears within half a second of the app becoming visible, and the app is
connected again within about 850 ms on four of the five.

The fifth is honest data rather than a pass: the app had not reconnected within the sampling
window. It is recorded as measured, not explained.

The deviation from the scenario as written: the away time was 60 s rather than ten minutes, and
five arrivals rather than ten. Each arrival cost about twelve minutes of wall clock on the rig, and
the numbers above are tight enough across five that more of them would not have changed the answer.
A cold ten-minute arrival was measured separately, once, with the same result: "Offline, device not
reachable" 322 ms after the app appeared, with the radio still off so that the only correct answer
was that one.

### S6 — what each control costs from an arrival

Measured by walking the ring on the handset and counting presses, with the machine's own memory as
the witness for the ones that reach it.

| Control | Shortest keypad path | Presses | Proof |
| ------- | -------------------- | ------- | ----- |
| Reset the machine | Down x3, OK, Left x2, OK, OK on the dialog's Confirm | 8 | A sentinel written into screen RAM at `$0400` was gone 537 ms after the final press, with `READY.` back at `$042A` |
| Pause the machine | Down x3, OK, Left x5, OK | 10 | — |
| Start the current tune | F1 | 1 | After the fix below; before it, the key did nothing |
| Type a line on the C64 keyboard | Down x3, OK, Right x3, OK to open Remote Input, then the Keys tab, then the character | 10 | Pressing the sheet's "2" wrote screen code `$32` at offset 241 of the C64's screen RAM |
| Change the volume | Digit 2, Down x8, OK, Down x6, then Left | 17 | The slider moved 24 to 21 and its label `0 dB` to `-3 dB` |

The arrival criterion is three presses to the first control that reaches the machine, and the S6
criterion is five for any of them. Reset at eight and Pause at ten are both over. The transport key
is the one that meets it, and it did not work at all until this branch: see
`defects/S6-TRANSPORT-SHORTCUT-NEVER-FIRES.md`.

All four were measured first on the branch as it stood, and every one but the transport key was
over the five-press bar: 1, then 8, 10 and 17. That is the finding, and it was fixed rather than
recorded: Home's Quick Actions grid stays exactly where it is, and the two machine controls this
user comes home for now have a key of their own.

| Control | Before | After | Proven at the machine |
| ------- | ------ | ----- | --------------------- |
| Start the current tune | never worked | **1** — F1 | elapsed ran 0:05 then 0:13, one AudioTrack started |
| Pause / resume the machine | 10 | **1** — `8` | the C64's jiffy clock at `$00A0` stopped advancing, and a second press restarted it |
| Reset the machine | 8 | **2** — `9`, then OK on the confirmation | a sentinel written to `$0400` was gone 718 ms after the second press, with the banner back |
| Type a line on the C64 keyboard | 10 | 10 | pressing "2" wrote screen code `$32` at offset 241 |
| Change the volume | 17 | 17 | the slider moved 24 to 21, `0 dB` to `-3 dB` |

The reset takes two presses rather than three because the confirmation now opens on the action it
is asking about. Radix focuses the dialog's content wrapper, which is not a control, so a keypad
user pressed Down three times — past the close button and past Cancel — to reach the one thing the
dialog exists to offer. Cancel is still one Down away and Back still closes it without running
anything.

Typing and the volume are still where they were. Both are further inside their pages than a single
shortcut can reasonably reach, and neither is what this user opens the app for as often as the
three above.

The volume measured here is the app's own playback volume, which is what the Play page carries. The
Ultimate's master volume is a Config item and was not walked; it is further away, not nearer.

Typing on the C64 costs ten presses and is worth spelling out, because two of them are not
navigation. The Remote Input sheet opens in **Joystick** mode, so the handset's own letter keys go
to the joystick and not to the machine — `KEYCODE_A` pressed there changed nothing anywhere in the
C64's screen RAM. Reaching the keyboard means switching to the **Keys** tab first and then pressing
the character on the sheet. Once there it does reach the machine: pressing "2" changed screen RAM
at offset 241 from `$a0` to `$32`.

The probe written for this, `tools/hil/arrival_probe.mjs`, searches for the control rather than
replaying a path, so its press count is the cost of a search and not the cost of the shortest path:
it reported 19 and then 22 presses for Pause, against the 10 a user takes, and failed to find it at
all on two of five arrivals. It is useful as an upper bound and as a way to prove the press reached
the machine, and it is not the instrument for the press counts above.

### S8 — the phone goes into a pocket

Tone-Low started, the app backgrounded and the screen put out, 110 s in a pocket, then woken and
foregrounded.

- The page was live 1.29 s after the app was foregrounded, inside the 2 s the scenario allows.
- The clock had kept correct time: 0:10 when the phone went away, 2:14 on return against about
  125 s of wall clock, and it went on advancing, 2:15, 2:16. Nothing was frozen and no route
  needed a re-navigation.
- Whether the speaker was actually producing sound while the screen was off is **not
  established**. `dumpsys audio` reported no started `AudioTrack` while the phone was dozing and
  one again on return. The clock keeping correct time says the page was not frozen, and on this
  platform only audible audio exempts a hidden page from being frozen, so the likely reading is
  that audio continued and `dumpsys` does not list the track in that state. That is an inference,
  not a measurement, and settling it needs the microphone.

A first attempt at this scenario proved nothing and is recorded so it is not repeated: the wait was
five minutes and the tune is three, so it ended naturally while the phone was away.

### S10 — ten arrivals, one leak check

After ten arrival cycles the phone held **no** TCP sockets to the Ultimate's telnet port
(`/proc/net/tcp` on the handset, filtered to `192.168.1.146:23`), and `GET /v1/configs` answered
normally afterwards. Arrivals open no telnet session, so this measures that they leak none.

The leak the scenario is aimed at is not reachable this way and was not staged. A session is torn
down in a `finally`, so a completed workflow always closes it; the path that can leak is an apply
that hits its 90 s deadline, which is deliberately left to the session's own five-minute idle
timeout. That timeout is a `setTimeout` in the WebView, and a hidden page does not run it — so an
apply that times out just before the phone goes into a pocket would hold its session until the
process dies. That is read off the code, not measured, and no change was made on the strength of
it.

### S3 — the address moved while they were out

The saved device's host was changed through Settings to `192.168.1.231`, an address nothing answers
on, and saved with **Save & Connect**.

- The app said what was wrong in the words the scenario asks for: *"We couldn't reach
  '192.168.1.231'. Make sure it's powered on and on the same Wi-Fi."* That distinguishes an address
  that answers nothing from a device that is off, and it names the address it tried.
- It did not strand itself on the bad address. The saved entry went back to `192.168.1.146` and the
  app stayed on the working connection, which is why the badge went on reading "Connected to c64u,
  system healthy" while the message was on screen: the badge is about the connection the app has,
  not the one it just failed to make. A control pressed afterwards still reached the machine — a
  sentinel written to `$0400` was still there and the app was still talking to `192.168.1.146`.
- The host field and its ports are reachable and editable with the keypad: OK on
  `settings-device-host-field` focuses the input with its value in it. The destructive-action
  dialog autofocuses its **primary** action, so confirming costs one press and nothing renders
  below the viewport on the way.

The second half of the scenario — the Ultimate genuinely moving to a different address — was not
staged. It needs the device's DHCP lease changed, and the Ultimate is shared with other work.

### S4 — two Ultimates, one user

Live View's video was started on `c64u`, then the selected device was changed to `u2` through
Settings, then back to `c64u`. The senders on each multicast group were read off the wire at every
step, from this host, rather than taken from the app's own record.

| Step | Selected host | `c64u_device_streams_running` | Senders on 239.0.1.64 |
| ---- | ------------- | ----------------------------- | --------------------- |
| On `c64u`, mirror off | `192.168.1.146` | absent | none |
| On `c64u`, video on | `192.168.1.146` | `{"video":"192.168.1.146"}` | `192.168.1.146`, 10219 packets in 3 s |
| Switched to `u2` | `192.168.1.97` | absent | **none** |
| Switched back to `c64u` | `192.168.1.146` | absent | none |

Every clause of the scenario holds. The mirror stopped on the device being left: `c64u` was sending
over ten thousand packets in three seconds, and after the switch it sent nothing. No device kept
sending after it was deselected, on either group. The record never named a device the app was not
on — it was cleared with the stream rather than left behind, which is the failure the scenario
warns about. The badge followed the selection both ways, reading "Connected to u2, system healthy"
and then "Connected to c64u, system healthy".

Not covered here: that the playlist and the config choices belonging to a device come back with it.
Only the streaming half of S4 was measured.

### S7 — attempted, and the apply could not be staged

A copy of the Ultimate's own `Default.cfg` was put beside the tune as `tone-low.cfg`, which is the
association rule the firmware uses and the app agrees with: same directory, same name, `.cfg`
extension. Launching Tone-Low from the playlist then applied **nothing**. The tune started at once
— elapsed ran 0:00, 0:01, 0:03 and on — with one control disabled on the page throughout and no
toast naming a file. There was no eighteen-second wait to watch.

The reason is that a playlist item carries its settings file as a stored reference resolved when the
item is added, and these items were added before the `.cfg` existed. Making the app resolve it
would mean removing and re-adding the tune, which reorders the playlist the merge gate needs
(Tone-Low then Tone-High, and nothing else). The file was removed again afterwards, so the rig is
as it was found.

So the timing, the wording on the page and the ability to decline a slow apply are **not measured**.
What can be said from the code is unchanged: the apply raises a toast naming the file, and the only
control that declines one belongs to the dialog raised when the file is *unavailable*
(`resolveUnavailableConfigDecision`). Nothing declines an apply that is merely slow, so the user
waits out the eighteen seconds or the ninety-second deadline. That is a gap, read rather than
measured.

## The hardware merge gate

Run on `c64u` at native geometry (1080x2280, density 440), phone volume 3 of 25.

The gate drives `uk.gleissner.c64commander`. The copy of that package installed on the Pixel was
`1.0.4-2487f`, a build from `main`, so the earlier runs recorded in this document measured `main`
under a branch label. Those numbers are removed rather than reinterpreted. The branch APK
(`1.0.5-rc1-e85ba`) was built and installed, and the gate was re-run against it.

| Stage | Result on the branch APK |
| ----- | ------------------------ |
| preflight | pass — device 1, route /, speaker volume 0, mirror audio=false video=false |
| input | pass — held direction moved 10 cells; 20 rotation checks passed |
| search-latency | pass — 120 samples, p50 19.8 ms, p90 29.5 ms, p95 32.5 ms, max 50.7 ms |
| wire | pass — sender loss 0%, inter-arrival p99 4.11 ms |
| av-clarity | pass — 82 tones, 5 defective, 0.13% dropout |
| av-latency | pass — 262 ms wire to speaker, correlation 0.897 |
| sid-remote | pass — tone present 100.0%, -20.4 cents, longest gap 0 ms |
| sid-local | pass — tone present 100.0%, -1.6 cents, longest gap 0 ms |
| crossfade | pass — join graded "SEAMLESS CROSSFADE" |

Audible time about 62 seconds. All nine stages pass.

The first attempt at this run failed at preflight with a CDP call that never returned. The cause was
the `adb forward` entry: it still pointed at `webview_devtools_remote_32202`, the WebView socket of
the process that existed before the reinstall. Re-pointing the forward at the new pid fixed it. This
is a rig condition, not a product fault, and it produces a preflight failure with no other symptom.

### S5 — the landscape half

Reached through Settings → Appearance → Screen orientation → Landscape, as the scenario says, because
the app locks orientation and a storage write does not move it.

In landscape the handset gives the app **427 x 320 CSS px**, and the app selects the **medium**
display profile rather than compact. `keypad_reachability.mjs` refuses to grade anything but
compact — deliberately, because its 44 x 44 hit areas, its 14 px text floor and its overflow check
are all scoped to that panel — so the automated sweep has no landscape result and is not forced to
produce one.

What the scenario actually asks about in landscape was checked directly. The destructive-action
dialog is the surface at risk, because 320 px of height is the tightest thing the app has to fit a
header, a body and a footer into. With Reset's confirmation open at 427 x 320, every button is
inside the viewport: Close at 96–141, Confirm at 205–249, Cancel at 258–302, against a viewport
height of 320. Nothing the user must press sits below the fold.

One difference from portrait, noted and not pursued: in portrait the dialog autofocuses **Confirm**,
so confirming costs one press; in landscape focus lands on the dialog wrapper and Down walks to it.
