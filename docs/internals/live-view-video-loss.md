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

`VideoLossRestarter` (`src/lib/streams/videoLossRecovery.ts`), owned by `AvMirrorSession`:

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
30 minutes while Watch was wanted. Whether packets were still arriving at those moments is not known: the host was not
listening, and the plugin does not count packets for a stream whose frames do not assemble. This is the evidence the
issue was missing: on this phone the loss does occur, at intervals of 4 to 13 minutes.

A host that joined the video group changed the result on the same phone. With the host's membership in place, the stream
was lost within about 8 s in three of three runs, and restarts by the app did not help (the loss recurred after each
restart until the attempts were used up). Without the host's membership, six of six start attempts and the 30 minute run
held. The router (192.168.1.1) is the IGMP querier and speaks IGMP version 2. The host sent version 2 reports. What the
phone sends was not captured. This points at multicast delivery on the Wi-Fi leg, not at the app's watchdog, but the
cause is not established. A second Ultimate sending into the group was not retested.

Reading `videoLossRecovery.ts` and `streamArrivalWatchdog.ts`: the watchdog counts a completed frame (native path) or a
datagram (JS path) as an arrival. On the native path, packets that arrive but do not assemble into frames leave the
watchdog without an arrival, so "lost" can be declared while packets still arrive. The recovery restarts at most twice,
2 s and 6 s after the loss, and only a stream that then stays live for 30 s earns new attempts.
