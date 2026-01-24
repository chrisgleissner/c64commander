#!/usr/bin/env python3
"""
Ultimate64 disk runner

Fixes:
- Mounts the specified image into drive A (first drive) using POST /v1/drives/{drive}:mount.
- Determines drive A bus_id via GET /v1/drives and uses that device number in LOAD commands.
- For D64/D71/D81: extracts the first PRG from the disk image locally, DMA-writes it into C64 RAM, then:
    - If it looks like tokenised BASIC at $0801:
        - Sets BASIC pointers (TXTTAB..STREND) to the END OF THE ENTIRE LOADED PAYLOAD (end_addr_exclusive),
          not merely the end of BASIC text - this preserves appended machine code used by SYS stubs.
        - Writes the variable-table empty marker (00 00) at end_addr_exclusive (safe).
        - RUN
    - Otherwise: SYS <load_addr>
- For G64/G71: mounts and LOAD"*",<bus_id>,1 then RUN (classic KERNAL path; no DMA).
"""

from __future__ import annotations

import argparse
import os
import time
from dataclasses import dataclass
from typing import Callable, Optional, Tuple, List, Dict, Any

import requests

SECTOR_SIZE = 256

# 1541 directory entry file type encoding:
# bit 7 = "closed" (set for normal files), bit 6 = "locked", bits 0-2 = type (0=DEL,1=SEQ,2=PRG,3=USR,4=REL)
FILE_TYPE_MASK = 0x07
PRG_TYPE = 0x02

# C64 KERNAL keyboard buffer
KEYBUF_ADDR = 0x0277
KEYBUF_COUNT = 0x00C6
KEYBUF_MAX = 10

# BASIC pointers (zero page)
TXTTAB = 0x002B  # $2B/$2C
VARTAB = 0x002D  # $2D/$2E
ARYTAB = 0x002F  # $2F/$30
STREND = 0x0031  # $31/$32

KERNAL_POLL_MS = 50
POST_REBOOT_DELAY_S = 0.8
POST_MOUNT_DELAY_S = 0.4

PETSCII_LOAD_RUN = [
    0x4C, 0x4F, 0x41, 0x44,         # LOAD
    0x22, 0x2A, 0x22,               # "*"
    0x2C, 0x38,                     # ,8   (will be rewritten with actual bus id)
    0x2C, 0x31,                     # ,1
    0x3A,                           # :
    0x52, 0x55, 0x4E,               # RUN
    0x0D,                           # RETURN
]


@dataclass(frozen=True)
class DiskLayout:
    tracks: int
    directory_track: int
    directory_sector: int
    sectors_per_track: Callable[[int], int]
    total_sectors: int
    has_error_table: bool


def disk_type(path: str) -> str:
    return os.path.splitext(path)[1].lower().lstrip(".")


def sectors_per_track_1541(track: int) -> int:
    if track <= 17:
        return 21
    if track <= 24:
        return 19
    if track <= 30:
        return 18
    return 17


def sectors_per_track_1571(track: int) -> int:
    # Logical tracks 1..70: track 1..35 side A, 36..70 side B with same geometry
    local_track = ((track - 1) % 35) + 1
    return sectors_per_track_1541(local_track)


def sectors_per_track_1581(_: int) -> int:
    return 40


