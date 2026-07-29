#!/usr/bin/env python3
"""Capture the Ultimate's mirrored audio off the wire as a WAV.

This is the C64-rendered reference for any comparison against local playback: it is the
machine's own SID output, digital, before a speaker or a room touches it. Joining the
multicast group as an extra listener does not disturb the sender or the phone.

The point of a *stereo* capture is that the two channels are not redundant. The Ultimate
mixes several SIDs at different pan positions, so how far apart L and R are is itself a
measurement — see `--report`, which prints the inter-channel correlation alongside the
spectrum. A single locally-rendered SID is one signal in the middle; if the reference is
materially decorrelated, no filter setting can close that gap.

Usage:
  capture_mirror_pcm.py --seconds 12 --out reference.wav [--iface 192.168.1.185] [--report]
"""

from __future__ import annotations

import argparse
import socket
import struct
import sys
import wave

AUDIO_GROUP, AUDIO_PORT = "239.0.1.65", 11001
# Wire format: u16 LE sequence, then interleaved stereo S16. Measured: 770-byte datagrams,
# i.e. 2 header bytes + 192 stereo frames.
SEQ_HEADER_BYTES = 2
SAMPLE_RATE = 47983


def capture(seconds: float, iface: str | None) -> tuple[bytes, int, int]:
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", AUDIO_PORT))
    group = socket.inet_aton(AUDIO_GROUP)
    local = socket.inet_aton(iface) if iface else struct.pack("=I", socket.INADDR_ANY)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_ADD_MEMBERSHIP, group + local)
    sock.settimeout(5.0)

    chunks: list[bytes] = []
    packets = 0
    lost = 0
    previous_seq: int | None = None
    deadline = None
    while True:
        try:
            data = sock.recv(4096)
        except socket.timeout:
            break
        now = __import__("time").monotonic()
        if deadline is None:
            # Start the clock at the FIRST packet, not at bind: waiting for a stream that has
            # not been started yet would otherwise eat the whole capture window.
            deadline = now + seconds
        if len(data) <= SEQ_HEADER_BYTES:
            continue
        seq = struct.unpack_from("<H", data, 0)[0]
        if previous_seq is not None:
            gap = (seq - previous_seq) & 0xFFFF
            if gap > 1:
                lost += gap - 1
        previous_seq = seq
        chunks.append(data[SEQ_HEADER_BYTES:])
        packets += 1
        if now >= deadline:
            break

    sock.close()
    return b"".join(chunks), packets, lost


def report(pcm: bytes) -> None:
    import numpy as np

    frames = np.frombuffer(pcm, dtype="<i2").reshape(-1, 2).astype(np.float64)
    left, right = frames[:, 0], frames[:, 1]
    if len(left) < SAMPLE_RATE // 4:
        print("too little audio to report on", file=sys.stderr)
        return

    def rms(x):
        return float(np.sqrt(np.mean(x * x)))

    lr = float(np.corrcoef(left, right)[0, 1]) if rms(left) > 0 and rms(right) > 0 else float("nan")
    mono = (left + right) / 2.0
    side = (left - right) / 2.0

    print(f"frames            {len(frames):,} ({len(frames) / SAMPLE_RATE:.2f} s)")
    print(f"peak              L {int(np.max(np.abs(left)))}  R {int(np.max(np.abs(right)))}")
    print(f"rms               L {rms(left):.1f}  R {rms(right):.1f}")
    # 1.0 would mean the two channels carry the same signal, i.e. one SID in the middle.
    print(f"L/R correlation   {lr:.4f}")
    print(f"side/mid energy   {rms(side) / max(rms(mono), 1e-9):.4f}")

    # Where the energy sits. "Tinny" is a statement about this distribution, so measure it
    # rather than argue about it.
    spectrum = np.abs(np.fft.rfft(mono * np.hanning(len(mono))))
    freqs = np.fft.rfftfreq(len(mono), 1.0 / SAMPLE_RATE)
    total = float(np.sum(spectrum**2)) or 1.0
    for lo, hi in [(0, 120), (120, 400), (400, 1200), (1200, 4000), (4000, 12000), (12000, 24000)]:
        band = spectrum[(freqs >= lo) & (freqs < hi)]
        print(f"  {lo:>5}-{hi:<5} Hz  {100.0 * float(np.sum(band**2)) / total:6.2f}%")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--seconds", type=float, default=12.0)
    parser.add_argument("--out", default="reference.wav")
    parser.add_argument("--iface", default=None, help="local interface address to join the group on")
    parser.add_argument("--report", action="store_true", help="print channel and spectrum statistics")
    args = parser.parse_args()

    pcm, packets, lost = capture(args.seconds, args.iface)
    if not packets:
        print("no audio datagrams arrived — is the mirror running?", file=sys.stderr)
        return 1

    with wave.open(args.out, "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(SAMPLE_RATE)
        handle.writeframes(pcm)

    print(f"wrote {args.out}: {packets:,} packets, {lost} lost")
    if args.report:
        report(pcm)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
