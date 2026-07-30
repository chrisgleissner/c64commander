#!/usr/bin/env python3
"""Measure the *evenness* of the A/V mirror's UDP flow, on the wire.

The mirror's audio is a real-time stream: the Ultimate emits one datagram of PCM every
~4 ms and the phone's AudioTrack consumes it at exactly that rate. Anything that clumps
those datagrams together shows up as an underrun (the track runs dry between clumps) or a
refused write (a clump larger than the track buffer), and both are heard as crackling. So
the number that matters is not throughput but *inter-arrival jitter*: how far each packet
lands from where a perfectly even flow would have put it.

This joins the multicast group as an extra listener — it does not disturb the sender or
the phone — and reports the arrival distribution plus sequence loss.

Run it on the host (Ethernet) to characterise what the Ultimate *sends*; the phone's own
arrival pattern is measured separately over CDP, and the difference between the two is the
Wi-Fi path.

Usage:
  av_stream_flow.py [--group 239.0.1.65] [--port 11001] [--seconds 20] [--iface 192.168.1.185]
  av_stream_flow.py --video          # shorthand for the VIC group/port
"""

from __future__ import annotations

import argparse
import json
import socket
import struct
import sys
import time

AUDIO_GROUP, AUDIO_PORT = "239.0.1.65", 11001
VIDEO_GROUP, VIDEO_PORT = "239.0.1.64", 11000
# Wire format: u16 LE sequence, then interleaved stereo S16 (4 bytes/frame).
AUDIO_SEQ_BYTES = 4
AUDIO_BYTES_PER_FRAME = 4
AUDIO_SAMPLE_RATE = 47983.0


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    idx = min(len(ordered) - 1, max(0, int(round((p / 100.0) * (len(ordered) - 1)))))
    return ordered[idx]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--group")
    ap.add_argument("--port", type=int)
    ap.add_argument("--seconds", type=float, default=20.0)
    ap.add_argument("--iface", default="0.0.0.0", help="local IPv4 to join the group on")
    ap.add_argument("--video", action="store_true")
    ap.add_argument("--json", help="write the raw arrival trace here")
    args = ap.parse_args()

    group = args.group or (VIDEO_GROUP if args.video else AUDIO_GROUP)
    port = args.port or (VIDEO_PORT if args.video else AUDIO_PORT)
    is_audio = group == AUDIO_GROUP

    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 4 << 20)
    sock.bind(("", port))
    mreq = struct.pack("4s4s", socket.inet_aton(group), socket.inet_aton(args.iface))
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, mreq)
    sock.settimeout(2.0)

    arrivals: list[float] = []
    sizes: list[int] = []
    seqs: list[int] = []
    senders: set[str] = set()
    deadline = time.monotonic() + args.seconds
    first: float | None = None

    while time.monotonic() < deadline:
        try:
            data, addr = sock.recvfrom(4096)
        except socket.timeout:
            break
        now = time.monotonic()
        if first is None:
            first = now
        arrivals.append((now - first) * 1000.0)
        sizes.append(len(data))
        senders.add(addr[0])
        if is_audio and len(data) >= 2:
            seqs.append(struct.unpack_from("<H", data, 0)[0])

    if len(arrivals) < 10:
        print(f"only {len(arrivals)} packets on {group}:{port} — is the stream running?")
        return 2

    span_s = (arrivals[-1] - arrivals[0]) / 1000.0
    gaps = [b - a for a, b in zip(arrivals, arrivals[1:])]
    mean_gap = sum(gaps) / len(gaps)
    payload = sum(sizes) / len(sizes)

    # Where a perfectly even flow would have put each packet. Drift from that ideal is what
    # the AudioTrack has to absorb out of its (60 ms) buffer.
    ideal = [arrivals[0] + i * mean_gap for i in range(len(arrivals))]
    drift = [a - i for a, i in zip(arrivals, ideal)]
    burst_span = max(drift) - min(drift)

    # Largest clump: packets arriving <1 ms apart are one burst as far as the sink is concerned.
    clumps: list[int] = []
    run = 1
    for g in gaps:
        if g < 1.0:
            run += 1
        else:
            clumps.append(run)
            run = 1
    clumps.append(run)

    lost = 0
    if seqs:
        for a, b in zip(seqs, seqs[1:]):
            step = (b - a) & 0xFFFF
            if step > 1:
                lost += step - 1

    print(f"group {group}:{port}  senders={sorted(senders)}")
    print(f"packets {len(arrivals)} over {span_s:.1f}s = {len(arrivals) / span_s:.0f}/s, mean payload {payload:.0f}B")
    if is_audio:
        frames = (payload - AUDIO_SEQ_BYTES) / AUDIO_BYTES_PER_FRAME
        print(f"  audio per packet: {frames:.0f} stereo frames = {frames * 1000 / AUDIO_SAMPLE_RATE:.2f} ms")
        print(f"  sequence loss: {lost} packets ({lost * 100.0 / max(len(seqs) + lost, 1):.2f}%)")
    print("inter-arrival gap (ms):")
    print(
        f"  mean {mean_gap:.2f}  p50 {percentile(gaps, 50):.2f}  p90 {percentile(gaps, 90):.2f}  "
        f"p99 {percentile(gaps, 99):.2f}  max {max(gaps):.2f}"
    )
    print(f"  gaps over 20ms: {sum(1 for g in gaps if g > 20)}   over 50ms: {sum(1 for g in gaps if g > 50)}")
    print(f"burstiness: drift from an even flow spans {burst_span:.1f} ms; largest clump {max(clumps)} packets")
    if is_audio:
        audio_ms_per_pkt = ((payload - AUDIO_SEQ_BYTES) / AUDIO_BYTES_PER_FRAME) * 1000 / AUDIO_SAMPLE_RATE
        print(f"  worst clump carries {max(clumps) * audio_ms_per_pkt:.0f} ms of audio; worst gap starves for {max(gaps):.0f} ms")

    if args.json:
        with open(args.json, "w") as fh:
            json.dump({"arrivals": arrivals, "sizes": sizes, "seqs": seqs, "senders": sorted(senders)}, fh)
    return 0


if __name__ == "__main__":
    sys.exit(main())