def layout_for_type(dtype: str, file_size: int) -> DiskLayout:
    if dtype == "d64":
        for tracks in (35, 40):
            base_sectors = sum(sectors_per_track_1541(track) for track in range(1, tracks + 1))
            base_size = base_sectors * SECTOR_SIZE
            error_size = base_size + base_sectors
            if file_size == base_size:
                return DiskLayout(
                    tracks=tracks,
                    directory_track=18,
                    directory_sector=1,
                    sectors_per_track=sectors_per_track_1541,
                    total_sectors=base_sectors,
                    has_error_table=False,
                )
            if file_size == error_size:
                return DiskLayout(
                    tracks=tracks,
                    directory_track=18,
                    directory_sector=1,
                    sectors_per_track=sectors_per_track_1541,
                    total_sectors=base_sectors,
                    has_error_table=True,
                )
        raise RuntimeError(f"Unsupported D64 size: {file_size} bytes")

    if dtype == "d71":
        tracks = 70
        base_sectors = sum(sectors_per_track_1571(track) for track in range(1, tracks + 1))
        base_size = base_sectors * SECTOR_SIZE
        error_size = base_size + base_sectors
        if file_size == base_size:
            return DiskLayout(
                tracks=tracks,
                directory_track=18,
                directory_sector=1,
                sectors_per_track=sectors_per_track_1571,
                total_sectors=base_sectors,
                has_error_table=False,
            )
        if file_size == error_size:
            return DiskLayout(
                tracks=tracks,
                directory_track=18,
                directory_sector=1,
                sectors_per_track=sectors_per_track_1571,
                total_sectors=base_sectors,
                has_error_table=True,
            )
        raise RuntimeError(f"Unsupported D71 size: {file_size} bytes")

    if dtype == "d81":
        base_sectors = 80 * 40
        base_size = base_sectors * SECTOR_SIZE
        error_size = base_size + base_sectors
        if file_size == base_size:
            return DiskLayout(
                tracks=80,
                directory_track=40,
                directory_sector=3,
                sectors_per_track=sectors_per_track_1581,
                total_sectors=base_sectors,
                has_error_table=False,
            )
        if file_size == error_size:
            return DiskLayout(
                tracks=80,
                directory_track=40,
                directory_sector=3,
                sectors_per_track=sectors_per_track_1581,
                total_sectors=base_sectors,
                has_error_table=True,
            )
        raise RuntimeError(f"Unsupported D81 size: {file_size} bytes")

    raise RuntimeError(f"Unsupported disk type: {dtype}")


def ts_offset(layout: DiskLayout, track: int, sector: int) -> int:
    if track < 1 or track > layout.tracks:
        raise RuntimeError(f"Track out of range: {track}")
    max_sector = layout.sectors_per_track(track)
    if sector < 0 or sector >= max_sector:
        raise RuntimeError(f"Sector out of range: track {track} sector {sector}")
    offset_sectors = 0
    for t in range(1, track):
        offset_sectors += layout.sectors_per_track(t)
    return (offset_sectors + sector) * SECTOR_SIZE


def read_sector(img: bytes, layout: DiskLayout, track: int, sector: int) -> bytes:
    off = ts_offset(layout, track, sector)
    data = img[off:off + SECTOR_SIZE]
    if len(data) != SECTOR_SIZE:
        raise RuntimeError(
            f"Short sector read at track {track} sector {sector}: expected {SECTOR_SIZE} bytes, got {len(data)}"
        )
    return data


def decode_dir_name(entry_name: bytes) -> str:
    return entry_name.replace(b"\xA0", b" ").decode("latin-1", errors="ignore").strip()


def is_prg_dir_entry(entry: bytes) -> bool:
    if len(entry) != 32:
        return False
    et = entry[0]
    start_track = entry[1]
    if et == 0 or start_track == 0:
        return False
    if (et & FILE_TYPE_MASK) != PRG_TYPE:
        return False
    return True


def find_first_prg(img: bytes, layout: DiskLayout) -> Tuple[int, int, str]:
    t, s = layout.directory_track, layout.directory_sector
    visited = set()
    while t != 0:
        if (t, s) in visited:
            break
        visited.add((t, s))
        sec = read_sector(img, layout, t, s)
        nt, ns = sec[0], sec[1]
        for i in range(8):
            off = 2 + i * 32
            entry = sec[off:off + 32]
            if not is_prg_dir_entry(entry):
                continue
            name = decode_dir_name(entry[3:19])
            return entry[1], entry[2], name
        t, s = nt, ns
    raise RuntimeError("No PRG found in directory")


