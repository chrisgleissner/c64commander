"""Tests for openhands.tools."""
from __future__ import annotations

import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from openhands.config import RuntimePaths
from openhands.tools import (
    PREFERRED_DEVICE_PREFIXES,
    openhands_stdio_servers,
    parse_connected_device_serials,
    resolve_android_serial,
    resolve_c64u_host,
    tool_shell_hints,
    verify_local_tool_paths,
)


# ---------------------------------------------------------------------------
# parse_connected_device_serials (pure function)
# ---------------------------------------------------------------------------

ADB_OUTPUT_SINGLE = """\
List of devices attached
2113b87f\tdevice
"""

ADB_OUTPUT_MULTIPLE = """\
List of devices attached
2113b87f\tdevice product:...
R5CRC3ZY9XH\tdevice product:...
"""

ADB_OUTPUT_NONE = """\
List of devices attached

"""

ADB_OUTPUT_OFFLINE = """\
List of devices attached
2113b87f\toffline
R5CRC3ZY9XH\tunauthorized
"""

ADB_OUTPUT_EMPTY = ""


def test_parse_single_device() -> None:
    serials = parse_connected_device_serials(ADB_OUTPUT_SINGLE)
    assert serials == ["2113b87f"]


def test_parse_multiple_devices() -> None:
    serials = parse_connected_device_serials(ADB_OUTPUT_MULTIPLE)
    assert "2113b87f" in serials
    assert "R5CRC3ZY9XH" in serials
    assert len(serials) == 2


def test_parse_no_devices() -> None:
    assert parse_connected_device_serials(ADB_OUTPUT_NONE) == []


def test_parse_offline_devices_excluded() -> None:
    assert parse_connected_device_serials(ADB_OUTPUT_OFFLINE) == []


def test_parse_empty_string() -> None:
    assert parse_connected_device_serials(ADB_OUTPUT_EMPTY) == []


def test_parse_skips_header_line() -> None:
    serials = parse_connected_device_serials("List of devices attached\nfoo\tdevice\n")
    assert serials == ["foo"]


# ---------------------------------------------------------------------------
# resolve_android_serial
# ---------------------------------------------------------------------------


def _mock_adb(output: str, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "openhands.tools.subprocess.check_output",
        lambda *a, **kw: output,
    )


def test_resolve_explicit_long_serial(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_adb(ADB_OUTPUT_SINGLE, monkeypatch)
    assert resolve_android_serial("2113b87f") == "2113b87f"


def test_resolve_explicit_prefix_match(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_adb(ADB_OUTPUT_SINGLE, monkeypatch)
    # "211" is a prefix; serial "2113b87f" has length > 3 so the explicit path returns it.
    # Using a 3-char prefix:
    assert resolve_android_serial("211") == "2113b87f"


def test_resolve_explicit_prefix_no_match(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_adb(ADB_OUTPUT_SINGLE, monkeypatch)
    with pytest.raises(RuntimeError, match="No connected"):
        resolve_android_serial("XYZ")


def test_resolve_explicit_prefix_multiple_matches(monkeypatch: pytest.MonkeyPatch) -> None:
    # Both serials start with "21"; prefix len=2 which is ≤3, so prefix matching runs.
    output = "List of devices attached\n21aaa\tdevice\n21bbb\tdevice\n"
    _mock_adb(output, monkeypatch)
    with pytest.raises(RuntimeError, match="Multiple Android devices matched prefix"):
        resolve_android_serial("21")


def test_resolve_fallback_preferred_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    _mock_adb(ADB_OUTPUT_SINGLE, monkeypatch)
    # "2113b87f" starts with "211", the first PREFERRED_DEVICE_PREFIXES entry.
    serial = resolve_android_serial(None)
    assert serial == "2113b87f"


def test_resolve_fallback_second_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    output = "List of devices attached\nR5CRC3ZY9XH\tdevice\n"
    _mock_adb(output, monkeypatch)
    serial = resolve_android_serial(None)
    assert serial == "R5CRC3ZY9XH"


def test_resolve_fallback_multiple_preferred_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    output = "List of devices attached\n211aaa\tdevice\n211bbb\tdevice\n"
    _mock_adb(output, monkeypatch)
    with pytest.raises(RuntimeError, match='Multiple Android devices matched fallback prefix'):
        resolve_android_serial(None)


def test_resolve_no_configured_device_raises(monkeypatch: pytest.MonkeyPatch) -> None:
    output = "List of devices attached\nunknown999\tdevice\n"
    _mock_adb(output, monkeypatch)
    with pytest.raises(RuntimeError, match="No configured Android test device"):
        resolve_android_serial(None)


# ---------------------------------------------------------------------------
# resolve_c64u_host
# ---------------------------------------------------------------------------


def test_resolve_c64u_host_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("C64U_HOST", raising=False)
    import openhands.tools as tools

    monkeypatch.setattr(tools, "DEFAULT_C64U_HOST", "192.168.1.13")
    host = resolve_c64u_host()
    assert host == "192.168.1.13"


def test_resolve_c64u_host_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("C64U_HOST", "10.0.0.5")
    assert resolve_c64u_host() == "10.0.0.5"


# ---------------------------------------------------------------------------
# openhands_stdio_servers
# ---------------------------------------------------------------------------


def test_openhands_stdio_servers_returns_three(patched_env: RuntimePaths) -> None:
    servers = openhands_stdio_servers()
    assert len(servers) == 3
    names = [s["name"] for s in servers]
    assert "c64scope" in names
    assert "droidmind" in names
    assert "c64bridge" in names


def test_openhands_stdio_servers_c64scope_uses_node(patched_env: RuntimePaths) -> None:
    servers = {s["name"]: s for s in openhands_stdio_servers()}
    assert servers["c64scope"]["command"] == "node"


def test_openhands_stdio_servers_droidmind_uses_uv(patched_env: RuntimePaths) -> None:
    servers = {s["name"]: s for s in openhands_stdio_servers()}
    assert servers["droidmind"]["command"] == "uv"


# ---------------------------------------------------------------------------
# verify_local_tool_paths
# ---------------------------------------------------------------------------


def test_verify_local_tool_paths_all_present(patched_env: RuntimePaths) -> None:
    # Create the expected paths so the check passes.
    (patched_env.c64scope_root / "dist").mkdir(parents=True)
    (patched_env.c64scope_root / "dist" / "index.js").write_text("// ok")
    bridge_dir = patched_env.repo_root / "c64bridge" / "dist"
    bridge_dir.mkdir(parents=True)
    (bridge_dir / "mcp-server.js").write_text("// ok")
    (patched_env.repo_root / "droidmind").mkdir(parents=True)

    verify_local_tool_paths()  # Must not raise.


def test_verify_local_tool_paths_missing_raises(patched_env: RuntimePaths) -> None:
    # No paths created → all missing.
    with pytest.raises(RuntimeError, match="Required tool paths are missing"):
        verify_local_tool_paths()


def test_verify_local_tool_paths_partial_missing(patched_env: RuntimePaths) -> None:
    # Only droidmind present → the other two are missing.
    (patched_env.repo_root / "droidmind").mkdir(parents=True)
    with pytest.raises(RuntimeError, match="Required tool paths are missing"):
        verify_local_tool_paths()


# ---------------------------------------------------------------------------
# tool_shell_hints
# ---------------------------------------------------------------------------


def test_tool_shell_hints_returns_list(patched_env: RuntimePaths) -> None:
    hints = tool_shell_hints()
    assert isinstance(hints, list)
    assert len(hints) >= 3
    assert any("adb" in h for h in hints)
