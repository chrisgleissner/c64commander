#!/usr/bin/env python3

import time
import subprocess
import sys

BASE_URL = "http://c64u"
BLOCK_SIZE = 4096
BLOCKS = 16
OUT_FILE = "ram.bin"

def curl(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.PIPE)

def pause():
    print("Pausing C64…")
    curl(["curl", "-sS", "-X", "PUT", f"{BASE_URL}/v1/machine:pause"])

def resume():
    print("Resuming C64…")
    curl(["curl", "-sS", "-X", "PUT", f"{BASE_URL}/v1/machine:resume"])

def read_block(addr_hex):
    p = subprocess.run(
        [
            "curl",
            "-sS",
            f"{BASE_URL}/v1/machine:readmem?address={addr_hex}&length={BLOCK_SIZE}",
        ],
        check=True,
        stdout=subprocess.PIPE,
    )
    if len(p.stdout) != BLOCK_SIZE:
        raise RuntimeError(
            f"Short read at {addr_hex}: got {len(p.stdout)} bytes"
        )
    return p.stdout

def main():
    print("Sequential C64 RAM dump (64 KiB, 4 KiB blocks)")
    pause()

    start_ns = time.time_ns()

    with open(OUT_FILE, "wb") as out:
        for i in range(BLOCKS):
            addr = i * BLOCK_SIZE
            addr_hex = f"{addr:04x}"
            out.write(read_block(addr_hex))

    end_ns = time.time_ns()
    elapsed_ms = (end_ns - start_ns) // 1_000_000

    resume()

    print(f"Done. Total read time: {elapsed_ms} ms")
    print(f"Output written to: {OUT_FILE}")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)

