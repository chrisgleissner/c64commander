#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
# Licensed under the GNU General Public License v3.0 or later.
#
"""How long it takes a sound to get from the Ultimate to the air in front of the phone.

WHAT IS MEASURED, AND AGAINST WHAT

The Ultimate emits the mirror's audio as multicast PCM. This host joins the same group as an
extra listener — it does not disturb the sender or the phone — and records the datagrams with
host timestamps. At the same time a microphone in front of the phone records what the speaker
actually produces. Both recordings therefore carry the SAME signal, one at the moment it left
the Ultimate and one at the moment it reached the room, so cross-correlating them gives the
whole path: network, jitter buffer, AudioTrack, mixer, speaker and the air between the grille
and the microphone.

That is the number a player feels. It is not the same as the app's reported buffer depth, which
describes one stage of it; the two are printed together precisely so a change to the pipeline
can be seen to move both, or to move one and not the other.

WHY CROSS-CORRELATION RATHER THAN ONSET MATCHING

An onset detector has to decide what counts as an onset in a signal it did not choose, and the
answer differs between the wire (clean) and the microphone (a room). Correlating the two
envelopes uses every sample of whatever the C64 happens to be playing and needs no threshold —
so it works with a tune, with the barcode stimulus, or with anything else audible.

Both recordings are band-limited to 300-6000 Hz first. The room's noise here is almost all
below 300 Hz, which is a band a phone speaker barely reproduces, so leaving it in makes the
correlation track the fan rather than the music (see AGENTS.md).

ACCURACY

The wire timestamp is a socket receive, good to about a millisecond. The microphone timestamp
is the moment the first bytes leave `arecord`, which lags the true start of capture by up to
one ALSA period. The reported figure therefore carries roughly +-15 ms of systematic
uncertainty, which is stated in the output rather than hidden: the quantities of interest here
are one to three hundred milliseconds, and a conclusion that depends on 15 ms of it should be
reached with a different instrument.

USAGE

  python3 tools/hil/mirror_audio_latency_hil.py [--seconds 12] [--iface 192.168.1.185]
                                                [--device plughw:CARD=SF558,DEV=0]

The C64 must be making a sound and the phone must be Listening. Play something first — the
barcode stimulus from `audio_e2e_probe.py play` is ideal because it is loud, band-limited and
constantly changing, which is what a correlation likes.
"""

from __future__ import annotations

import argparse
import socket
import struct
import subprocess
import sys
import threading
import time

import numpy as np

GROUP = "239.0.1.65"
PORT = 11001
WIRE_RATE = 47983  # the Ultimate's own audio rate; close to 48k but not equal
MIC_RATE = 48000
BAND = (300.0, 6000.0)
ENVELOPE_MS = 2.0
MAX_LAG_MS = 800.0


