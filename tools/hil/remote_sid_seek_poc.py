#!/usr/bin/env python3
"""Proof of concept for remote SID seeking: fast forward, rewind and jumps on the Ultimate's own SID player.

The app is not involved. Everything goes over the Ultimate's REST API, so this measures what the
player and the firmware can do, and it is the place to tune the numbers the app uses.

HOW REMOTE SEEKING WORKS

The Ultimate's SID player fast forwards while the left-arrow key is held: its interrupt handler
calls the tune's play routine back to back instead of once per frame. That loop is bound by the
CPU, so on a U64-family machine it gets faster with CPU Speed. A tune cannot run backwards, so a
rewind restarts the sub tune through the player's own keys and fast forwards to the target. The
player draws an "mm:ss" clock at the start of screen row 23. It counts play calls, so it also counts
correctly while fast forwarding, and it is the position source.

GROUND TRUTH

The clock is checked against a generated PSID whose play routine increments a 24-bit counter.
Counter / play rate is the exact tune position. The generated tune writes no SID register, so it
is silent. The real tunes passed with --tune are audible on the C64; each stage plays only briefly.

STAGES

  preflight      device info, the CPU Speed options, and a snapshot of the settings this tool changes
  clock          the player's clock against the counter, at normal speed and while fast forwarding,
                 for a PAL and an NTSC tune (an NTSC tune on a PAL machine runs from a CIA timer)
  rates          fast forward rate at every CPU Speed, and REST latency right after each speed write
  ramp           the app's hold schedule: one CPU step per second held
  seek           restart + fast forward to a target, for several slow-down policies: landing error
                 against the target and the counter, and the wall time each jump takes
  turbo-off      Turbo Control Off -> Manual -> speed -> back, with REST availability after each write
                 (only with --turbo-off-check, because it changes Turbo Control)

Every run ends by releasing the keys, restoring Turbo Control and CPU Speed to the snapshot,
reading them back, and resetting the C64.

    python3 tools/hil/remote_sid_seek_poc.py --host c64u --tune path/to/tune.sid --json out.json
"""

from __future__ import annotations

import argparse
import json
import struct
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

U64_CATEGORY = "U64 Specific Settings"
TURBO_CONTROL = "Turbo Control"
CPU_SPEED = "CPU Speed"
FAST_FORWARD_KEY = "arrow_left"
CLOCK_OFFSET = 23 * 40
PLAYER_TITLE_MARKER = "SID PLAYER"

COUNTER_ADDR = 0x10F0
TUNE_LOAD = 0x1000
PAL_FLAGS = 0x04
NTSC_FLAGS = 0x08
PAL_CPU_HZ = 985248.0
# Exact play-call rates on a PAL machine: a PAL frame is 19656 cycles, and the player times an NTSC
# tune at 16388 cycles (measured). Nominal 50/60 Hz would put the reference 0.25% ahead.
PLAY_RATE_HZ = {"PAL": PAL_CPU_HZ / 19656, "NTSC": PAL_CPU_HZ / 16388}

# The app's ramp: the machine's own speed first, then these CPU Speeds, one per second held.
RAMP_MHZ = [4, 8, 16, 32]
# Every speed the rates stage measures, including those the ramp leaves out for being no faster.
MEASURED_MHZ = [1, 2, 4, 8, 16, 32, 48, 64]
REWIND_STEPS_S = [10, 20, 40, 80]


# ---------------------------------------------------------------------------------------------
# Pure helpers (unit tested in tools/hil/tests/test_remote_sid_seek_poc.py)
# ---------------------------------------------------------------------------------------------


def screen_address(dd00: int, d018: int) -> int:
    """Where the VIC fetches screen RAM: the CIA 2 bank bits and the D018 matrix nibble."""
    return (3 - (dd00 & 0x03)) * 0x4000 + ((d018 >> 4) & 0x0F) * 0x400


def screen_text(codes: bytes) -> str:
    out = []
    for code in codes:
        code &= 0x7F
        if 1 <= code <= 26:
            out.append(chr(code + 64))
        elif 0x20 <= code <= 0x3F:
            out.append(chr(code))
        else:
            out.append(".")
    return "".join(out)


