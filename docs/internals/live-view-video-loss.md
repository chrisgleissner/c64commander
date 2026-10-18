# Live View: lost video stream

Issue #516 reported "Video Mirror: no video arrived for long enough to call the stream lost" twice in about three
hours with Watch on, while the Ultimate answered REST. The cause has not been established. This page records what the
app does about it and what to read in the log when it happens again.

## Detection

`StreamArrivalWatchdog` (`src/lib/streams/streamArrivalWatchdog.ts`) is armed when the video mirror goes live. Each
completed frame stamps it. It declares the stream lost after `STREAM_ARRIVAL_TIMEOUT_MS` (8 s) without a frame. A
check that did not run for a whole timeout window (a hidden or frozen WebView) re-stamps instead of reporting, so a
loss reported with `silentMs` near 8.4 s means the timer was running and nothing arrived.

## What is logged when the stream is declared lost

`Video Mirror: no video arrived for long enough to call the stream lost` carries:

| Field            | Meaning                                                                   |
| ---------------- | ------------------------------------------------------------------------- |
| `silentMs`       | Time since the last frame.                                                |
| `liveForMs`      | How long the stream had been live before it stopped.                      |
| `lastFps`        | Presented frame rate in the last second before the stream stopped.        |
| `framesPresented`, `framesLost`, `droppedPackets` | Counters for the session.                |
| `pageHidden`     | Whether the page was hidden at the moment of the report.                  |

A second entry, `Video Mirror: sender filter state after the stream went silent`, reads the native plugin: `senders`
(distinct source addresses seen on the group; two entries is a second sender), `rejectedPackets` and `expectedSource`.
A rate that fell gradually (`lastFps` low) points at Wi-Fi multicast delivery. A stream that stopped at full rate points
at the sender (restart, or a second sender taking over the group). `rejectedPackets > 0` points at the sender filter.

## Restart policy

`StreamLossRestarter` (`src/lib/streams/streamLossRecovery.ts`), owned by `AvMirrorSession`:

- Applies only while Watch is wanted: set by `startVideo()`, cleared by `stopVideo()` and `stopAll()`, which also cancel
  a pending restart.
- At most two restarts per loss episode, after 2 s and then 6 s. A stream that stayed live for 30 s before it was lost
  again earns a fresh set.
- Before restarting, `GET /v1/info` must answer within 3 s. If it does not, the restart is abandoned and the plain
  "The video stream stopped arriving." message stays.
- A hidden page waits for `visibilitychange`; nothing restarts while the WebView is frozen.

## What the user sees

While a restart is pending the video snapshot carries `reconnecting: true` and the error text
"Video lost, reconnecting…". The header badge keeps the screen mark in the warning color
(`data-live-stream="video-reconnecting"`) and the Live View controls show the text in the warning color. Starting the
stream again clears the state.

Listen stopping because another app took the speaker is reported by a toast (audio focus handling in
`AvMirrorSession`), not by this path.

## Measurements (2026-10-17): 30 minutes of Watch on a Pixel 4, no loss

Issue #516 stays open: this run did not reproduce a loss, so it does not establish a cause.

Setup: Pixel 4 (screen on, plugged into USB, app in the foreground on Home, default edition build) with Watch on
against the c64u (192.168.1.146). The phone and the host were on the same LAN. A host script joined 239.0.1.64:11000 on
the Ethernet interface (192.168.1.185) and logged, once per second, the packet count, bytes, the distinct senders and
the number of sequence discontinuities per sender (a step other than +1 on the 16-bit counter). In parallel, a CDP
sampler read every 5 s the Watch button state, `StreamUdp.readStreamDiagnostics({ name: "video" })` and the `Video
Mirror` entries of the in-app log (`c64u_app_logs`). The run lasted 1800 s (360 app samples, 1800 wire samples).

Results:

