#!/usr/bin/env python3
#
# C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
# Copyright (C) 2026 Christian Gleissner
#
# Licensed under the GNU General Public License v3.0 or later.
# See <https://www.gnu.org/licenses/> for details.
#
"""REST latency under the request mix a remote SID seek produces, measured on a real Ultimate.

Each phase runs request streams side by side for a fixed time and reports per stream the latency
percentiles, the slowest requests and failures: clock reads alone, then with fast forward key
presses, with CPU Speed writes, and all together.

The keys only ever reach the SID player. The tool starts a silent counter tune itself, and a guard
thread re-reads the player's clock every 100 ms. A key press is sent only while the guard saw the
clock within the last 300 ms. The moment the clock is gone, the guard releases the key and the run
stops. Vol Master is muted for the run; CPU Speed, Turbo Control and Vol Master are put back at the
end, however the run ends.

    python3 tools/hil/remote_seek_rest_load.py --host u64 --seconds 60 --json artifacts/rest-load-u64.json
"""

from __future__ import annotations

import argparse
import http.client
import json
import sys
import threading
import time
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from remote_sid_seek_poc import (
    CLOCK_OFFSET,
    CPU_SPEED,
    FAST_FORWARD_KEY,
    TURBO_CONTROL,
    U64_CATEGORY,
    Device,
    build_counter_psid,
)

AUDIO_MIXER = "Audio Mixer"
VOL_MASTER = "Vol Master"
GUARD_PERIOD_S = 0.1
PLAYER_SEEN_WITHIN_S = 0.3


class PlayerGuard(threading.Thread):
    """Watches the SID player's clock; `confirmed()` is False once it has not been seen recently."""

    def __init__(self, device: Device, host: str) -> None:
        super().__init__(daemon=True)
        self.device = device
        self.host = host
        self.seen_at = time.monotonic()
        self.lost = threading.Event()
        self.stopping = threading.Event()

    def run(self) -> None:
        while not self.stopping.is_set():
            try:
                if self.device.clock() is not None:
                    self.seen_at = time.monotonic()
            except Exception as error:  # noqa: BLE001 - a failed read counts as not seeing the player
                print(f"guard: clock read failed: {error}", file=sys.stderr)
            if time.monotonic() - self.seen_at > PLAYER_SEEN_WITHIN_S * 3:
                self.lost.set()
                release_key(self.host)
                return
            time.sleep(GUARD_PERIOD_S)

    def confirmed(self) -> bool:
        return not self.lost.is_set() and time.monotonic() - self.seen_at <= PLAYER_SEEN_WITHIN_S


def key_body(transition: str) -> str:
    return json.dumps({"events": [{"kind": "keyboard", "inputs": [FAST_FORWARD_KEY], "transition": transition}]})


def release_key(host: str) -> None:
    connection = http.client.HTTPConnection(host, timeout=10)
    connection.request("POST", "/v1/machine:input", body=key_body("release"), headers={"Content-Type": "application/json"})
    connection.getresponse().read()
    connection.close()


def stream(host: str, kind: str, rate: float, stop: threading.Event, guard: PlayerGuard, records: list, clock_row: int, speeds: list[str]) -> None:
    connection = http.client.HTTPConnection(host, timeout=12)
    period = 1.0 / rate
    due = time.monotonic()
    index = 0
    while not stop.is_set():
        now = time.monotonic()
        if now < due:
            time.sleep(due - now)
        due += period
        index += 1
        headers: dict[str, str] = {}
        body = None
        if kind == "read":
            method, url = "GET", f"/v1/machine:readmem?address={clock_row:04X}&length=40"
        elif kind == "key":
            press = index % 2 == 1
            if press and not guard.confirmed():
                stop.set()
                break
            method, url = "POST", "/v1/machine:input"
            body = key_body("press" if press else "release")
            headers = {"Content-Type": "application/json"}
        else:
            value = urllib.parse.quote(speeds[index % len(speeds)])
            method, url = "PUT", f"/v1/configs/{urllib.parse.quote(U64_CATEGORY)}/{urllib.parse.quote(CPU_SPEED)}?value={value}"
        started = time.monotonic()
        ok = True
        try:
            connection.request(method, url, body=body, headers=headers)
            response = connection.getresponse()
            response.read()
            ok = response.status < 400
        except Exception as error:  # noqa: BLE001 - every failure is recorded and the connection renewed
            ok = False
            print(f"{kind}: {type(error).__name__}: {error}", file=sys.stderr)
            connection.close()
            connection = http.client.HTTPConnection(host, timeout=12)
        records.append((kind, started, round((time.monotonic() - started) * 1000, 1), ok))
    connection.close()


