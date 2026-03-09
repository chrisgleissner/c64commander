#!/usr/bin/env python3
"""
Full RAM operations test against real C64U device.
This test mimics exactly what the TypeScript app does:
1. Write a unique string to screen buffer at address 1024 ($0400)
2. Save the entire memory (64KB)
3. Overwrite the string
4. Verify it was overwritten
5. Restore the memory snapshot
6. Verify the original string is back

This test verifies the Save RAM / Load RAM functionality.
"""

import subprocess
import sys
import time
import os

BASE_URL = "http://c64u"
SCREEN_BUFFER = 1024  # $0400
FULL_RAM = 65536
BLOCK_SIZE = 4096

def run(cmd, data=None, check=True):
    """Run a command and return stdout."""
    result = subprocess.run(
        cmd,
        input=data,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if check and result.returncode != 0:
        print(f"Command failed: {' '.join(cmd)}")
        print(f"stderr: {result.stderr.decode()}")
        raise RuntimeError(f"Command failed with code {result.returncode}")
    return result.stdout

def pause():
    print("[1] Pausing C64...")
    run(["curl", "-sS", "-X", "PUT", f"{BASE_URL}/v1/machine:pause"])
    print("[1] Pause acknowledged")

def resume():
    print("[2] Resuming C64...")
    run(["curl", "-sS", "-X", "PUT", f"{BASE_URL}/v1/machine:resume"])
    print("[2] Resume acknowledged")

def write_memory(address: int, data: bytes):
    """Write bytes to memory using POST with binary body (like TypeScript does)."""
    addr_hex = f"{address:04x}"
    print(f"[3] Writing {len(data)} bytes to ${addr_hex} using POST...")
    run(
        [
            "curl",
            "-sS",
            "-X",
            "POST",
            "--data-binary",
            "@-",
            f"{BASE_URL}/v1/machine:writemem?address={addr_hex}",
        ],
        data=data,
    )
    print(f"[3] Write completed")

def read_memory(address: int, length: int) -> bytes:
    """Read bytes from memory."""
    addr_hex = f"{address:04x}"
    result = run([
        "curl",
        "-sS",
        f"{BASE_URL}/v1/machine:readmem?address={addr_hex}&length={length}",
    ])
    return result

def read_full_ram() -> bytes:
    """Read full 64KB RAM in 4KB blocks (like TypeScript does)."""
    print("[4] Reading full RAM in 4KB blocks...")
    data = bytearray(65536)
    for i in range(16):
        addr = i * BLOCK_SIZE
        block = read_memory(addr, BLOCK_SIZE)
        if len(block) != BLOCK_SIZE:
            raise RuntimeError(f"Short read at ${addr:04x}: got {len(block)} bytes, expected {BLOCK_SIZE}")
        data[addr:addr + BLOCK_SIZE] = block
        print(f"[4] Read block {i+1}/16 at ${addr:04x}")
    print(f"[4] Read {len(data)} bytes total")
    return bytes(data)

def write_full_ram(data: bytes):
    """Write full 64KB RAM in one request (like TypeScript does)."""
    print(f"[5] Writing full RAM ({len(data)} bytes) in single POST request...")
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
    print("[5] Write completed")

def verify_screen(expected: bytes, step: str):
    """Verify screen buffer contains expected bytes."""
    screen = read_memory(SCREEN_BUFFER, len(expected))
    expected_hex = expected.hex()
    actual_hex = screen.hex()
    print(f"[6] {step}: screen buffer = {actual_hex}, expected = {expected_hex}")
    if screen != expected:
        raise RuntimeError(f"Screen buffer mismatch at {step}!")
    print(f"[6] {step}: VERIFIED OK")

def main():
    print("=" * 60)
    print("Full RAM Operations Test (Mimics TypeScript Implementation)")
    print("=" * 60)
    print()

    # Unique test string - "TEST" in PETSCII (uppercase)
    test_string = bytes([0x54, 0x45, 0x53, 0x54])  # "TEST"
    overwrite_string = bytes([0x58, 0x58, 0x58, 0x58])  # "XXXX"

    # Step 1: Write test string to screen buffer
    pause()
    write_memory(SCREEN_BUFFER, test_string)
    verify_screen(test_string, "After initial write")
    resume()

    # Step 2: Save full RAM
    pause()
    ram_snapshot = read_full_ram()
    resume()

    # Verify snapshot contains our test string
    snapshot_screen = ram_snapshot[SCREEN_BUFFER:SCREEN_BUFFER + 4]
    print(f"[7] Snapshot screen buffer: {snapshot_screen.hex()} (expected: {test_string.hex()})")
    if snapshot_screen != test_string:
        print("ERROR: Snapshot doesn't contain test string!")
        sys.exit(1)
    print("[7] Snapshot verified OK")

    # Step 3: Overwrite the test string
    pause()
    write_memory(SCREEN_BUFFER, overwrite_string)
    verify_screen(overwrite_string, "After overwrite")
    resume()

    # Step 4: Restore RAM snapshot
    pause()
    write_full_ram(ram_snapshot)
    resume()

    # Step 5: Verify restoration
    pause()
    verify_screen(test_string, "After restore")
    resume()

    print()
    print("=" * 60)
    print("ALL TESTS PASSED - RAM Save/Load works correctly!")
    print("=" * 60)

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