| Quantity                                   | Value                                                                            |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| Watch button state                         | "Watching" in all 359 samples; page never hidden                                 |
| `Video Mirror` log entries                 | 0 (no loss declared, no restart)                                                 |
| Wire rate from the c64u                    | median 3409 packets/s (about 2.6 MB/s); no second with fewer than 3200 packets   |
| Sequence discontinuities, c64u sender      | 4 single-step gaps in 30 minutes (Ethernet side, one lost packet each)           |
| Seconds with zero packets                  | 0                                                                                |

One event worth recording. In 18 one-second samples between 23:55:25 and 23:56:05 (host clock) a second sender, 192.168.1.13 (the u64), appeared on
the video group at up to 3.4k packets/s on top of the c64u's 3.4k. The wire rate rose to up to 6.8k packets/s and the
combined stream showed up to 59 discontinuities per second, as expected from two interleaved senders. The app's sender
filter (`expectedSource` 192.168.1.146) rejected those packets (`rejectedPackets` rose to 54876,
`senders` listed both addresses) and the picture kept running: no frame gap long enough to trip the 8 s watchdog, no log
entry. So a second sender on the group alone did not cause the loss in this run. The audio group also showed the u64
(1273 rejected packets at the start of the run), which indicates that the u64 had been left streaming by earlier work.
Whoever started the u64 stream was not identified.

What this does not cover:

- Duration. The report in #516 describes two losses in about three hours; 30 minutes is a sixth of that.
- Screen off. The planned 10 minute screen-off run was not done because the time budget went to the battery run for
  #505. Whether the screen-off state (WebView timers frozen, multicast lock behavior) triggers the loss is untested here.
- The Wi-Fi path itself was not measured at the access point. The host sees the Ethernet side only; a loss that happens
  between the access point and the phone (multicast delivery on Wi-Fi) is invisible to this counter. `lastFps` and
  the sender-filter entry that the app now logs on a loss are the evidence to read when it happens again.

## Measurements (2026-10-18): Watch on the keypad phone

Issue #516 stays open. The harness is `tools/hil/watch_soak_hil.mjs`. The keypad phone (compact profile, Wi-Fi, app in
the foreground, c64u on Ethernet) ran Watch for 30 minutes with no host membership of the video group (`--no-wire`).

| Quantity                                      | Value                                                             |
| --------------------------------------------- | ----------------------------------------------------------------- |
| App samples, every 5 s (360)                  | 356 "Watching", 4 "Watch" (lost)                                  |
| Losses declared by the app                    | 4, at 07:24:10, 07:37:47, 07:42:18 and 07:46:48 UTC               |
| Sender filter at the end                      | `rejectedPackets` 0, `senders` listing only the c64u              |

Each loss was logged as "no video arrived for long enough to call the stream lost". The 8 s watchdog fired four times in
30 minutes while Watch was wanted. Whether packets were still arriving at those moments is not known, because the host
was not listening and `readStreamDiagnostics` reports no packet count. This is the evidence the issue was missing: on
this phone the app declared a loss four times, at intervals of 4 to 14 minutes. Whether the stream really stopped
in those moments, or frames stopped assembling while packets arrived, is not shown.

A host that joined the video group changed the result on the same phone. With the host's membership in place, the stream
was lost within about 8 s in three of three runs, and restarts by the app did not help (the loss recurred after each
restart until the attempts were used up). Without the host's membership, six of six start attempts held for at least 24 s, and
the 30 minute run above had four losses declared by the watchdog. The router is the IGMP querier and speaks IGMP version 2. The host sent version 2 reports. What the
phone sends was not captured. This points at multicast delivery on the Wi-Fi leg, not at the app's watchdog, but the
cause is not established. A second Ultimate sending into the group was not retested.

Reading `streamLossRecovery.ts` and `streamArrivalWatchdog.ts`: the watchdog counts a completed frame (native path) or a
datagram (JS path) as an arrival. On the native path, packets that arrive but do not assemble into frames leave the
watchdog without an arrival, so "lost" can be declared while packets still arrive. The recovery restarts at most twice,
2 s and 6 s after the loss, and only a stream that then stays live for 30 s earns new attempts.

