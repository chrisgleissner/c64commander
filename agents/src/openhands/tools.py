from __future__ import annotations

import os
import subprocess
from pathlib import Path

from .config import DEFAULT_C64U_HOST, PATHS


PREFERRED_DEVICE_PREFIXES = ("211", "R5C")


def parse_connected_device_serials(adb_output: str) -> list[str]:
    serials: list[str] = []
    for raw_line in adb_output.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("List of devices attached"):
            continue
        parts = line.split()
        if len(parts) >= 2 and parts[1] == "device":
            serials.append(parts[0])
    return serials


def resolve_android_serial(explicit: str | None = None) -> str:
    output = subprocess.check_output(["adb", "devices", "-l"], text=True)
    connected = parse_connected_device_serials(output)
    if explicit:
        if len(explicit) > 3:
            return explicit
        matches = [serial for serial in connected if serial.startswith(explicit)]
        if len(matches) == 1:
            return matches[0]
        if not matches:
            raise RuntimeError(
                f'No connected Android device matched prefix "{explicit}". Connected devices: {connected or ["(none)"]}'
            )
        raise RuntimeError(f'Multiple Android devices matched prefix "{explicit}": {matches}')
    for prefix in PREFERRED_DEVICE_PREFIXES:
        matches = [serial for serial in connected if serial.startswith(prefix)]
        if len(matches) == 1:
            return matches[0]
        if len(matches) > 1:
            raise RuntimeError(f'Multiple Android devices matched fallback prefix "{prefix}": {matches}')
    raise RuntimeError(f"No configured Android test device is connected. Connected devices: {connected or ['(none)']}")


def resolve_c64u_host() -> str:
    return os.environ.get("C64U_HOST", DEFAULT_C64U_HOST)


def openhands_stdio_servers() -> list[dict[str, object]]:
    return [
        {
            "name": "c64scope",
            "command": "node",
            "args": [str(PATHS.repo_root / "c64scope" / "dist" / "index.js")],
        },
        {
            "name": "droidmind",
            "command": "uv",
            "args": [
                "run",
                "--python",
                "3.13",
                "--directory",
                str(PATHS.repo_root / "droidmind"),
                "droidmind",
                "--transport",
                "stdio",
            ],
        },
        {
            "name": "c64bridge",
            "command": "node",
            "args": [str((PATHS.repo_root / "c64bridge" / "dist" / "mcp-server.js").resolve())],
        },
    ]


def verify_local_tool_paths() -> None:
    required_paths = (
        PATHS.repo_root / "c64scope" / "dist" / "index.js",
        PATHS.repo_root / "c64bridge" / "dist" / "mcp-server.js",
        PATHS.repo_root / "droidmind",
    )
    missing = [str(path) for path in required_paths if not Path(path).exists()]
    if missing:
        raise RuntimeError(f"Required tool paths are missing: {missing}")


def tool_shell_hints() -> list[str]:
    return [
        "adb",
        "./android/gradlew",
        f"uv run --python 3.13 --directory {PATHS.repo_root / 'droidmind'} droidmind --transport stdio",
        f"node {PATHS.repo_root / 'c64scope' / 'dist' / 'autonomousValidation.js'}",
        f"node {(PATHS.repo_root / 'c64bridge' / 'dist' / 'mcp-server.js').resolve()}",
    ]
