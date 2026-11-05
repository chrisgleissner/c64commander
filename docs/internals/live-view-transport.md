# Live View transport: unicast to the phone

Live View asks the Ultimate to send its audio and video streams straight to the phone's own
address (unicast). It does not use the multicast groups `239.0.1.64` and `239.0.1.65`, except when
the hardware gate switches the page to them to measure the wire (see below).

## Why unicast

Wi-Fi sends a multicast frame once, at the access point's basic rate, with no acknowledgement and
no retry. The two streams add up to about 3,657 packets per second and 22.8 Mbit/s, and the video is
about fourteen times the volume of the audio.

Measured on 1 November 2026, one access point, one SSID, two phones, the same C64 Ultimate:

| | Sent by the Ultimate | Pixel 4 (5 GHz) | Keypad handset (2.4 GHz) |
| --- | --- | --- | --- |
| Multicast, packets/s received at `wlan0` | 3,657 | 3,600 | 585 |
| Multicast, Mbit/s received at `wlan0` | 22.8 | 23 | 3 |
| Unicast at the video's rate (3,400 packets/s of 780 bytes), packets/s received | 3,400 | not measured | 3,130 |

The handset's kernel dropped no packets: they never reached the phone. With multicast and video
streaming, 17.5% of its audio packets were lost and the audio was concealed and audibly damaged;
with audio alone, or with unicast, none were. On the Pixel, multicast with video lost about 2.9% of
the audio, and unicast lost none in a 16 second run.

## What the firmware does

`PUT /v1/streams/{video,audio}:start?ip=<address>[:port]` sends to a single host only after the
Ultimate has found that host's hardware address on its **wired** port
(`software/io/network/data_streamer.cc`). It sends a UDP probe and looks in its ARP table, ten times
at 20 ms intervals, which is about 200 ms. If the table has no entry, the call fails with 404 and
`Network Host Resolve Error`. The port 64 commands (`0xFF20`, `0xFF21`) call the same function and
have the same lookup. The firmware keeps one destination per stream, so one phone at a time can
receive Live View.

A phone whose Wi-Fi radio is dozing answers the probe too late. Measured: a cold phone fails every
time; after the phone has sent ICMP echo requests to the Ultimate the same request succeeds, and
keeps succeeding for minutes. A TCP connection to the Ultimate does not put the phone in the table.

## What the app does

1. `StreamUdp.prepareUnicast(host)` (Android) reads the address this phone uses to reach the
   Ultimate from a connected UDP socket that sends nothing, holds the Wi-Fi radio in low-latency
   mode, and sends up to three ICMP echoes. Unprivileged ICMP is available to every app
   (`net.ipv4.ping_group_range`).
2. The receiver binds a plain UDP socket and sets its destination to `<that address>:<port>`.
3. The session sends `streams/<name>:start?ip=<destination>`. On `Network Host Resolve Error` it
   prepares the path again and retries, up to four attempts 300 ms apart
   (`src/lib/streams/unicastStart.ts`). Other errors are not retried.
4. If the phone's address cannot be read, the receiver falls back to the multicast group and logs a
   warning. Demo Mode keeps its loopback stream.

## The audio guard

A link can be unable to carry both streams. On the handset's 2.4 GHz link, audio is clean on its
own, and loses about 160 packets in the two seconds after the video starts. `AudioLossGuard`
(`src/lib/streams/audioLossGuard.ts`) stops the video when the audio loses 8% or more of its
packets in two consecutive one second windows while both streams run, and the Live View controls say
why. Presenting fewer frames does not help, because every video packet is still received; only
stopping the video stream lifts the load. Starting the video again clears the notice.

## The hardware gate

The gate's `wire` and `av-latency` stages measure the stream from the PC, which can only see the
multicast groups. They set `c64u_stream_transport` to `multicast` in the page, run, and set it back
to `unicast` (`withMulticastTransport` in `tools/hil/merge_gate.mjs`). The app reads the key when a
stream starts and treats any value other than `multicast` as unicast. There is no control for it.
`av-clarity` and the other stages run on the unicast path.
