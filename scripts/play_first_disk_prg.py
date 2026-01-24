#!/usr/bin/env python3

import argparse
import os
import time
from dataclasses import dataclass
from typing import Callable, Optional

import requests

SECTOR_SIZE = 256
PRG_TYPE = 0x02

KEYBUF_ADDR = 0x0277
KEYBUF_COUNT = 0x00C6
KEYBUF_MAX = 10
KERNAL_POLL_MS = 50

PETSCII_LOAD_RUN = [
    0x4C, 0x4F, 0x41, 0x44,
    0x22, 0x2A, 0x22,
    0x2C, 0x38,
    0x2C, 0x31,
    0x3A,
    0x52, 0x55, 0x4E,
    0x0D,
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
    local_track = ((track - 1) % 35) + 1
    return sectors_per_track_1541(local_track)


def sectors_per_track_1581(_: int) -> int:
    return 40


def total_sectors(layout: DiskLayout) -> int:
    return sum(layout.sectors_per_track(track) for track in range(1, layout.tracks + 1))


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
        base_sectors = sum(sectors_per_track_1571(track) for track in range(1, 71))
        base_size = base_sectors * SECTOR_SIZE
        error_size = base_size + base_sectors
        if file_size == base_size:
            return DiskLayout(
                tracks=70,
                directory_track=18,
                directory_sector=1,
                sectors_per_track=sectors_per_track_1571,
                total_sectors=base_sectors,
                has_error_table=False,
            )
        if file_size == error_size:
            return DiskLayout(
                tracks=70,
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


def find_first_prg(img: bytes, layout: DiskLayout) -> tuple[int, int, str]:
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
            if len(entry) != 32:
                continue
            et = entry[0]
            if et == 0:
                continue
            if (et & 0x80) and (et & 0x0F) == PRG_TYPE:
                blocks = entry[30] | (entry[31] << 8)
                if blocks > 0:
                    name = entry[3:19].replace(b"\xA0", b" ").decode("latin-1", errors="ignore").strip()
                    return entry[1], entry[2], name
        t, s = nt, ns
    raise RuntimeError("No PRG found")


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
            if used == 0 or used > 254:
                used = 254
            out.extend(sec[2:2 + used])
            break
        out.extend(sec[2:])
        t, s = nt, ns
    return bytes(out)


def extract_prg(path: str, layout: DiskLayout) -> tuple[bytes, str]:
    img = open(path, "rb").read()
    if layout.has_error_table:
        img = img[:layout.total_sectors * SECTOR_SIZE]
    t, s, name = find_first_prg(img, layout)
    return read_prg_chain(img, layout, t, s), name


def headers(password: Optional[str]) -> dict:
    return {"X-Password": password} if password else {}


def mount_disk(base: str, password: Optional[str], path: str, dtype: str):
    with open(path, "rb") as f:
        r = requests.post(
            f"{base}/v1/drives/a:mount",
            params={"type": dtype, "mode": "readonly"},
            headers=headers(password),
            files={"file": (os.path.basename(path), f)},
            timeout=10,
        )
    r.raise_for_status()


def run_prg(base: str, password: Optional[str], prg: bytes):
    r = requests.post(
        f"{base}/v1/runners:run_prg",
        headers=headers(password),
        files={"file": ("program.prg", prg)},
        timeout=10,
    )
    r.raise_for_status()


def read_mem(base: str, password: Optional[str], addr: int) -> int:
    r = requests.get(
        f"{base}/v1/machine:readmem",
        params={"address": f"{addr:04X}", "length": 1},
        headers=headers(password),
        timeout=5,
    )
    r.raise_for_status()
    return r.content[0]


def write_mem(base: str, password: Optional[str], addr: int, val: int):
    r = requests.put(
        f"{base}/v1/machine:writemem",
        params={"address": f"{addr:04X}", "data": f"{val:02X}"},
        headers=headers(password),
        timeout=5,
    )
    r.raise_for_status()


def inject_keyboard(base: str, password: Optional[str], seq: list[int]):
    for b in seq:
        while read_mem(base, password, KEYBUF_COUNT) >= KEYBUF_MAX:
            time.sleep(KERNAL_POLL_MS / 1000)
        count = read_mem(base, password, KEYBUF_COUNT)
        write_mem(base, password, KEYBUF_ADDR + count, b)
        write_mem(base, password, KEYBUF_COUNT, count + 1)
        time.sleep(KERNAL_POLL_MS / 1000)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("disk")
    ap.add_argument("--base-url", required=True)
    ap.add_argument("--password")
    args = ap.parse_args()

    base = args.base_url.rstrip("/")
    dtype = disk_type(args.disk)

    if dtype in ("d64", "d71", "d81"):
        layout = layout_for_type(dtype, os.path.getsize(args.disk))
        prg, name = extract_prg(args.disk, layout)
        if len(prg) < 2:
            raise RuntimeError("PRG payload is too small")
        print(f"Found PRG '{name}' ({len(prg)} bytes)")
        run_prg(base, args.password, prg)
        return

    if dtype in ("g64", "g71"):
        mount_disk(base, args.password, args.disk, dtype)
        time.sleep(1.0)
        inject_keyboard(base, args.password, PETSCII_LOAD_RUN)
        return

    raise RuntimeError(f"Unsupported disk type: {dtype}")


if __name__ == "__main__":
    main()