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
