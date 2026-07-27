#!/usr/bin/env python3
"""Play the tone & colour ladder on a real machine and measure the A/V it puts on the wire.

This is the hardware counterpart to the in-app check. It asks the Ultimate to play the ladder, joins
both multicast groups directly from this host, and grades what arrives:

  AUDIO   pitch, inter-onset timing and the noise floor of the slots that should be silent
  VIDEO   the background colour, sampled well inside the picture, one reading per assembled frame
  A/V     the delay between a note starting and its own colour appearing

The last one is the point. The player writes the SID frequency and the VIC background register in
the same instruction sequence, so on the machine they are simultaneous; whatever separation shows up
here belongs to the transport. And because the ladder walks all 16 palette entries, one per note,
each colour identifies its slot uniquely — so the picture says which note ought to be sounding, and
a mismatch is a content fault rather than a timing one.

Capturing from this host rather than through a phone's microphone is deliberate: it takes the
speaker, the room and the phone's own audio stack out of the measurement, so a number that comes
back wrong is the device or the network.

    python3 tools/hil/tone_ladder_hil.py --host c64u --password pwd

Leaves the machine stopped and both streams stopped, whatever happens.
"""

from __future__ import annotations

import argparse
import socket
import struct
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
from analyse_tone_ladder import C64_COLOUR_NAMES, SLOT_SECONDS, analyse  # noqa: E402

MULTICAST = {"video": ("239.0.1.64", 11000), "audio": ("239.0.1.65", 11001)}
AUDIO_RATE = 47983  # PAL stereo, 16-bit
VIC_WIDTH = 384
VIC_HEADER_BYTES = 12
SID_PATH = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "tone-ladder.sid"


def rest(host: str, path: str, password: str, method: str = "PUT", body: bytes | None = None,
         content_type: str | None = None, timeout: float = 10.0) -> tuple[int, bytes]:
    request = urllib.request.Request(f"http://{host}{path}", data=body, method=method)
    request.add_header("X-Password", password)
    if content_type:
        request.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        # The device sometimes resets rather than sending an error body; the status is what matters.
        try:
            return error.code, error.read()
        except OSError:
            return error.code, b""


def multipart(field: str, filename: str, payload: bytes) -> tuple[bytes, str]:
    """Build a multipart/form-data body — what /v1/runners:sidplay expects, not raw bytes."""
    boundary = "----c64commander-tone-ladder"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'
        f"Content-Type: application/octet-stream\r\n\r\n"
    ).encode() + payload + f"\r\n--{boundary}--\r\n".encode()
    return body, f"multipart/form-data; boundary={boundary}"


def join(name: str) -> socket.socket:
    group, port = MULTICAST[name]
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("", port))
    sock.setsockopt(
        socket.IPPROTO_IP,
        socket.IP_ADD_MEMBERSHIP,
        struct.pack("4sl", socket.inet_aton(group), socket.INADDR_ANY),
    )
    sock.setblocking(False)
    return sock