def capture_wire(seconds: float, iface: str, out: dict) -> None:
    """Join the group and record PCM, noting the host time of the first datagram."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 8 << 20)
    sock.bind(("", PORT))
    sock.setsockopt(
        socket.IPPROTO_IP,
        socket.IP_ADD_MEMBERSHIP,
        struct.pack("4s4s", socket.inet_aton(GROUP), socket.inet_aton(iface)),
    )
    sock.settimeout(3.0)
    pcm = bytearray()
    first_at = None
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            data, _ = sock.recvfrom(4096)
        except socket.timeout:
            break
        if first_at is None:
            first_at = time.monotonic()
        pcm += data[2:]  # strip the u16 sequence prefix
    sock.close()
    out["pcm"] = bytes(pcm)
    out["first_at"] = first_at


def capture_mic(seconds: float, device: str, out: dict) -> None:
    """Record the microphone, noting the host time the first samples emerge from arecord."""
    proc = subprocess.Popen(
        ["arecord", "-D", device, "-f", "S16_LE", "-r", str(MIC_RATE), "-c", "1", "-t", "raw", "-q"],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    raw = bytearray()
    first_at = None
    deadline = time.monotonic() + seconds
    try:
        while time.monotonic() < deadline:
            chunk = proc.stdout.read(4096)
            if not chunk:
                break
            if first_at is None:
                first_at = time.monotonic()
            raw += chunk
    finally:
        proc.terminate()
        proc.wait(timeout=3)
    out["raw"] = bytes(raw)
    out["first_at"] = first_at
    out["stderr"] = proc.stderr.read().decode(errors="replace") if proc.stderr else ""


def bandpass(signal: np.ndarray, rate: int) -> np.ndarray:
    """Keep 300-6000 Hz, in the frequency domain — exact, and short enough to read."""
    spectrum = np.fft.rfft(signal)
    freqs = np.fft.rfftfreq(len(signal), 1.0 / rate)
    spectrum[(freqs < BAND[0]) | (freqs > BAND[1])] = 0
    return np.fft.irfft(spectrum, n=len(signal))


def envelope(signal: np.ndarray, rate: int) -> np.ndarray:
    """Rectify and smooth, so the correlation matches loudness rather than phase.

    Correlating the waveforms themselves would lock onto individual cycles of whatever tone is
    playing and report a lag modulo one period — a confident answer that is wrong by a whole
    number of milliseconds.
    """
    width = max(1, int(rate * ENVELOPE_MS / 1000.0))
    smooth = np.convolve(np.abs(signal), np.ones(width) / width, mode="same")
    return smooth - smooth.mean()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--seconds", type=float, default=12.0)
    ap.add_argument("--iface", default="192.168.1.185")
    ap.add_argument("--device", default="plughw:CARD=SF558,DEV=0")
    args = ap.parse_args()

    wire: dict = {}
    mic: dict = {}
    threads = [
        threading.Thread(target=capture_wire, args=(args.seconds, args.iface, wire)),
        threading.Thread(target=capture_mic, args=(args.seconds, args.device, mic)),
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    if not wire.get("pcm") or wire.get("first_at") is None:
        print("nothing on the multicast group — is the Ultimate streaming audio?")
        return 2
    if not mic.get("raw") or mic.get("first_at") is None:
        print(f"nothing from the microphone — {mic.get('stderr', '').strip() or 'no error reported'}")
        return 2

    # Wire: interleaved 16-bit stereo, left channel only.
    wire_pcm = np.frombuffer(wire["pcm"][: len(wire["pcm"]) // 4 * 4], dtype="<i2").astype(np.float64)
    wire_mono = wire_pcm[0::2]
    # Resample onto the microphone's grid so one lag index means one sample in both.
    n_out = int(len(wire_mono) * MIC_RATE / WIRE_RATE)
    wire_mono = np.interp(
        np.linspace(0, len(wire_mono) - 1, n_out), np.arange(len(wire_mono)), wire_mono
    )
    mic_mono = np.frombuffer(mic["raw"][: len(mic["raw"]) // 2 * 2], dtype="<i2").astype(np.float64)

    if len(wire_mono) < MIC_RATE or len(mic_mono) < MIC_RATE:
        print("less than a second captured on one side; run for longer")
        return 2

    wire_env = envelope(bandpass(wire_mono, MIC_RATE), MIC_RATE)
    mic_env = envelope(bandpass(mic_mono, MIC_RATE), MIC_RATE)

    # Trim both to the same length so the correlation is over the same span.
    span = min(len(wire_env), len(mic_env))
    wire_env, mic_env = wire_env[:span], mic_env[:span]

    max_lag = int(MIC_RATE * MAX_LAG_MS / 1000.0)
    # Correlate only over the plausible lag window: the mic hears the sound AFTER the wire, so
    # only positive lags are physical, and a peak outside the window would be an artefact.
    correlation = np.correlate(mic_env, wire_env[: span - max_lag], mode="valid")[: max_lag + 1]
    norm = np.linalg.norm(wire_env[: span - max_lag]) * np.linalg.norm(mic_env)
    peak = int(np.argmax(correlation))
    strength = float(correlation[peak] / norm) if norm else 0.0

    # The two captures did not start at the same instant; that difference is part of the lag.
    start_skew_ms = (mic["first_at"] - wire["first_at"]) * 1000.0
    lag_ms = peak * 1000.0 / MIC_RATE + start_skew_ms

    print(f"wire      {len(wire_mono) / MIC_RATE:.1f}s from {GROUP}:{PORT}")
    print(f"mic       {len(mic_mono) / MIC_RATE:.1f}s from {args.device}")
    print(f"skew      capture starts differ by {start_skew_ms:+.1f} ms (already included below)")
    print(f"peak      correlation {strength:.3f} at {peak * 1000.0 / MIC_RATE:.1f} ms into the window")
    print(f"LATENCY   {lag_ms:.0f} ms  Ultimate wire -> phone speaker (+-15 ms)")
    if strength < 0.15:
        print("  the correlation is weak — is the C64 actually making a sound, and is the phone Listening?")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
