"""Tests for openhands.cli."""
from __future__ import annotations

import pytest

from openhands.cli import build_parser, main
from openhands.config import RuntimePaths
from openhands.providers import ProviderSelection


def _make_selection() -> ProviderSelection:
    return ProviderSelection(
        provider="openai",
        label="OpenAI (Codex / GPT)",
        validated_at="2024-01-01T00:00:00Z",
        credential_paths=[],
    )


# ---------------------------------------------------------------------------
# build_parser
# ---------------------------------------------------------------------------


def test_build_parser_login_command() -> None:
    parser = build_parser()
    args = parser.parse_args(["login"])
    assert args.command == "login"


def test_build_parser_run_command() -> None:
    parser = build_parser()
    args = parser.parse_args(["run"])
    assert args.command == "run"


def test_build_parser_no_command_exits() -> None:
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args([])


def test_build_parser_unknown_command_exits() -> None:
    parser = build_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["unknown"])


# ---------------------------------------------------------------------------
# main
# ---------------------------------------------------------------------------


def test_main_login_prints_and_returns_zero(
    patched_env: RuntimePaths,
    monkeypatch: pytest.MonkeyPatch,
    capsys: pytest.CaptureFixture,
) -> None:
    sel = _make_selection()
    monkeypatch.setattr("openhands.cli.ensure_runtime_directories", lambda: None)
    monkeypatch.setattr("openhands.cli.login_selected_provider", lambda: sel)

    result = main(["login"])

    assert result == 0
    captured = capsys.readouterr()
    assert "OpenAI (Codex / GPT)" in captured.out


def test_main_run_no_provider_configured(
    patched_env: RuntimePaths,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr("openhands.cli.ensure_runtime_directories", lambda: None)
    monkeypatch.setattr("openhands.cli.load_selection", lambda: None)

    result = main(["run"])
    assert result == 1


def test_main_run_with_provider(
    patched_env: RuntimePaths,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    sel = _make_selection()
    monkeypatch.setattr("openhands.cli.ensure_runtime_directories", lambda: None)
    monkeypatch.setattr("openhands.cli.load_selection", lambda: sel)
    monkeypatch.setattr("openhands.cli.run_loop", lambda selection, max_iterations: None)

    result = main(["run"])
    assert result == 0


def test_main_default_argv(
    patched_env: RuntimePaths,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """main() with no argv reads sys.argv; provide run with a valid selection."""
    import sys

    sel = _make_selection()
    monkeypatch.setattr(sys, "argv", ["agent", "run"])
    monkeypatch.setattr("openhands.cli.ensure_runtime_directories", lambda: None)
    monkeypatch.setattr("openhands.cli.load_selection", lambda: sel)
    monkeypatch.setattr("openhands.cli.run_loop", lambda selection, max_iterations: None)

    result = main()
    assert result == 0