def background_colour(frame: bytearray, height: int) -> int:
    """Mode of a grid of interior pixels — the same rule the app uses.

    Sampled well inside the picture so the border, held black for the whole tune, cannot be mistaken
    for the background, and as a mode so a character glyph cannot outvote the colour filling it.
    """
    counts = [0] * 16
    top, bottom = int(height * 0.25), int(height * 0.75)
    for y in range(top, bottom, max(1, (bottom - top) // 16)):
        for x in range(64, 320, 16):
            pixel = y * VIC_WIDTH + x
            index = pixel >> 1
            if index >= len(frame):
                continue
            byte = frame[index]
            counts[(byte >> 4) if pixel & 1 else (byte & 0x0F)] += 1
    return counts.index(max(counts))


def capture(seconds: float) -> tuple[bytes, list[tuple[float, int]], dict]:
    """Collect PCM and per-frame background colours, both stamped on arrival."""
    audio_sock, video_sock = join("audio"), join("video")
    pcm = bytearray()
    colours: list[tuple[float, int]] = []
    frame = bytearray(VIC_WIDTH * 272 // 2)
    senders: set[str] = set()
    audio_packets = video_packets = 0
    last_colour: int | None = None
    pending: tuple[float, int] | None = None
    started = time.monotonic()

    try:
        while time.monotonic() - started < seconds:
            ready = False
            try:
                data, addr = audio_sock.recvfrom(4096)
                senders.add(addr[0])
                pcm += data[2:]  # strip the u16 sequence counter
                audio_packets += 1
                ready = True
            except BlockingIOError:
                pass
            try:
                data, addr = video_sock.recvfrom(4096)
                senders.add(addr[0])
                video_packets += 1
                at = time.monotonic() - started
                line_raw = struct.unpack_from("<H", data, 4)[0]
                line, last_line = line_raw & 0x7FFF, bool(line_raw & 0x8000)
                offset = line * (VIC_WIDTH // 2)
                payload = data[VIC_HEADER_BYTES:]
                frame[offset : offset + len(payload)] = payload
                if last_line:
                    colour = background_colour(frame, 272)
                    if colour != last_colour:
                        # Commit a change only once a second frame agrees, keeping the FIRST frame's
                        # timestamp: one glitched frame must not invent a change nor delay a real one.
                        if pending and pending[1] == colour:
                            colours.append(pending)
                            last_colour = colour
                            pending = None
                        else:
                            pending = (at, colour)
                    else:
                        pending = None
                ready = True
            except BlockingIOError:
                pass
            if not ready:
                time.sleep(0.001)
    finally:
        audio_sock.close()
        video_sock.close()

    return bytes(pcm), colours, {
        "audioPackets": audio_packets,
        "videoPackets": video_packets,
        "senders": sorted(senders),
        "seconds": time.monotonic() - started,
    }


def write_wav(path: Path, pcm: bytes) -> None:
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(AUDIO_RATE)
        handle.writeframes(pcm)


def audio_onsets(wav_path: Path) -> list[float]:
    """Note onset times, from the same code path the offline analyser uses."""
    import analyse_tone_ladder as A

    samples, rate = A.load_mono(str(wav_path))
    env, frame_s = A.envelope(samples, rate)
    quiet_below = A.note_level_db(env) - A.QUIET_BELOW_NOTE_DB
    return [A.refine_onset(samples, rate, index, frame_s) for index in A.find_onsets(env, frame_s, quiet_below)]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="c64u")
    parser.add_argument("--password", default="pwd")
    parser.add_argument("--seconds", type=float, default=20.0)
    parser.add_argument("--out", default="/tmp/tone-ladder-hil.wav")
    args = parser.parse_args()

    group_ip = lambda name: f"{MULTICAST[name][0]}:{MULTICAST[name][1]}"  # noqa: E731
    started_streams: list[str] = []
    try:
        for name in ("audio", "video"):
            status, _ = rest(args.host, f"/v1/streams/{name}:start?ip={group_ip(name)}", args.password)
            print(f"start {name:<5} -> HTTP {status}")
            if status < 400:
                started_streams.append(name)

        body, content_type = multipart("file", "tone-ladder.sid", SID_PATH.read_bytes())
        status, body = rest(
            args.host, "/v1/runners:sidplay", args.password, method="POST", body=body, content_type=content_type
        )
        print(f"play ladder -> HTTP {status} {body[:80]!r}")
        if status >= 400:
            return 1

        print(f"capturing {args.seconds:.0f}s from {MULTICAST['audio'][0]} and {MULTICAST['video'][0]} …")
        pcm, colours, stats = capture(args.seconds)
    finally:
        for name in started_streams:
            rest(args.host, f"/v1/streams/{name}:stop", args.password)
        rest(args.host, "/v1/machine:reset", args.password)
        print("streams stopped, machine reset")

    out = Path(args.out)
    write_wav(out, pcm)
    frames = len(pcm) // 4
    print(f"\nWIRE")
    print(f"  audio packets  : {stats['audioPackets']} ({stats['audioPackets'] / stats['seconds']:.0f}/s)")
    print(f"  video packets  : {stats['videoPackets']} ({stats['videoPackets'] / stats['seconds']:.0f}/s)")
    print(f"  PCM frames     : {frames} ({frames / stats['seconds']:.0f}/s, expected {AUDIO_RATE})")
    # More than one sender on a group is the fault that started all this: everything arrives, in
    # order, with no loss from each sender's point of view, and the result is unlistenable.
    print(f"  senders        : {', '.join(stats['senders']) or 'none'}"
          f"{'   <-- MORE THAN ONE' if len(stats['senders']) > 1 else ''}")

    if not colours:
        print("\nno background colour changes seen — is Live View video reaching this host?")
    else:
        seen = sorted({c for _, c in colours})
        print(f"\nCOLOUR")
        print(f"  changes        : {len(colours)}")
        print(f"  palette seen   : {len(seen)}/16 ({', '.join(C64_COLOUR_NAMES[c] for c in seen)})")

    result = analyse(str(out))
    if not result["usable"]:
        print(f"\nAUDIO UNUSABLE: {result['reason']}")
        return 1
    print(f"\nAUDIO")
    print(f"  in tune        : {result['notesInTune']}/{result['notesDetected']} ({result['inTunePct']}%)")
    print(f"  pitch          : median {result['medianCentsError']:+.1f} c, |median| {result['medianAbsCents']}"
          f", IQR {result['centsIqr']}")
    print(f"  length         : median {result['medianLengthErrorMs']:+.1f} ms, IQR {result['lengthIqrMs']} ms")
    print(f"  silence floor  : {result['silenceFloorDbfs']} dBFS over {result['silencesFound']} slot(s)"
          f"  ({'PASS' if result['silenceGatePassed'] else 'FAIL'})")

    if colours:
        onsets = audio_onsets(out)
        offsets = []
        for at, _ in colours:
            near = [(abs(o - at), o - at) for o in onsets if abs(o - at) < SLOT_SECONDS / 2]
            if near:
                offsets.append(min(near)[1] * 1000.0)
        if offsets:
            median = float(np.median(offsets))
            spread = float(np.percentile(offsets, 75) - np.percentile(offsets, 25))
            # ITU-R BT.1359-1: undetectable within +45/-125 ms, unacceptable beyond +90/-185 ms.
            verdict = (
                "unacceptable" if median > 90 or median < -185
                else "detectable" if median > 45 or median < -125
                else "undetectable"
            )
            print(f"\nA/V SYNC (audio minus video; positive = sound ahead of picture)")
            print(f"  offset         : {median:+.1f} ms, IQR {spread:.1f} ms over {len(offsets)} note(s)")
            print(f"  ITU-R BT.1359-1: {verdict}")
    print(f"\nwrote {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
