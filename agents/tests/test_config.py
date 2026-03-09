"""Tests for openhands.config."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

from openhands.config import (
    APP_ACTIVITY,
    APP_PACKAGE,
    DEFAULT_MAX_ITERATIONS,
    RuntimePaths,
    iteration_directory,
    iteration_slug,
    new_run_id,
    run_directory,
    utc_run_stamp,
    utc_timestamp,
)


def test_utc_timestamp_format() -> None:
    ts = utc_timestamp()
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", ts), ts


def test_utc_run_stamp_format() -> None:
    stamp = utc_run_stamp()
    assert re.fullmatch(r"\d{8}T\d{6}Z", stamp), stamp


def test_iteration_slug_zero_pads() -> None:
    assert iteration_slug(1) == "iteration-001"
    assert iteration_slug(42) == "iteration-042"
    assert iteration_slug(999) == "iteration-999"


def test_new_run_id_format() -> None:
    run_id = new_run_id()
    assert re.fullmatch(r"run-\d{8}T\d{6}Z", run_id), run_id


def test_run_directory(tmp_paths: RuntimePaths) -> None:
    import openhands.config as cfg
    from unittest.mock import patch

    with patch.object(cfg, "PATHS", tmp_paths):
        result = run_directory("run-abc")
    assert result == tmp_paths.runs_root / "run-abc"


def test_iteration_directory(tmp_paths: RuntimePaths) -> None:
    import openhands.config as cfg
    from unittest.mock import patch

    with patch.object(cfg, "PATHS", tmp_paths):
        result = iteration_directory("run-abc", 3)
    assert result == tmp_paths.runs_root / "run-abc" / "iteration-003"


def test_app_constants() -> None:
    assert APP_PACKAGE == "uk.gleissner.c64commander"
    assert APP_ACTIVITY == f"{APP_PACKAGE}/.MainActivity"


def test_default_max_iterations_positive() -> None:
    assert DEFAULT_MAX_ITERATIONS >= 1


def test_ensure_runtime_directories_creates_dirs(
    tmp_paths: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    import openhands.config as cfg

    monkeypatch.setattr(cfg, "PATHS", tmp_paths)

    cfg.ensure_runtime_directories()

    assert tmp_paths.logs_root.is_dir()
    assert tmp_paths.runs_root.is_dir()
    assert tmp_paths.state_root.is_dir()
    assert tmp_paths.user_config_root.is_dir()
    assert tmp_paths.user_data_root.is_dir()
    assert tmp_paths.copilot_token_dir.is_dir()


def test_ensure_runtime_directories_idempotent(
    tmp_paths: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    import openhands.config as cfg

    monkeypatch.setattr(cfg, "PATHS", tmp_paths)
    cfg.ensure_runtime_directories()
    # Second call must not raise.
    cfg.ensure_runtime_directories()


def test_runtime_paths_defaults_are_paths() -> None:
    from openhands.config import PATHS

    assert isinstance(PATHS.repo_root, Path)
    assert isinstance(PATHS.agents_root, Path)
    assert isinstance(PATHS.logs_root, Path)
    assert isinstance(PATHS.runs_root, Path)
    assert isinstance(PATHS.state_root, Path)


def test_runtime_paths_custom_fields(tmp_paths: RuntimePaths) -> None:
    assert tmp_paths.repo_root.name == "repo"
    assert tmp_paths.agents_root.name == "agents"
    assert tmp_paths.logs_root.name == "logs"