def summarise(records: list) -> dict:
    out = {}
    for kind in sorted({record[0] for record in records}):
        latencies = sorted(record[2] for record in records if record[0] == kind)
        out[kind] = {
            "n": len(latencies),
            "p50": latencies[len(latencies) // 2],
            "p99": latencies[int(0.99 * (len(latencies) - 1))],
            "max": latencies[-1],
            "over_1s": sum(1 for value in latencies if value > 1000),
            "failed": sum(1 for record in records if record[0] == kind and not record[3]),
        }
    return out


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--host", default="u64")
    parser.add_argument("--seconds", type=float, default=60)
    parser.add_argument("--json", type=Path)
    args = parser.parse_args(argv)

    device = Device(args.host)
    original = {item: device.config_item(item)["current"] for item in (CPU_SPEED, TURBO_CONTROL)}
    volume = device.request("GET", f"/v1/configs/{urllib.parse.quote(AUDIO_MIXER)}/{urllib.parse.quote(VOL_MASTER)}")
    original_volume = json.loads(volume)[AUDIO_MIXER][VOL_MASTER]["current"]
    speeds = [option for option in device.config_item(CPU_SPEED)["values"] if option.strip() in ("1", "4")]
    phases = {
        "clock reads 20/s": [("read", 20)],
        "reads 30/s + fast forward key 4/s": [("read", 30), ("key", 4)],
        "reads 30/s + CPU Speed 2/s": [("read", 30), ("cpu", 2)],
        "reads 30/s + 10/s + key 4/s + CPU Speed 2/s": [("read", 30), ("read", 10), ("key", 4), ("cpu", 2)],
    }
    results: dict = {"host": args.host, "seconds_per_phase": args.seconds, "phases": {}}
    guard: PlayerGuard | None = None
    try:
        device.request("PUT", f"/v1/configs/{urllib.parse.quote(AUDIO_MIXER)}/{urllib.parse.quote(VOL_MASTER)}?value=OFF")
        device.set_config(TURBO_CONTROL, "Manual")
        device.sidplay(build_counter_psid("PAL"), "Rest_Load.sid")
        clock_row = device.screen + CLOCK_OFFSET
        guard = PlayerGuard(device, args.host)
        guard.start()
        for name, spec in phases.items():
            stop = threading.Event()
            records: list = []
            threads = [threading.Thread(target=stream, args=(args.host, kind, rate, stop, guard, records, clock_row, speeds)) for kind, rate in spec]
            for thread in threads:
                thread.start()
            stop.wait(args.seconds)
            stop.set()
            for thread in threads:
                thread.join()
            release_key(args.host)
            summary = summarise(records)
            slowest = sorted(records, key=lambda record: -record[2])[:5]
            results["phases"][name] = {"summary": summary, "slowest": [(kind, ms, ok) for kind, _, ms, ok in slowest]}
            print(name, json.dumps(summary), flush=True)
            if guard.lost.is_set():
                raise RuntimeError("the SID player left the screen; the run stopped and the key was released")
    finally:
        if guard is not None:
            guard.stopping.set()
        release_key(args.host)
        device.set_config(CPU_SPEED, original[CPU_SPEED])
        device.set_config(TURBO_CONTROL, original[TURBO_CONTROL])
        device.request("PUT", f"/v1/configs/{urllib.parse.quote(AUDIO_MIXER)}/{urllib.parse.quote(VOL_MASTER)}?value={urllib.parse.quote(original_volume)}")
        device.reset()
        if args.json:
            args.json.parent.mkdir(parents=True, exist_ok=True)
            args.json.write_text(json.dumps(results, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