def parse_clock(codes: bytes) -> int | None:
    """Seconds shown by the player's "mm:ss" clock, or None when the five cells are not a clock."""
    text = screen_text(codes)
    if len(text) != 5 or text[2] != ":" or not (text[:2] + text[3:]).isdigit():
        return None
    minutes, seconds = int(text[:2]), int(text[3:])
    return None if seconds > 59 else minutes * 60 + seconds


def cpu_speed_mhz(option: str) -> int | None:
    stripped = option.strip()
    return int(stripped) if stripped.isdigit() else None


def option_for_mhz(options: list[str], mhz: int) -> str | None:
    """The device's own spelling of a speed (" 4", "16"); the firmware rejects anything else."""
    return next((option for option in options if cpu_speed_mhz(option) == mhz), None)


def ramp_options(options: list[str], start_mhz: int) -> list[str]:
    """CPU Speeds for each further second held: the RAMP_MHZ entries above the start, then the maximum."""
    numeric = sorted({mhz for mhz in (cpu_speed_mhz(o) for o in options) if mhz is not None})
    if not numeric:
        return []
    steps = [mhz for mhz in RAMP_MHZ if mhz > start_mhz and mhz in numeric]
    if numeric[-1] > start_mhz and numeric[-1] not in steps:
        steps.append(numeric[-1])
    return [option_for_mhz(options, mhz) for mhz in steps]  # type: ignore[misc]


def rewind_offset_s(steps_held: int) -> int:
    """Total distance rewound after `steps_held` steps: 10, 30, 70, 150, 230, ..."""
    total = 0
    for index in range(steps_held):
        total += REWIND_STEPS_S[min(index, len(REWIND_STEPS_S) - 1)]
    return total


def build_counter_psid(video: str, busy_loops: int = 0, cia_timer: int | None = None) -> bytes:
    """A silent PSID whose play routine increments a 24-bit counter at COUNTER_ADDR.

    `busy_loops` adds a delay loop of that many DEX iterations (5 cycles each) to the play routine,
    so the fast forward rate can be measured for a play routine of a realistic cost. `cia_timer`
    marks the tune as CIA-timed and makes its init load that value into CIA 1 timer A, which is how
    a multi-speed tune asks for more than one play call per frame.
    """
    lo, hi = COUNTER_ADDR & 0xFF, COUNTER_ADDR >> 8
    init = bytes([0xA9, 0x00, 0x8D, lo, hi, 0x8D, lo + 1, hi, 0x8D, lo + 2, hi])
    if cia_timer is not None:
        init += bytes([0xA9, cia_timer & 0xFF, 0x8D, 0x04, 0xDC, 0xA9, cia_timer >> 8, 0x8D, 0x05, 0xDC])
    init += bytes([0x60])
    play = bytearray([0xEE, lo, hi, 0xD0, 0x08, 0xEE, lo + 1, hi, 0xD0, 0x03, 0xEE, lo + 2, hi])
    if busy_loops > 0:
        loops = min(busy_loops, 255)
        play += bytes([0xA2, loops, 0xCA, 0xD0, 0xFD])
    play += bytes([0x60])
    code = init + bytes(4) + bytes(play)
    init_addr = TUNE_LOAD
    play_addr = TUNE_LOAD + len(init) + 4
    flags = PAL_FLAGS if video == "PAL" else NTSC_FLAGS
    header = b"PSID" + struct.pack(">HH", 2, 0x7C) + struct.pack(">HHH", 0, init_addr, play_addr)
    header += struct.pack(">HHI", 1, 1, 0 if cia_timer is None else 1)
    header += f"seek counter {video}".encode().ljust(32, b"\0")
    header += b"c64commander HIL".ljust(32, b"\0")
    header += b"2026".ljust(32, b"\0")
    header += struct.pack(">HBBH", flags, 0, 0, 0)
    assert len(header) == 0x7C
    return header + struct.pack("<H", TUNE_LOAD) + code