## Cause and fix (2026-10-18): the router's multicast membership expired every 270 s

Issue #516. With the new socket packet counter (`receivedPackets`, `msSinceLastPacket` in `readStreamDiagnostics`), the
keypad phone ran Watch for 25 minutes with no host on the video group. The counter rose by about 3400 packets/s and
stopped completely at the losses: `msSinceLastPacket` read 9028 ms and 10735 ms in the two samples that caught a loss
(13:15:56 and 13:35:49 on the host clock), so the packets really stopped arriving at the phone's socket. They were not
arriving and failing to assemble. The counter was also reset by the app's own restart (after the 2 s backoff) at 13:20:31,
13:25:02, 13:26:48 and 13:31:18, where no 5 s sample landed inside the short outage.

The losses are periodic. In this run the stream resumed at 13:16:01 and stopped again about 270 s apart; in the run of
2026-10-18 recorded above, the watchdog fired at 07:37:47, 07:42:18 and 07:46:48 UTC, 271 s and 270 s apart. A period of 270 s
matches the IGMP group membership interval of a router with a 130 s query interval (2 x 130 s + 10 s response time).
The router is the IGMP querier. The conclusion is that the phone's answers to the router's membership queries do not keep
its membership alive on this Wi-Fi path, while the join report sent when the socket joins the group does: the stream always
came back as soon as the app bound the socket again. A host on the Ethernet side that joined the group changed the
behavior, which fits a membership table that is keyed per group and port on the router or access point.

`MulticastMembershipRefresher` leaves and joins the group again once a minute on every multicast stream socket, which
sends a new join report well inside the membership interval. A refresh that fails to rejoin logs a warning with the
stack. `readStreamDiagnostics` reports the number of completed refreshes as `membershipRefreshes`.

A/B on the keypad phone, Watch for 22 minutes, no host on the group, the same harness (`tools/hil/watch_soak_hil.mjs`):

| Build                                  | Duration | Streams lost | Packets received |
| -------------------------------------- | -------- | ------------ | ---------------- |
| Before: no refresh                     | 25 min   | 2 seen in the 5 s samples, 6 counter resets in all | 135,907 at the end (reset by each restart) |
| After: refresh every 60 s              | 22 min   | 0 (264 samples all live, no counter reset) | 4,472,478 with 22 refreshes |

Six counter resets in 25 minutes is about one per 270 s. The run after the change had none.

## Audio recovery (2026-10-18)

The same bounded restart now serves Listen. A repeat of the `av-clarity` stage on the Pixel found one run in 20 where the
audio stopped arriving at the phone 4 s after the start and did not come back for the remaining 16 s: the host's
capture of the Ultimate's stream was complete, and the app's audio statistics showed the buffer fixed at 78 ms and the
jitter estimate growing without new packets. Before this change the audio mirror reported the loss and stayed lost.
`StreamLossRestarter` (renamed from the video-only restarter) restarts the audio after 2 s and again after 6 s while
Listen is wanted, the page is visible and the device answers REST; the audio card reads "Audio lost, reconnecting…"
meanwhile.

## Cost of the membership refresh on Listen (2026-10-18)

The refresh leaves and joins the group, so the stream is interrupted briefly once a minute. A 240 s Listen run on the
Pixel 4 (`tools/hil/app_audio_stats.mjs`, samples every second) shows concealed audio rising by 12 to 16 ms at samples 36,
96, 156 and 216, which are the refreshes 60 s apart, and nothing else after the initial 40 ms: no underruns, buffer between
116 and 135 ms. That is about 14 ms of concealed audio per minute, which the concealment fades and a listener does not hear.
Keeping the membership alive is worth that cost, since without it the stream stops for good every 270 s.