def read_prg_chain(img: bytes, layout: DiskLayout, t: int, s: int) -> bytes:
    out = bytearray()
    visited = set()
    while t != 0:
        if (t, s) in visited:
            raise RuntimeError("Loop detected while reading PRG sectors")
        visited.add((t, s))
        sec = read_sector(img, layout, t, s)
        nt, ns = sec[0], sec[1]
        if nt == 0:
            used = ns
            if used < 1 or used > 254:
                used = 254
            out.extend(sec[2:2 + used])
            break
        out.extend(sec[2:])
        t, s = nt, ns
    return bytes(out)


def extract_prg(path: str, layout: DiskLayout) -> Tuple[bytes, str]:
    with open(path, "rb") as f:
        img = f.read()
    if layout.has_error_table:
        img = img[:layout.total_sectors * SECTOR_SIZE]
    t, s, name = find_first_prg(img, layout)
    prg_data = read_prg_chain(img, layout, t, s)
    if len(prg_data) < 2:
        raise RuntimeError("Extracted PRG is too small")
    return prg_data, name


def headers(password: Optional[str]) -> Dict[str, str]:
    return {"X-Password": password} if password else {}


def get_drives(base: str, password: Optional[str]) -> Dict[str, Any]:
    r = requests.get(f"{base}/v1/drives", headers=headers(password), timeout=10)
    r.raise_for_status()
    return r.json()


def get_drive_bus_id(base: str, password: Optional[str], drive: str) -> int:
    data = get_drives(base, password)
    drives = data.get("drives", [])
    for item in drives:
        if drive in item:
            d = item[drive]
            bus_id = d.get("bus_id")
            if isinstance(bus_id, int) and bus_id > 0:
                return bus_id
    raise RuntimeError(f"Could not determine drive {drive.upper()} bus_id from /v1/drives")


def set_drive_mode(base: str, password: Optional[str], drive: str, mode: str):
    r = requests.put(
        f"{base}/v1/drives/{drive}:set_mode",
        params={"mode": mode},
        headers=headers(password),
        timeout=10,
    )
    r.raise_for_status()


def drive_on(base: str, password: Optional[str], drive: str):
    r = requests.put(f"{base}/v1/drives/{drive}:on", headers=headers(password), timeout=10)
    r.raise_for_status()


def drive_reset(base: str, password: Optional[str], drive: str):
    r = requests.put(f"{base}/v1/drives/{drive}:reset", headers=headers(password), timeout=10)
    r.raise_for_status()


def drive_remove(base: str, password: Optional[str], drive: str):
    r = requests.put(f"{base}/v1/drives/{drive}:remove", headers=headers(password), timeout=10)
    r.raise_for_status()


def mount_disk_attached(base: str, password: Optional[str], drive: str, path: str, dtype: str, mode: str = "readonly"):
    drive_on(base, password, drive)
    drive_remove(base, password, drive)

    with open(path, "rb") as f:
        r = requests.post(
            f"{base}/v1/drives/{drive}:mount",
            params={"type": dtype, "mode": mode},
            headers=headers(password),
            files={"file": (os.path.basename(path), f)},
            timeout=30,
        )
    r.raise_for_status()
    drive_reset(base, password, drive)


def read_mem(base: str, password: Optional[str], addr: int) -> int:
    r = requests.get(
        f"{base}/v1/machine:readmem",
        params={"address": f"{addr:04X}", "length": 1},
        headers=headers(password),
        timeout=10,
    )
    r.raise_for_status()
    if not r.content:
        raise RuntimeError("Empty response from readmem")
    return r.content[0]


def write_mem_block(base: str, password: Optional[str], addr: int, data: bytes):
    r = requests.post(
        f"{base}/v1/machine:writemem",
        params={"address": f"{addr:04X}"},
        headers=headers(password),
        data=data,
        timeout=30,
    )
    r.raise_for_status()


def write_mem(base: str, password: Optional[str], addr: int, val: int):
    r = requests.put(
        f"{base}/v1/machine:writemem",
        params={"address": f"{addr:04X}", "data": f"{val:02X}"},
        headers=headers(password),
        timeout=10,
    )
    r.raise_for_status()


def reset_machine(base: str, password: Optional[str]):
    r = requests.put(f"{base}/v1/machine:reset", headers=headers(password), timeout=10)
    r.raise_for_status()


