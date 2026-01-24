#!/usr/bin/env python3
import argparse
import sys
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Iterable, Tuple

SECTOR_SIZE = 256
DIRECTORY_TRACK = 18
DIRECTORY_SECTOR = 1


@dataclass(frozen=True)
class DiskLayout:
    tracks: int
    has_error_table: bool
    sector_offsets: Tuple[int, ...]


def sectors_per_track(track: int) -> int:
    if 1 <= track <= 17:
        return 21
    if 18 <= track <= 24:
        return 19
    if 25 <= track <= 30:
        return 18
    if 31 <= track <= 40:
        return 17
    raise ValueError(f"Invalid track: {track}")


def build_layout(tracks: int) -> DiskLayout:
    offsets = [0]
    total_sectors = 0
    for track in range(1, tracks + 1):
        total_sectors += sectors_per_track(track)
        offsets.append(total_sectors * SECTOR_SIZE)
    return DiskLayout(tracks=tracks, has_error_table=False, sector_offsets=tuple(offsets))


def guess_layout(file_size: int) -> DiskLayout:
    for tracks in (35, 40):
        layout = build_layout(tracks)
        base_size = layout.sector_offsets[-1]
        error_size = base_size + (layout.sector_offsets[-1] // SECTOR_SIZE)
        if file_size == base_size:
            return DiskLayout(tracks=tracks, has_error_table=False, sector_offsets=layout.sector_offsets)
        if file_size == error_size:
            return DiskLayout(tracks=tracks, has_error_table=True, sector_offsets=layout.sector_offsets)
    raise RuntimeError(f"Unsupported D64 size: {file_size} bytes")


def sector_offset(layout: DiskLayout, track: int, sector: int) -> int:
    if track < 1 or track > layout.tracks:
        raise RuntimeError(f"Track out of range: {track}")
    max_sector = sectors_per_track(track)
    if sector < 0 or sector >= max_sector:
        raise RuntimeError(f"Sector out of range: track {track} sector {sector}")
    track_start = layout.sector_offsets[track - 1]
    return track_start + sector * SECTOR_SIZE


def read_sector(image: bytes, layout: DiskLayout, track: int, sector: int) -> bytes:
    offset = sector_offset(layout, track, sector)
    return image[offset:offset + SECTOR_SIZE]


def iter_directory_entries(image: bytes, layout: DiskLayout) -> Iterable[bytes]:
    track = DIRECTORY_TRACK
    sector = DIRECTORY_SECTOR
    visited = set()
    while track != 0:
        if (track, sector) in visited:
            break
        visited.add((track, sector))
        data = read_sector(image, layout, track, sector)
        next_track = data[0]
        next_sector = data[1]
        for index in range(8):
            entry = data[2 + index * 32:2 + (index + 1) * 32]
            if entry and entry[0] != 0x00:
                yield entry
        track = next_track
        sector = next_sector


def decode_filename(raw: bytes) -> str:
    text = raw.replace(b"\xa0", b" ").decode("latin-1", errors="ignore")
    return " ".join(text.strip().split())


def find_first_prg(image: bytes, layout: DiskLayout) -> Tuple[int, int, str]:
    for entry in iter_directory_entries(image, layout):
        file_type = entry[0]
        if (file_type & 0x0F) != 0x02:
            continue
        start_track = entry[1]
        start_sector = entry[2]
        if start_track == 0:
            continue
        name = decode_filename(entry[3:19])
        return start_track, start_sector, name
    raise RuntimeError("No PRG found")


def extract_prg(image: bytes, layout: DiskLayout, start_track: int, start_sector: int) -> bytes:
    track = start_track
    sector = start_sector
    payload = bytearray()
    visited = set()
    while track != 0:
        if (track, sector) in visited:
            raise RuntimeError("Loop detected while reading PRG sectors")
        visited.add((track, sector))
        data = read_sector(image, layout, track, sector)
        next_track = data[0]
        next_sector = data[1]
        if next_track == 0:
            used = next_sector
            if used == 0 or used > 254:
                used = 254
            payload.extend(data[2:2 + used])
            break
        payload.extend(data[2:])
        track = next_track
        sector = next_sector
    if len(payload) < 2:
        raise RuntimeError("PRG payload is too small")
    return bytes(payload)


def http_request(method: str, url: str, data: bytes | None = None) -> None:
    req = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=10) as response:
        response.read()


def put_mem_hex(base_url: str, address: int, data_hex: str) -> None:
    query = urllib.parse.urlencode({"address": f"{address:04X}", "data": data_hex})
    url = f"{base_url}/v1/machine:writemem?{query}"
    http_request("PUT", url)


def post_mem_bytes(base_url: str, address: int, data: bytes) -> None:
    query = urllib.parse.urlencode({"address": f"{address:04X}"})
    url = f"{base_url}/v1/machine:writemem?{query}"
    http_request("POST", url, data=data)


def load_prg(base_url: str, load_address: int, data: bytes) -> None:
    chunk_size = 128
    for offset in range(0, len(data), chunk_size):
        chunk = data[offset:offset + chunk_size]
        post_mem_bytes(base_url, load_address + offset, chunk)


def enqueue_basic_command(base_url: str, command: str) -> None:
    buffer_addr = 0x0277
    length_addr = 0x00C6
    text = command.upper().encode("ascii")
    put_mem_hex(base_url, buffer_addr, text.hex())
    put_mem_hex(base_url, length_addr, f"{len(text):02X}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract and execute first PRG from a D64 image.")
    parser.add_argument("disk", help="Path to D64 image")
    parser.add_argument("--base-url", required=True, help="Base URL of C64U API (e.g. http://c64)")
    parser.add_argument("--no-reset", action="store_true", help="Skip machine reset before loading")
    args = parser.parse_args()

    base_url = args.base_url.rstrip("/")

    with open(args.disk, "rb") as handle:
        image = handle.read()

    layout = guess_layout(len(image))
    if layout.has_error_table:
        image = image[:layout.sector_offsets[-1]]

    start_track, start_sector, name = find_first_prg(image, layout)
    prg = extract_prg(image, layout, start_track, start_sector)
    load_address = prg[0] | (prg[1] << 8)
    program = prg[2:]

    print(f"Found PRG '{name}' at track {start_track} sector {start_sector}")
    print(f"Load address: ${load_address:04X} ({len(program)} bytes)")

    if not args.no_reset:
        http_request("PUT", f"{base_url}/v1/machine:reset")

    load_prg(base_url, load_address, program)

    if load_address == 0x0801:
        enqueue_basic_command(base_url, "RUN\r")
    else:
        enqueue_basic_command(base_url, f"SYS {load_address}\r")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)