def counter_value(raw: bytes) -> int:
    return raw[0] | (raw[1] << 8) | (raw[2] << 16)


CLOCK_WRAP_S = 100 * 60


def rate_between(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Tune seconds per wall second between two (wall, tune) samples. The player's clock wraps
    after 99:59, which a light tune passes within a second at 32 MHz, so a negative step is a wrap."""
    wall = b[0] - a[0]
    step = b[1] - a[1]
    if step < 0:
        step += CLOCK_WRAP_S
    return step / wall if wall > 0 else 0.0


# ---------------------------------------------------------------------------------------------
# Device access
# ---------------------------------------------------------------------------------------------


class Device:
    def __init__(self, host: str, timeout: float = 8.0) -> None:
        self.base = f"http://{host}"
        self.timeout = timeout
        self.screen = 0

    def request(self, method: str, path: str, body: bytes | None = None, ctype: str | None = None) -> bytes:
        req = urllib.request.Request(self.base + path, data=body, method=method)
        if ctype:
            req.add_header("Content-Type", ctype)
        attempts = 2 if method == "GET" else 1
        for attempt in range(attempts):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    return resp.read()
            except urllib.error.HTTPError as error:
                raise RuntimeError(f"{method} {path} failed: HTTP {error.code} {error.read()[:200]!r}") from error
            except (urllib.error.URLError, TimeoutError) as error:
                # The first request after the Ultimate has been idle can stall (c64u-keepalive-wedge);
                # a read is safe to repeat, a write is not.
                if attempt + 1 == attempts:
                    raise RuntimeError(f"{method} {path} failed: {error}") from error
                log(f"retrying {method} {path} after {error}")
        raise AssertionError("unreachable")

    def timed(self, fn: Callable[[], object]) -> float:
        started = time.monotonic()
        fn()
        return (time.monotonic() - started) * 1000

    def info(self) -> dict:
        return json.loads(self.request("GET", "/v1/info"))

    def readmem(self, address: int, length: int) -> bytes:
        return self.request("GET", f"/v1/machine:readmem?address={address:04X}&length={length}")

    def config_item(self, item: str) -> dict:
        path = f"/v1/configs/{urllib.parse.quote(U64_CATEGORY)}/{urllib.parse.quote(item)}"
        return json.loads(self.request("GET", path))[U64_CATEGORY][item]

    def set_config(self, item: str, value: str) -> float:
        path = (
            f"/v1/configs/{urllib.parse.quote(U64_CATEGORY)}/{urllib.parse.quote(item)}"
            f"?value={urllib.parse.quote(value)}"
        )
        return self.timed(lambda: self.request("PUT", path))

    def key(self, transition: str, *names: str) -> None:
        body = json.dumps({"events": [{"kind": "keyboard", "inputs": list(names), "transition": transition}]})
        self.request("POST", "/v1/machine:input", body.encode(), "application/json")

    def tap(self, *names: str) -> None:
        self.key("press", *names)
        time.sleep(0.06)
        self.key("release", *names)

    def held_keys(self) -> list[str]:
        return json.loads(self.request("GET", "/v1/machine:input"))["keyboard"]["inputs"]

    def reset(self) -> None:
        self.request("PUT", "/v1/machine:reset")

    def sidplay(self, sid: bytes, name: str) -> None:
        boundary = "----remote-sid-seek-poc"
        body = (
            f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{name}"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + sid + f"\r\n--{boundary}--\r\n".encode()
        self.request("POST", "/v1/runners:sidplay", body, f"multipart/form-data; boundary={boundary}")
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            time.sleep(0.3)
            screen = screen_address(self.readmem(0xDD00, 1)[0], self.readmem(0xD018, 1)[0])
            if PLAYER_TITLE_MARKER in screen_text(self.readmem(screen, 40)):
                self.screen = screen
                return
        raise RuntimeError(f"the SID player screen did not appear for {name}")

    def clock(self) -> int | None:
        return parse_clock(self.readmem(self.screen + CLOCK_OFFSET, 5))

    def wait_clock(self, predicate: Callable[[int], bool], timeout: float, poll: float = 0.01) -> tuple[float, int]:
        """Wall time at which the clock first satisfies `predicate` (mid-point of the read span), and its value."""
        deadline = time.monotonic() + timeout
        previous = None
        while time.monotonic() < deadline:
            started = time.monotonic()
            value = self.clock()
            if value is not None and predicate(value):
                now = time.monotonic()
                return ((previous + now) / 2 if previous is not None else now), value
            previous = started
            time.sleep(poll)
        raise RuntimeError(f"clock did not satisfy the condition within {timeout}s (shows {self.clock()})")

    def next_tick(self, timeout: float = 3.0) -> tuple[float, int]:
        current = self.clock()
        return self.wait_clock(lambda v: v != current, timeout)

    def counter(self) -> int:
        return counter_value(self.readmem(COUNTER_ADDR, 3))


# ---------------------------------------------------------------------------------------------
# Stages
# ---------------------------------------------------------------------------------------------


@dataclass
class Context:
    device: Device
    tunes: list[Path]
    settings: dict[str, str] = field(default_factory=dict)
    speed_options: list[str] = field(default_factory=list)
    results: dict = field(default_factory=dict)

    def max_option(self) -> str:
        numeric = [o for o in self.speed_options if cpu_speed_mhz(o) is not None]
        return max(numeric, key=lambda o: cpu_speed_mhz(o) or 0)

    def base_option(self) -> str:
        return self.settings[CPU_SPEED]


def log(message: str) -> None:
    print(message, flush=True)


def stage_preflight(ctx: Context) -> dict:
    info = ctx.device.info()
    turbo = ctx.device.config_item(TURBO_CONTROL)
    speed = ctx.device.config_item(CPU_SPEED)
    ctx.settings = {TURBO_CONTROL: turbo["current"], CPU_SPEED: speed["current"]}
    ctx.speed_options = speed["values"]
    log(f"device {info.get('product')} fw {info.get('firmware_version')}; settings {ctx.settings}")
    if turbo["current"].strip().lower() != "manual":
        raise RuntimeError("Turbo Control must be Manual for the speed stages; use --turbo-off-check to test Off")
    return {"info": info, "settings": dict(ctx.settings), "speed_options": speed["values"], "turbo_values": turbo["values"]}


def measure_clock_rate(device: Device, seconds: float, rate_hz: float) -> dict:
    t0, c0 = device.next_tick()
    g0 = device.counter() / rate_hz
    time.sleep(seconds)
    t1, c1 = device.next_tick(timeout=max(3.0, seconds))
    g1 = device.counter() / rate_hz
    return {"clock_rate": rate_between((t0, c0), (t1, c1)), "truth_rate": rate_between((t0, g0), (t1, g1)),
            "clock_s": c1, "truth_s": round(g1, 2)}


def stage_clock(ctx: Context) -> dict:
    out = {}
    device = ctx.device
    for video in ("PAL", "NTSC"):
        rate_hz = PLAY_RATE_HZ[video]
        device.sidplay(build_counter_psid(video, busy_loops=200), f"counter-{video}.sid")
        normal = measure_clock_rate(device, 4.0, rate_hz)
        device.key("press", FAST_FORWARD_KEY)
        try:
            fast = measure_clock_rate(device, 3.0, rate_hz)
        finally:
            device.key("release", FAST_FORWARD_KEY)
        _, shown = device.next_tick()
        truth = device.counter() / rate_hz
        out[video] = {"normal": normal, "fast_forward": fast, "after_clock_s": shown, "after_truth_s": round(truth, 2)}
        log(f"clock {video}: normal clock {normal['clock_rate']:.2f}x truth {normal['truth_rate']:.2f}x; "
            f"FF clock {fast['clock_rate']:.1f}x truth {fast['truth_rate']:.1f}x; after FF clock {shown}s truth {truth:.1f}s")
    return out


def stage_rates(ctx: Context) -> dict:
    out = {}
    device = ctx.device
    for tune in ctx.tunes:
        device.sidplay(tune.read_bytes(), tune.name)
        rows = []
        device.key("press", FAST_FORWARD_KEY)
        try:
            measured = [option_for_mhz(ctx.speed_options, mhz) for mhz in MEASURED_MHZ]
            for option in [o for o in measured if o is not None]:
                put_ms = device.set_config(CPU_SPEED, option)
                readback = device.config_item(CPU_SPEED)["current"]
                latency = [round(device.timed(lambda: device.readmem(0x0400, 1))) for _ in range(5)]
                a = device.next_tick()
                time.sleep(1.5)
                b = device.next_tick()
                rate = rate_between(a, b)
                rows.append({"mhz": cpu_speed_mhz(option), "put_ms": round(put_ms), "readback": readback,
                             "rest_ms_after": latency, "rate": round(rate, 1)})
                log(f"rates {tune.name}: {option.strip():>2} MHz -> {rate:6.1f}x  put {put_ms:.0f} ms  REST after {latency}")
        finally:
            device.key("release", FAST_FORWARD_KEY)
            device.set_config(CPU_SPEED, ctx.base_option())
        out[tune.name] = rows
    return out


def stage_ramp(ctx: Context) -> dict:
    """Hold for len(ramp)+2 seconds, stepping the CPU once a second, and sample the clock."""
    out = {}
    device = ctx.device
    for tune in ctx.tunes[:1]:
        device.sidplay(tune.read_bytes(), tune.name)
        schedule = ramp_options(ctx.speed_options, cpu_speed_mhz(ctx.base_option()) or 1)
        samples = []
        start_wall, start_clock = device.next_tick()
        device.key("press", FAST_FORWARD_KEY)
        try:
            for second in range(len(schedule) + 2):
                if 1 <= second <= len(schedule):
                    device.set_config(CPU_SPEED, schedule[second - 1])
                deadline = start_wall + second + 1
                while time.monotonic() < deadline:
                    samples.append((round(time.monotonic() - start_wall, 3), device.clock()))
                    time.sleep(0.05)
        finally:
            device.key("release", FAST_FORWARD_KEY)
            device.set_config(CPU_SPEED, ctx.base_option())
        per_second = []
        for second in range(len(schedule) + 2):
            window = [c for t, c in samples if second <= t < second + 1 and c is not None]
            if window:
                per_second.append(window[-1] - window[0])
        out[tune.name] = {"start_clock": start_clock, "advance_per_second": per_second, "schedule": schedule}
        log(f"ramp {tune.name}: tune seconds gained per held second {per_second}")
    return out


def restart_tune(device: Device) -> float:
    """Restart the sub tune with the player's own keys; returns how long until the clock showed 0."""
    started = time.monotonic()
    device.tap("minus")
    time.sleep(0.05)
    device.tap("plus")
    device.wait_clock(lambda v: v == 0, 5.0)
    return time.monotonic() - started


RATE_RATIO_LOWER = [(1, 1.0), (2, 0.75), (4, 3.0), (8, 5.7), (16, 9.0), (32, 15.8), (64, 21.0)]
RATE_WINDOW_S = 0.15
RATE_WINDOW_MIN_CLOCK_S = 4
RELEASE_MARGIN_S = 0.05
RATE_SAFETY_FACTOR = 1.3
FINAL_APPROACH_READS = 1.5
POLL_MIN_INTERVAL_S = 0.03


def lower_ratio(mhz: float) -> float:
    table = RATE_RATIO_LOWER
    if mhz <= table[0][0]:
        return table[0][1]
    for (low_mhz, low), (high_mhz, high) in zip(table, table[1:]):
        if mhz <= high_mhz:
            return low + (high - low) * (mhz - low_mhz) / (high_mhz - low_mhz)
    return table[-1][1]


class JumpSpeedPlanner:
    """The app's planner (src/lib/playback/remoteSeek/remoteSeekPlan.ts), kept identical so this
    tool measures the algorithm the app runs: start at the base speed, measure the tune's rate, and
    bound every other speed's rate from above (the clock ratio upwards, the least measured ratio
    downwards). A measurement never lowers a bound, because the first CPU Speed change after a tune
    starts can take a second to apply and a rate measured meanwhile is far too low."""

    def __init__(self, options: list[str], base: str) -> None:
        speeds = sorted({m for m in (cpu_speed_mhz(o) for o in options) if m is not None})
        base_mhz = cpu_speed_mhz(base) or 1
        faster = [option_for_mhz(options, mhz) for mhz in (speeds[-1], 4) if mhz > base_mhz]
        self.tiers = list(dict.fromkeys(o for o in faster if o)) + [base]
        self.base = base
        self.measured: dict[str, float] = {}
        self.slowest_chosen = 0

    def rate_bound(self, option: str) -> float | None:
        mhz = cpu_speed_mhz(option) or 1
        bounds = [rate * RATE_SAFETY_FACTOR * (1 if o == option else mhz / lower_ratio(cpu_speed_mhz(o) or 1))
                  for o, rate in self.measured.items()]
        return max(bounds) if bounds else None

    def choose(self, remaining_clock_s: float, read_period_s: float) -> str:
        if not self.measured:
            return self.base
        lead = 2 * read_period_s + RELEASE_MARGIN_S
        for index in range(self.slowest_chosen, len(self.tiers)):
            rate = self.rate_bound(self.tiers[index])
            if rate is not None and remaining_clock_s >= rate * lead:
                self.slowest_chosen = index
                return self.tiers[index]
        self.slowest_chosen = len(self.tiers) - 1
        return self.base


def seek(device: Device, options: list[str], clock_per_tune_s: float, from_tune_s: float, target_tune_s: float,
         base: str, write_interval_s: float = 0.0) -> dict:
    """The app's jump (RemoteSidSeekController.jumpTo): restart when going back, then the planner's
    speeds, with the key released before every CPU Speed change. `write_interval_s` reproduces the
    app's config write queue, which can hold a speed change back."""
    started = time.monotonic()
    restart_s = 0.0
    if target_tune_s < from_tune_s:
        restart_s = restart_tune(device)
        from_tune_s = 0.0
    planner = JumpSpeedPlanner(options, base)
    last_clock = device.clock() or 0
    position = from_tune_s
    speed, held, window, fast_since_last_read = base, False, None, False
    read_period, last_read = 0.06, 0.0
    speeds_used = []
    deadline = time.monotonic() + 30
    try:
        while position < target_tune_s:
            if time.monotonic() > deadline:
                raise RuntimeError(f"jump to {target_tune_s}s did not land within 30 s")
            wait = POLL_MIN_INTERVAL_S - (time.monotonic() - last_read)
            if wait > 0:
                time.sleep(wait)
            read_started = time.monotonic()
            clock = device.clock()
            now = time.monotonic()
            read_period = 0.7 * read_period + 0.3 * (POLL_MIN_INTERVAL_S + now - read_started)
            last_read = now
            if clock is None:
                continue
            delta = max(0, clock - last_clock)
            last_clock = clock
            position += delta / clock_per_tune_s if held or fast_since_last_read else delta
            fast_since_last_read = held
            if position >= target_tune_s:
                break
            if held and window is None:
                window = (now, clock)
            elif held and now - window[0] >= RATE_WINDOW_S and clock - window[1] >= RATE_WINDOW_MIN_CLOCK_S:
                planner.measured[speed] = (clock - window[1]) / (now - window[0])
            remaining = (target_tune_s - position) * clock_per_tune_s
            base_rate = planner.measured.get(speed) if speed == base else None
            if held and base_rate and remaining < base_rate * read_period * FINAL_APPROACH_READS:
                time.sleep(max(0.0, remaining / base_rate - read_period / 2))
                device.key("release", FAST_FORWARD_KEY)
                held = False
                settled = device.clock()
                if settled is not None:
                    position += max(0, settled - last_clock) / clock_per_tune_s
                break
            wanted = planner.choose(remaining, read_period)
            if wanted != speed:
                if held:
                    device.key("release", FAST_FORWARD_KEY)
                    held = False
                    fast_since_last_read = True
                time.sleep(write_interval_s)
                device.set_config(CPU_SPEED, wanted)
                speeds_used.append(cpu_speed_mhz(wanted))
                speed, window = wanted, None
                continue
            if not held:
                device.key("press", FAST_FORWARD_KEY)
                held = True
    finally:
        device.key("release", FAST_FORWARD_KEY)
        if speed != base:
            device.set_config(CPU_SPEED, base)
    return {"from_s": from_tune_s, "target_s": target_tune_s, "model_s": round(position, 2),
            "restart_s": round(restart_s, 2), "wall_s": round(time.monotonic() - started, 2),
            "speeds_mhz": speeds_used, "measured": {k.strip(): round(v) for k, v in planner.measured.items()},
            "clock_after": device.clock()}


def snap_call_rate(raw_hz: float) -> float:
    """Play calls per second, snapped down to a multiple of 50 or 60 Hz within 10%.

    The largest sampled timer value can only undershoot the latch, so the raw rate can only be high:
    the candidate is the largest multiple at or below it (2% allowed for rounding).
    """
    candidates = [base * k for base in (50.0, 60.0) for k in range(1, 9) if base * k <= raw_hz * 1.02]
    if not candidates:
        return raw_hz
    best = max(candidates)
    return best if raw_hz / best <= 1.10 else raw_hz


def measure_call_rate(device: Device, cia_clock_hz: float, samples: int = 60) -> tuple[float, float]:
    """The tune's play-call rate from CIA 1 timer A: its largest sampled value approximates the latch."""
    highest = 0
    for _ in range(samples):
        raw = device.readmem(0xDC04, 2)
        highest = max(highest, raw[0] | (raw[1] << 8))
    raw_hz = cia_clock_hz / (highest + 1) if highest else 0.0
    return raw_hz, snap_call_rate(raw_hz)


def stage_seek(ctx: Context, write_interval_s: float = 0.0) -> dict:
    device = ctx.device
    base = ctx.base_option()
    frame_hz, cia_hz = 50.0, 985248.0
    out = {"write_interval_s": write_interval_s, "counter": [], "tunes": {}}
    variants = [("PAL VBI", "PAL", None), ("NTSC VBI", "NTSC", None), ("PAL CIA 4x", "PAL", 0x1331)]
    for label, video, timer in variants:
        device.sidplay(build_counter_psid(video, busy_loops=200, cia_timer=timer), "counter.sid")
        raw_hz, call_hz = measure_call_rate(device, cia_hz)
        exact_hz = PLAY_RATE_HZ[video] if timer is None else cia_hz / (timer + 1)
        for target in (45.0, 200.0, 30.0, 120.0):
            truth_before = device.counter() / exact_hz
            row = seek(device, ctx.speed_options, call_hz / frame_hz, truth_before, target, base, write_interval_s)
            truth = device.counter() / exact_hz
            row.update({"variant": label, "call_hz_raw": round(raw_hz, 1), "call_hz": call_hz,
                        "truth_after_s": round(truth, 2), "error_s": round(truth - target, 2)})
            out["counter"].append(row)
            log(f"seek {label:10s} ({raw_hz:5.1f}->{call_hz:.0f} Hz) {truth_before:6.1f} -> {target:5.0f}s: "
                f"wall {row['wall_s']:4.2f}s restart {row['restart_s']:.2f}s speeds {row['speeds_mhz']} "
                f"measured {row['measured']} truth {truth:6.1f} error {row['error_s']:+.2f}s")
    for tune in ctx.tunes:
        device.sidplay(tune.read_bytes(), tune.name)
        raw_hz, call_hz = measure_call_rate(device, cia_hz)
        rows = []
        position = float(device.clock() or 0)
        for target in (60.0, 20.0, 150.0, 90.0):
            row = seek(device, ctx.speed_options, call_hz / frame_hz, position, target, base, write_interval_s)
            position = row["model_s"]
            rows.append(row)
            log(f"seek {tune.name} ({call_hz:.0f} Hz) -> {target:5.0f}s: wall {row['wall_s']:4.2f}s "
                f"speeds {row['speeds_mhz']} measured {row['measured']} clock after {row['clock_after']}")
        out["tunes"][tune.name] = rows
    return out


def stage_turbo_off(ctx: Context) -> dict:
    device = ctx.device
    rows = []

    def probe(label: str, put_ms: float) -> None:
        latency = []
        for _ in range(10):
            try:
                latency.append(round(device.timed(lambda: device.readmem(0x0400, 1))))
            except Exception as error:  # noqa: BLE001 - reported, the stage measures availability
                latency.append(f"error: {error}")
            time.sleep(0.1)
        rows.append({"step": label, "put_ms": round(put_ms), "rest_ms_after": latency})
        log(f"turbo-off {label}: put {put_ms:.0f} ms REST after {latency}")

    original = ctx.settings[TURBO_CONTROL]
    try:
        for cycle in range(3):
            probe(f"{cycle}: Turbo Control Off", device.set_config(TURBO_CONTROL, "Off"))
            probe(f"{cycle}: Turbo Control Manual", device.set_config(TURBO_CONTROL, "Manual"))
            probe(f"{cycle}: CPU Speed max", device.set_config(CPU_SPEED, ctx.max_option()))
            probe(f"{cycle}: CPU Speed base", device.set_config(CPU_SPEED, ctx.base_option()))
    finally:
        device.set_config(CPU_SPEED, ctx.base_option())
        device.set_config(TURBO_CONTROL, original)
    return {"rows": rows}


STAGES = {
    "clock": stage_clock,
    "rates": stage_rates,
    "ramp": stage_ramp,
    "seek": stage_seek,
    "turbo-off": stage_turbo_off,
}


def restore(ctx: Context) -> dict:
    device = ctx.device
    device.key("release", FAST_FORWARD_KEY, "minus", "plus")
    if ctx.settings:
        device.set_config(CPU_SPEED, ctx.settings[CPU_SPEED])
        device.set_config(TURBO_CONTROL, ctx.settings[TURBO_CONTROL])
    readback = {TURBO_CONTROL: device.config_item(TURBO_CONTROL)["current"], CPU_SPEED: device.config_item(CPU_SPEED)["current"]}
    device.reset()
    restored = not ctx.settings or readback == ctx.settings
    log(f"restore: {readback} {'matches' if restored else 'DOES NOT MATCH'} the snapshot; held keys {device.held_keys()}")
    return {"readback": readback, "restored": restored}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="c64u")
    parser.add_argument("--tune", action="append", default=[], type=Path, help="a PSID to measure (repeatable)")
    parser.add_argument("--only", default="", help="comma-separated stages")
    parser.add_argument("--turbo-off-check", action="store_true")
    parser.add_argument("--write-interval-ms", type=int, default=500,
                        help="delay before each CPU Speed write in the seek stage, as the app's config write queue adds")
    parser.add_argument("--json", type=Path)
    args = parser.parse_args(argv)

    ctx = Context(device=Device(args.host), tunes=args.tune)
    selected = [s for s in args.only.split(",") if s] or [s for s in STAGES if s != "turbo-off"]
    if args.turbo_off_check and "turbo-off" not in selected:
        selected.append("turbo-off")
    failed = False
    try:
        ctx.results["preflight"] = stage_preflight(ctx)
        for name in selected:
            try:
                if name == "seek":
                    ctx.results[name] = stage_seek(ctx, args.write_interval_ms / 1000)
                else:
                    ctx.results[name] = STAGES[name](ctx)
            except Exception as error:  # noqa: BLE001 - one stage failing must not skip the others
                failed = True
                ctx.results[name] = {"error": f"{type(error).__name__}: {error}"}
                log(f"stage {name} FAILED: {error}")
    finally:
        ctx.results["restore"] = restore(ctx)
        if args.json:
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(json.dumps(ctx.results, indent=2, default=str))
    return 1 if failed or not ctx.results["restore"]["restored"] else 0


if __name__ == "__main__":
    sys.exit(main())