def reboot_machine(base: str, password: Optional[str]):
    r = requests.put(f"{base}/v1/machine:reboot", headers=headers(password), timeout=20)
    r.raise_for_status()


def dma_load_prg(base: str, password: Optional[str], prg: bytes, retries: int, backoff_s: float) -> Tuple[int, int]:
    if len(prg) < 3:
        raise RuntimeError("PRG payload is too small")
    load_addr = prg[0] | (prg[1] << 8)
    payload = prg[2:]
    end_addr_exclusive = load_addr + len(payload)
    if end_addr_exclusive > 0x10000:
        raise RuntimeError("PRG payload exceeds C64 address space")

    last_error: Optional[Exception] = None
    for attempt in range(retries):
        try:
            write_mem_block(base, password, load_addr, payload)
            return load_addr, end_addr_exclusive
        except requests.RequestException as exc:
            last_error = exc
            if attempt < retries - 1:
                time.sleep(backoff_s)
    raise RuntimeError("DMA load failed after retries") from last_error


def looks_like_tokenised_basic(prg: bytes) -> bool:
    if len(prg) < 2 + 6:
        return False
    load_addr = prg[0] | (prg[1] << 8)
    if load_addr != 0x0801:
        return False
    data = prg[2:]

    i = 0
    steps = 0
    while True:
        steps += 1
        if steps > 2000:
            return False
        if i + 4 > len(data):
            return False
        next_ptr = data[i] | (data[i + 1] << 8)
        line_no = data[i + 2] | (data[i + 3] << 8)
        if line_no == 0 or line_no > 63999:
            return False
        j = i + 4
        while j < len(data) and data[j] != 0x00:
            j += 1
        if j >= len(data):
            return False
        i = j + 1
        if next_ptr == 0:
            return True
        expected_off = next_ptr - 0x0801
        if expected_off < 0 or expected_off > len(data):
            return False
        if abs(i - expected_off) > 2:
            return False


def set_basic_pointers_and_clear_vars(
    base: str,
    password: Optional[str],
    start_addr: int,
    end_addr_exclusive: int,
):
    """
    Safe BASIC fixup for DMA-loaded PRGs that start at $0801.

    IMPORTANT:
    - We set VARTAB/ARYTAB/STREND to end_addr_exclusive (end of *entire* PRG payload),
      not end of BASIC text, so that appended machine code used by SYS stubs is protected.
    - We write the empty variable-table marker (00 00) at end_addr_exclusive, which is safe.
    - We write exactly 8 bytes to $2B-$32 (no clobber of $33/$34).
    """
    if start_addr != 0x0801:
        return

    if end_addr_exclusive < 0x0801 or end_addr_exclusive > 0xFFFE:
        raise RuntimeError(f"Suspicious BASIC end address: ${end_addr_exclusive:04X}")

    zp = bytes(
        [
            start_addr & 0xFF,
            (start_addr >> 8) & 0xFF,
            end_addr_exclusive & 0xFF,
            (end_addr_exclusive >> 8) & 0xFF,
            end_addr_exclusive & 0xFF,
            (end_addr_exclusive >> 8) & 0xFF,
            end_addr_exclusive & 0xFF,
            (end_addr_exclusive >> 8) & 0xFF,
        ]
    )
    write_mem_block(base, password, TXTTAB, zp)

    # Mark variable table empty at VARTAB.
    write_mem_block(base, password, end_addr_exclusive, b"\x00\x00")


def petscii_command(command: str) -> List[int]:
    return [ord(ch) for ch in command.upper()] + [0x0D]


def inject_keyboard_fast(base: str, password: Optional[str], seq: List[int]):
    if len(seq) > KEYBUF_MAX:
        raise RuntimeError(f"Keyboard sequence too long ({len(seq)} > {KEYBUF_MAX})")

    # Reduce race with KERNAL key scanning by waiting for an empty buffer first.
    for _ in range(40):
        if read_mem(base, password, KEYBUF_COUNT) == 0:
            break
        time.sleep(KERNAL_POLL_MS / 1000)

    write_mem(base, password, KEYBUF_COUNT, 0)
    write_mem_block(base, password, KEYBUF_ADDR, bytes(seq))
    write_mem(base, password, KEYBUF_COUNT, len(seq))
    time.sleep(KERNAL_POLL_MS / 1000)


