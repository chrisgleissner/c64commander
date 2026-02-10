#!/usr/bin/env python3

import os
import time
import subprocess
import sys

BASE_URL = "http://c64u"
IN_FILE = "ram.bin"
TOTAL_SIZE = 64 * 1024

def log(msg: str):
    print(msg, flush=True)

def run(cmd, data=None):
    subprocess.run(
        cmd,
        input=data,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

def pause():
    log("[1] Pausing C64 …")
    run(["curl", "-sS", "-X", "PUT", f"{BASE_URL}/v1/machine:pause"])
    log("[1] Pause acknowledged")

def resume():
    log("[4] Resuming C64 …")
    run(["curl", "-sS", "-X", "PUT", f"{BASE_URL}/v1/machine:resume"])
    log("[4] Resume acknowledged")

def write_all(data: bytes):
    log(f"[3] Writing {len(data)} bytes to address 0000 in ONE request …")
    run(
        [
            "curl",
            "-sS",
            "-X",
            "POST",
            "--data-binary",
            "@-",
            f"{BASE_URL}/v1/machine:writemem?address=0000",
        ],
        data=data,
    )
    log("[3] Write request completed")

def main():
    log("[0] writemem_64kb.py starting")

    if not os.path.isfile(IN_FILE):
        raise RuntimeError(f"Input file not found: {IN_FILE}")

    size = os.path.getsize(IN_FILE)
    log(f"[0] Found {IN_FILE} ({size} bytes)")

    if size != TOTAL_SIZE:
        raise RuntimeError(
            f"{IN_FILE} must be exactly {TOTAL_SIZE} bytes (got {size})"
        )

    with open(IN_FILE, "rb") as f:
        ram = f.read()

    log("[0] RAM image loaded into memory")

    pause()

    start_ns = time.time_ns()

    write_all(ram)

    end_ns = time.time_ns()
    elapsed_ms = (end_ns - start_ns) // 1_000_000

    log(f"[3] Total write time: {elapsed_ms} ms")

    resume()

    log("[5] Done. RAM write completed successfully")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr, flush=True)
        sys.exit(1)

