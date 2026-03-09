#!/usr/bin/env python3
"""
Test if uppercase vs lowercase addresses matter for C64U API.
"""

import subprocess
import sys

BASE_URL = "http://c64u"

def run(cmd, data=None):
    result = subprocess.run(cmd, input=data, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    return result.stdout

def test_read(address_hex):
    """Test read with given address format."""
    url = f"{BASE_URL}/v1/machine:readmem?address={address_hex}&length=4"
    result = run(["curl", "-sS", url])
    return result

def test_write(address_hex, data):
    """Test write with given address format using POST."""
    url = f"{BASE_URL}/v1/machine:writemem?address={address_hex}"
    run(["curl", "-sS", "-X", "POST", "--data-binary", "@-", url], data=data)

def main():
    print("=== Testing Uppercase vs Lowercase Addresses ===\n")

    # Pause first
    run(["curl", "-sS", "-X", "PUT", f"{BASE_URL}/v1/machine:pause"])
    print("Paused C64")

    # Test 1: Write with lowercase, read with lowercase
    print("\n[1] Write with lowercase '0400', read with lowercase '0400'")
    test_write("0400", bytes([0x11, 0x22, 0x33, 0x44]))
    result = test_read("0400")
    print(f"    Result: {result.hex()} (expected: 11223344)")

    # Test 2: Write with uppercase, read with lowercase
    print("\n[2] Write with uppercase '0400', read with lowercase '0400'")
    test_write("0400", bytes([0x55, 0x66, 0x77, 0x88]))
    result = test_read("0400")
    print(f"    Result: {result.hex()} (expected: 55667788)")

    # Test 3: Write with lowercase, read with uppercase
    print("\n[3] Write with lowercase '0400', read with uppercase '0400'")
    test_write("0400", bytes([0xAA, 0xBB, 0xCC, 0xDD]))
    result = test_read("0400")
    print(f"    Result: {result.hex()} (expected: aabbccdd)")

    # Test 4: Write with uppercase, read with uppercase
    print("\n[4] Write with uppercase '0400', read with uppercase '0400'")
    test_write("0400", bytes([0x54, 0x45, 0x53, 0x54]))  # TEST
    result = test_read("0400")
    print(f"    Result: {result.hex()} (expected: 54455354)")

    # Resume
    run(["curl", "-sS", "-X", "PUT", f"{BASE_URL}/v1/machine:resume"])
    print("\nResumed C64")

    print("\n=== All tests completed ===")

if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
