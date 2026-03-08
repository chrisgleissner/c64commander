"""Tests for openhands.state."""
from __future__ import annotations

from pathlib import Path

import pytest

from openhands.config import RuntimePaths
from openhands.state import LoopState


def test_loop_state_defaults() -> None:
    state = LoopState()
    assert state.run_id is None
    assert state.provider is None
    assert state.next_iteration == 1
    assert state.current_issue == "No issue recorded yet."
    assert state.last_openhands_result is None
    assert state.last_build_result is None
    assert state.last_deploy_result is None
    assert state.last_validation_result is None
    assert state.last_iteration_classification is None
    assert state.last_iteration_dir is None
    assert state.updated_at is None


def test_loop_state_save_and_load(patched_env: RuntimePaths) -> None:
    path = patched_env.loop_state_path
    state = LoopState(
        run_id="run-001",
        provider="openai",
        next_iteration=3,
        current_issue="Fix the bug.",
    )
    state.save(path)
    assert path.exists()

    loaded = LoopState.load(path)
    assert loaded.run_id == "run-001"
    assert loaded.provider == "openai"
    assert loaded.next_iteration == 3
    assert loaded.current_issue == "Fix the bug."


def test_loop_state_save_sets_updated_at(patched_env: RuntimePaths) -> None:
    path = patched_env.loop_state_path
    state = LoopState(run_id="run-ts")
    state.save(path)
    assert state.updated_at is not None
    import re

    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", state.updated_at)


def test_loop_state_load_nonexistent_returns_defaults(
    patched_env: RuntimePaths,
) -> None:
    missing = patched_env.state_root / "missing.json"
    state = LoopState.load(missing)
    assert state.run_id is None
    assert state.next_iteration == 1


def test_loop_state_round_trip_all_fields(patched_env: RuntimePaths) -> None:
    path = patched_env.loop_state_path
    original = LoopState(
        run_id="run-full",
        provider="copilot",
        next_iteration=7,
        current_issue="Need more tests.",
        last_openhands_result="success",
        last_build_result="success",
        last_deploy_result="success",
        last_validation_result="success",
        last_iteration_classification="PASS",
        last_iteration_dir="/some/path",
        updated_at="2024-06-01T12:00:00Z",
    )
    original.save(path)
    loaded = LoopState.load(path)
    assert loaded.run_id == original.run_id
    assert loaded.provider == original.provider
    assert loaded.next_iteration == original.next_iteration
    assert loaded.last_iteration_classification == original.last_iteration_classification
