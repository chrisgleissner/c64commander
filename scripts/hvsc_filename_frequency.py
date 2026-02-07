#!/usr/bin/env python3
"""
Parse HVSC Songlengths and print filename frequencies as CSV.

Output format:
  filename,count,full_path_1,full_path_2,...
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple


SONGLENGTHS_CANDIDATES = (
    "songlengths.txt",
    "Songlengths.txt",
    "songlengths.md5",
    "Songlengths.md5",
    "DOCUMENTS/songlengths.txt",
    "DOCUMENTS/Songlengths.txt",
    "DOCUMENTS/songlengths.md5",
    "DOCUMENTS/Songlengths.md5",
)

PATH_LINE_RE = re.compile(r"^;\s*(/.*\.\w+)\s*$")
HASH_LINE_RE = re.compile(r"^[0-9a-fA-F]{32}=")


def resolve_inputs(input_path: Path) -> Tuple[Path, Path]:
    resolved = input_path.expanduser().resolve()
    if resolved.is_file():
        hvsc_root = resolved.parent.parent if resolved.parent.name.upper() == "DOCUMENTS" else resolved.parent
        return hvsc_root, resolved

    if resolved.is_dir():
        for rel in SONGLENGTHS_CANDIDATES:
            candidate = resolved / rel
            if candidate.is_file():
                return resolved, candidate
        raise RuntimeError(f"Could not find Songlengths file under directory: {resolved}")

    raise RuntimeError(f"Path does not exist: {resolved}")


def collect_frequencies(hvsc_root: Path, songlengths_path: Path) -> Dict[str, List[str]]:
    by_filename: Dict[str, List[str]] = {}
    pending_relative_path: Optional[str] = None

    with songlengths_path.open("r", encoding="utf-8", errors="replace") as handle:
        for raw_line in handle:
            line = raw_line.rstrip("\r\n")
            path_match = PATH_LINE_RE.match(line)
            if path_match:
                pending_relative_path = path_match.group(1)
                continue

            if pending_relative_path is None:
                continue

            if not line.strip():
                continue

            if HASH_LINE_RE.match(line.strip()):
                relative = pending_relative_path.lstrip("/\\")
                full_path = hvsc_root / Path(relative)
                filename = full_path.name
                by_filename.setdefault(filename, []).append(str(full_path))
                pending_relative_path = None
                continue

            if line.startswith(";"):
                pending_relative_path = None
                continue

            raise RuntimeError(
                f"Unexpected line after path entry in {songlengths_path}: {line}"
            )

    return by_filename


def parse_args(argv: List[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Parse HVSC Songlengths and print filename frequencies as CSV "
            "(filename,count,fullPath1,fullPath2,...)"
        )
    )
    parser.add_argument(
        "path",
        help="Path to HVSC root directory or directly to Songlengths.txt/Songlengths.md5",
    )
    parser.add_argument(
        "--duplicates-only",
        action="store_true",
        help="Only print filenames that occur more than once",
    )
    return parser.parse_args(argv)


def main(argv: List[str]) -> int:
    args = parse_args(argv)
    hvsc_root, songlengths_path = resolve_inputs(Path(args.path))
    by_filename = collect_frequencies(hvsc_root, songlengths_path)

    rows = sorted(
        (
            (filename, full_paths)
            for filename, full_paths in by_filename.items()
            if not args.duplicates_only or len(full_paths) > 1
        ),
        key=lambda item: (-len(item[1]), item[0]),
    )

    writer = csv.writer(sys.stdout, lineterminator="\n")
    for filename, full_paths in rows:
        writer.writerow([filename, len(full_paths), *full_paths])

    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main(sys.argv[1:]))
    except BrokenPipeError as exc:
        print(f"WARN: Output pipe closed before completion: {exc}", file=sys.stderr)
        raise SystemExit(0)
    except Exception as exc:
        print(f"Failed to list HVSC filename frequencies: {exc}", file=sys.stderr)
        raise
