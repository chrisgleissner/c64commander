"""Shared pytest fixtures for openhands tests."""
from __future__ import annotations

import pytest
from pathlib import Path

from openhands.config import RuntimePaths


@pytest.fixture()
def tmp_paths(tmp_path: Path) -> RuntimePaths:
    """RuntimePaths whose every directory lives under tmp_path."""
    repo = tmp_path / "repo"
    agents = repo / "agents"
    runtime = agents / "runtime"
    state_dir = runtime / "state"
    user_cfg = tmp_path / "user-config"
    return RuntimePaths(
        repo_root=repo,
        agents_root=agents,
        runtime_root=runtime,
        logs_root=runtime / "logs",
        runs_root=runtime / "runs",
        state_root=state_dir,
        c64scope_root=repo / "c64scope",
        android_root=repo / "android",
        user_config_root=user_cfg,
        user_data_root=tmp_path / "user-data",
        provider_state_path=user_cfg / "provider.json",
        copilot_token_dir=user_cfg / "providers" / "copilot",
        loop_state_path=state_dir / "loop-state.json",
        iteration_log_path=state_dir / "iteration-log.md",
    )


@pytest.fixture()
def patched_env(tmp_paths: RuntimePaths, monkeypatch: pytest.MonkeyPatch) -> RuntimePaths:
    """Patch every module that holds path-level globals to use tmp_paths."""
    # Create the directories that tests expect to exist.
    for d in (
        tmp_paths.logs_root,
        tmp_paths.runs_root,
        tmp_paths.state_root,
        tmp_paths.user_config_root,
        tmp_paths.user_data_root,
        tmp_paths.copilot_token_dir,
        tmp_paths.c64scope_root / "artifacts",
    ):
        d.mkdir(parents=True, exist_ok=True)

    import openhands.config as _cfg
    import openhands.logging_utils as _lu
    import openhands.providers as _prov
    import openhands.run_loop as _rl
    import openhands.state as _state
    import openhands.tools as _tools

    monkeypatch.setattr(_cfg, "PATHS", tmp_paths)
    monkeypatch.setattr(_cfg, "LOOP_STATE_PATH", tmp_paths.loop_state_path)
    monkeypatch.setattr(_cfg, "ITERATION_LOG_PATH", tmp_paths.iteration_log_path)

    monkeypatch.setattr(_lu, "ITERATION_LOG_PATH", tmp_paths.iteration_log_path)
    monkeypatch.setattr(_lu, "LOGS_ROOT", tmp_paths.logs_root)
    monkeypatch.setattr(_lu, "ensure_runtime_directories", lambda: None)

    monkeypatch.setattr(_prov, "PROVIDER_STATE_PATH", tmp_paths.provider_state_path)
    monkeypatch.setattr(_prov, "COPILOT_TOKEN_DIR", tmp_paths.copilot_token_dir)
    monkeypatch.setattr(_prov, "ensure_runtime_directories", lambda: None)

    monkeypatch.setattr(_state, "LOOP_STATE_PATH", tmp_paths.loop_state_path)
    monkeypatch.setattr(_state, "ensure_runtime_directories", lambda: None)

    monkeypatch.setattr(_rl, "PATHS", tmp_paths)
    monkeypatch.setattr(_rl, "LOOP_STATE_PATH", tmp_paths.loop_state_path)
    monkeypatch.setattr(
        _rl,
        "VALIDATION_REPORT_PATH",
        tmp_paths.c64scope_root / "artifacts" / "validation-report.md",
    )
    monkeypatch.setattr(_rl, "ensure_runtime_directories", lambda: None)

    monkeypatch.setattr(_tools, "PATHS", tmp_paths)

    # Patch LoopState.save / load default path parameters so that production code
    # that calls state.save() / LoopState.load() with no arguments uses the
    # temporary path rather than the real agents/state/loop-state.json.
    from openhands.state import LoopState as _LoopState

    monkeypatch.setattr(
        _LoopState.save,
        "__defaults__",
        (tmp_paths.loop_state_path,),
    )
    monkeypatch.setattr(
        _LoopState.load.__func__,
        "__defaults__",
        (tmp_paths.loop_state_path,),
    )

    return tmp_paths
