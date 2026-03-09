#!/usr/bin/env python3
"""
Test script to verify RAM operations against C64U device.
Tests: write to screen buffer, save RAM, overwrite, restore, verify.
"""

import subprocess
import sys
import time

BASE_URL = "http://c64u"
SCREEN_BUFFER = 1024  # $0400
FULL_RAM = 65536

def run(cmd, data=None):
    """Run a command and return stdout."""
    result = subprocess.run(
        cmd,
        input=data,
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
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
    """Write bytes to memory using POST with binary body."""
    addr_hex = f"{address:04x}"
    print(f"[3] Writing {len(data)} bytes to ${addr_hex}...")
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
    """Read full 64KB RAM in 4KB blocks."""
    print("[4] Reading full RAM...")
    data = bytearray(65536)
    block_size = 4096
    for i in range(16):
        addr = i * block_size
        block = read_memory(addr, block_size)
        data[addr:addr + block_size] = block
    print(f"[4] Read {len(data)} bytes")
    return bytes(data)

def write_full_ram(data: bytes):
    """Write full 64KB RAM in one request."""
    print(f"[5] Writing full RAM ({len(data)} bytes)...")
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

def main():
    print("=== RAM Operations Test ===")
    print()

    # Unique test string - "TEST" in PETSCII (uppercase)
    # PETSCII uppercase T=0x54, E=0x45, S=0x53, T=0x54
    test_string = bytes([0x54, 0x45, 0x53, 0x54])  # "TEST"
    overwrite_string = bytes([0x58, 0x58, 0x58, 0x58])  # "XXXX"

    # Step 1: Write test string to screen buffer
    pause()
    write_memory(SCREEN_BUFFER, test_string)

    # Verify write
    screen_data = read_memory(SCREEN_BUFFER, 4)
    print(f"[6] Screen buffer after write: {screen_data.hex()} (expected: {test_string.hex()})")
    if screen_data != test_string:
        print(f"ERROR: Initial write failed!")
        resume()
        sys.exit(1)
    print("[6] Initial write verified OK")
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
    screen_data = read_memory(SCREEN_BUFFER, 4)
    print(f"[8] Screen buffer after overwrite: {screen_data.hex()} (expected: {overwrite_string.hex()})")
    if screen_data != overwrite_string:
        print("ERROR: Overwrite failed!")
        resume()
        sys.exit(1)
    print("[8] Overwrite verified OK")
    resume()

    # Step 4: Restore RAM snapshot
    pause()
    write_full_ram(ram_snapshot)
    resume()

    # Step 5: Verify restoration
    pause()
    restored_screen = read_memory(SCREEN_BUFFER, 4)
    print(f"[9] Screen buffer after restore: {restored_screen.hex()} (expected: {test_string.hex()})")
    if restored_screen != test_string:
        print("ERROR: Restore failed! Screen buffer doesn't match original!")
        resume()
        sys.exit(1)
    print("[9] Restore verified OK - original string is back!")
    resume()

    print()
    print("=== ALL TESTS PASSED ===")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