def drive_mode_for_image(dtype: str) -> str:
    if dtype in ("d64", "g64"):
        return "1541"
    if dtype in ("d71", "g71"):
        return "1571"
    if dtype == "d81":
        return "1581"
    return "1541"


def rewrite_load_sequence_for_bus_id(bus_id: int) -> List[int]:
    if bus_id < 8 or bus_id > 15:
        raise RuntimeError(f"Unexpected bus_id {bus_id}, expected 8..15")
    seq = list(PETSCII_LOAD_RUN)
    seq[9] = ord(str(bus_id))
    return seq


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("disk", help="Disk image path (.d64/.d71/.d81/.g64/.g71)")
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--password")
    ap.add_argument("--drive", default="a", help="Drive to mount into (default: a)")
    ap.add_argument("--cycles", type=int, default=1)
    ap.add_argument("--reset-between", action="store_true")
    ap.add_argument("--cycle-delay", type=float, default=0.5)
    ap.add_argument("--dma-retries", type=int, default=5)
    ap.add_argument("--dma-backoff-ms", type=int, default=50)
    ap.add_argument("--mount-mode", default="readonly", choices=("readonly", "readwrite", "unlinked"))
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    dtype = disk_type(args.disk)
    drive = args.drive.lower()

    if dtype not in ("d64", "d71", "d81", "g64", "g71"):
        raise RuntimeError(f"Unsupported disk type: {dtype}")

    # Per requirement: ensure we mount into drive A.
    if drive != "a":
        raise RuntimeError("This script mounts into drive A only. Use --drive a (default).")

    bus_id = get_drive_bus_id(base, args.password, drive)
    mode = drive_mode_for_image(dtype)

    if dtype in ("d64", "d71", "d81"):
        layout = layout_for_type(dtype, os.path.getsize(args.disk))
        prg, name = extract_prg(args.disk, layout)
        load_addr = prg[0] | (prg[1] << 8)
        print(f"Found PRG '{name}' ({len(prg)} bytes), load address ${load_addr:04X}")

        for i in range(args.cycles):
            print(f"Cycle {i + 1}/{args.cycles}: reboot + mount in drive A + DMA load + run")
            reboot_machine(base, args.password)
            time.sleep(POST_REBOOT_DELAY_S)

            set_drive_mode(base, args.password, drive, mode)
            mount_disk_attached(base, args.password, drive, args.disk, dtype, mode=args.mount_mode)
            time.sleep(POST_MOUNT_DELAY_S)

            loaded_addr, end_excl = dma_load_prg(
                base,
                args.password,
                prg,
                retries=args.dma_retries,
                backoff_s=args.dma_backoff_ms / 1000.0,
            )

            if loaded_addr == 0x0801 and looks_like_tokenised_basic(prg):
                # IMPORTANT FIX: protect appended machine code by using end_excl.
                set_basic_pointers_and_clear_vars(base, args.password, loaded_addr, end_excl)
                inject_keyboard_fast(base, args.password, petscii_command("RUN"))
            else:
                inject_keyboard_fast(base, args.password, petscii_command(f"SYS {loaded_addr}"))

            if i < args.cycles - 1:
                if args.reset_between:
                    reset_machine(base, args.password)
                    print("Reset issued")
                time.sleep(args.cycle_delay)
        return

    if dtype in ("g64", "g71"):
        print(f"Mounting {dtype.upper()} into drive A, then LOAD\"*\",{bus_id},1:RUN")
        set_drive_mode(base, args.password, drive, mode)
        mount_disk_attached(base, args.password, drive, args.disk, dtype, mode=args.mount_mode)
        time.sleep(POST_MOUNT_DELAY_S)

        load_run = rewrite_load_sequence_for_bus_id(bus_id)
        inject_keyboard_fast(base, args.password, load_run)
        return


if __name__ == "__main__":
    main()
