#!/usr/bin/env python3
"""
Round-trip verification: write a known pattern to the C64 Ultimate RAM,
read it back, and compare byte-by-byte.

The I/O region $D000-$DFFF is excluded from comparison because reads
return hardware register values, not the underlying RAM.

Usage:
    python3 scripts/ram_roundtrip_verify.py [--host HOST]

Defaults to http://c64u.  Pass --host to override.
"""

import argparse
import subprocess
import sys
import time

BLOCK_SIZE = 4096
BLOCKS = 16
TOTAL_SIZE = BLOCK_SIZE * BLOCKS

# I/O region: reads return register values, not RAM
IO_START = 0xD000
IO_END = 0xE000


def log(msg: str):
    print(msg, flush=True)


def curl_get(url: str) -> bytes:
    p = subprocess.run(
        ["curl", "-sS", url],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return p.stdout


def curl_put(url: str):
    subprocess.run(
        ["curl", "-sS", "-X", "PUT", url],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def curl_post(url: str, data: bytes):
    subprocess.run(
        ["curl", "-sS", "-X", "POST", "--data-binary", "@-", url],
        input=data,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def pause(base: str):
    log("  Pausing C64…")
    curl_put(f"{base}/v1/machine:pause")


def resume(base: str):
    log("  Resuming C64…")
    curl_put(f"{base}/v1/machine:resume")


def build_pattern() -> bytes:
    """Address-as-data pattern: byte[i] = i & 0xFF."""
    return bytes(i & 0xFF for i in range(TOTAL_SIZE))


def write_all(base: str, data: bytes):
    log(f"  Writing {len(data)} bytes at $0000…")
    curl_post(f"{base}/v1/machine:writemem?address=0000", data)


def read_all(base: str) -> bytes:
    log(f"  Reading {TOTAL_SIZE} bytes in {BLOCKS} x {BLOCK_SIZE} chunks…")
    chunks: list[bytes] = []
    for i in range(BLOCKS):
        addr = i * BLOCK_SIZE
        addr_hex = f"{addr:04x}"
        chunk = curl_get(
            f"{base}/v1/machine:readmem?address={addr_hex}&length={BLOCK_SIZE}"
        )
        if len(chunk) != BLOCK_SIZE:
            raise RuntimeError(
                f"Short read at ${addr_hex}: expected {BLOCK_SIZE}, got {len(chunk)}"
            )
        chunks.append(chunk)
    return b"".join(chunks)


def compare(expected: bytes, actual: bytes) -> list[tuple[int, int, int]]:
    """Return list of (address, expected_byte, actual_byte) mismatches,
    excluding the I/O region."""
    mismatches: list[tuple[int, int, int]] = []
    for i in range(TOTAL_SIZE):
        if IO_START <= i < IO_END:
            continue
        if expected[i] != actual[i]:
            mismatches.append((i, expected[i], actual[i]))
    return mismatches


def main():
    parser = argparse.ArgumentParser(description="RAM round-trip verification")
    parser.add_argument(
        "--host",
        default="http://c64u",
        help="C64 Ultimate base URL (default: http://c64u)",
    )
    args = parser.parse_args()
    base = args.host.rstrip("/")

    log(f"RAM round-trip verification against {base}")
    log("")

    pattern = build_pattern()

    # Phase 1: write pattern
    log("[1/3] Writing test pattern…")
    pause(base)
    t0 = time.monotonic_ns()
    write_all(base, pattern)
    resume(base)
    write_ms = (time.monotonic_ns() - t0) // 1_000_000
    log(f"  Write completed in {write_ms} ms")
    log("")

    # Phase 2: read back
    log("[2/3] Reading back…")
    pause(base)
    t0 = time.monotonic_ns()
    readback = read_all(base)
    resume(base)
    read_ms = (time.monotonic_ns() - t0) // 1_000_000
    log(f"  Read completed in {read_ms} ms")
    log("")

    # Phase 3: compare
    log("[3/3] Comparing (excluding I/O region $D000-$DFFF)…")
    mismatches = compare(pattern, readback)
    compared = TOTAL_SIZE - (IO_END - IO_START)

    if mismatches:
        log(f"  FAIL: {len(mismatches)} mismatch(es) in {compared} compared bytes")
        for addr, exp, act in mismatches[:20]:
            log(f"    ${addr:04X}: expected 0x{exp:02X}, got 0x{act:02X}")
        if len(mismatches) > 20:
            log(f"    … and {len(mismatches) - 20} more")
        sys.exit(1)
    else:
        log(f"  PASS: all {compared} compared bytes match")
        log("")
        log("Round-trip verification succeeded.")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr, flush=True)
        sys.exit(1)
