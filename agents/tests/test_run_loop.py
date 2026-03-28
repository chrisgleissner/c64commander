"""Tests for openhands.run_loop."""
from __future__ import annotations

import subprocess
from dataclasses import dataclass
from pathlib import Path
from unittest.mock import MagicMock, patch, call

import pytest

from openhands.config import RuntimePaths, iteration_slug
from openhands.logging_utils import CommandFailure, CommandResult, LoopLogger
from openhands.providers import ProviderSelection
from openhands.run_loop import (
    IterationAssessment,
    assess_iteration,
    build_openhands_config,
    build_openhands_prompt,
    copy_validation_artifacts,
    derive_new_status_entries,
    find_debug_apk,
    run_build,
    run_deploy,
    run_loop,
    run_openhands_iteration,
    run_validate,
    snapshot_git_status,
    summarize_validation_failure,
)
from openhands.state import LoopState


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_selection(provider: str = "openai") -> ProviderSelection:
    return ProviderSelection(
        provider=provider,
        label="OpenAI",
        validated_at="2024-01-01T00:00:00Z",
        credential_paths=[],
    )


def _make_result(label: str, exit_code: int, log_path: str = "/tmp/x.log") -> CommandResult:
    return CommandResult(
        label=label,
        command=["cmd"],
        cwd="/tmp",
        exit_code=exit_code,
        started_at="2024-01-01T00:00:00Z",
        finished_at="2024-01-01T00:00:01Z",
        log_path=log_path,
    )


def _make_logger(patched_env: RuntimePaths) -> LoopLogger:
    return LoopLogger("run-test")


# ---------------------------------------------------------------------------
# derive_new_status_entries (pure)
# ---------------------------------------------------------------------------


def test_derive_new_status_entries_empty_before() -> None:
    result = derive_new_status_entries(set(), {"M file.ts", "?? new.ts"})
    assert sorted(result) == ["?? new.ts", "M file.ts"]


def test_derive_new_status_entries_no_change() -> None:
    before = {"M file.ts"}
    result = derive_new_status_entries(before, before)
    assert result == []


def test_derive_new_status_entries_only_new() -> None:
    result = derive_new_status_entries({"M old.ts"}, {"M old.ts", "M new.ts"})
    assert result == ["M new.ts"]


# ---------------------------------------------------------------------------
# snapshot_git_status
# ---------------------------------------------------------------------------


def test_snapshot_git_status_returns_set(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    mock_result = MagicMock()
    mock_result.stdout = " M src/foo.ts\n?? docs/bar.md\n"
    monkeypatch.setattr(
        "openhands.run_loop.subprocess.run",
        lambda *a, **kw: mock_result,
    )
    result = snapshot_git_status()
    # snapshot_git_status uses rstrip() which preserves any leading whitespace.
    assert " M src/foo.ts" in result
    assert "?? docs/bar.md" in result


def test_snapshot_git_status_empty(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    mock_result = MagicMock()
    mock_result.stdout = ""
    monkeypatch.setattr(
        "openhands.run_loop.subprocess.run",
        lambda *a, **kw: mock_result,
    )
    assert snapshot_git_status() == set()


# ---------------------------------------------------------------------------
# build_openhands_prompt / build_openhands_config
# ---------------------------------------------------------------------------


def test_build_openhands_prompt_contains_required_fields(
    patched_env: RuntimePaths,
) -> None:
    state = LoopState(run_id="run-001", current_issue="Fix the bug.")
    prompt = build_openhands_prompt(1, patched_env.runs_root / "run-001" / "iteration-001", state)
    assert "iteration-001" in prompt
    assert "Fix the bug." in prompt
    assert str(patched_env.repo_root) in prompt


def test_build_openhands_config_has_agent_section() -> None:
    cfg = build_openhands_config()
    assert "[agent]" in cfg
    assert 'runtime = "cli"' in cfg
    assert "enable_jupyter = false" in cfg


# ---------------------------------------------------------------------------
# find_debug_apk
# ---------------------------------------------------------------------------


def test_find_debug_apk_finds_apk(patched_env: RuntimePaths) -> None:
    apk_dir = patched_env.repo_root / "android" / "app" / "build" / "outputs" / "apk" / "debug"
    apk_dir.mkdir(parents=True)
    apk = apk_dir / "app-debug.apk"
    apk.write_bytes(b"")
    result = find_debug_apk()
    assert result == apk


def test_find_debug_apk_no_candidates_raises(patched_env: RuntimePaths) -> None:
    apk_dir = patched_env.repo_root / "android" / "app" / "build" / "outputs" / "apk" / "debug"
    apk_dir.mkdir(parents=True)
    with pytest.raises(RuntimeError, match="debug APK"):
        find_debug_apk()


# ---------------------------------------------------------------------------
# summarize_validation_failure
# ---------------------------------------------------------------------------


def test_summarize_uses_validate_report(patched_env: RuntimePaths, tmp_path: Path) -> None:
    iteration_dir = tmp_path / "iter"
    validate_dir = iteration_dir / "validate"
    validate_dir.mkdir(parents=True)
    report = validate_dir / "validation-report.md"
    report.write_text("# Failure\n" + "\n".join(f"line {i}" for i in range(30)))
    result = summarize_validation_failure(iteration_dir)
    assert "# Failure" in result
    assert len(result.splitlines()) <= 20


def test_summarize_uses_global_report(patched_env: RuntimePaths, tmp_path: Path) -> None:
    global_report = patched_env.c64scope_root / "artifacts" / "validation-report.md"
    global_report.write_text("Global failure content")
    result = summarize_validation_failure(tmp_path / "iter-no-local")
    assert "Global failure content" in result


def test_summarize_uses_log_fallback(patched_env: RuntimePaths, tmp_path: Path) -> None:
    iteration_dir = tmp_path / "iter"
    validate_dir = iteration_dir / "validate"
    validate_dir.mkdir(parents=True)
    log_file = validate_dir / "01-autonomous-validation.log"
    log_file.write_text("error: timed out")
    result = summarize_validation_failure(iteration_dir)
    assert "error: timed out" in result


def test_summarize_no_files_returns_default(patched_env: RuntimePaths, tmp_path: Path) -> None:
    result = summarize_validation_failure(tmp_path / "empty-iter")
    assert result == "Validation failed without a readable report."


# ---------------------------------------------------------------------------
# assess_iteration
# ---------------------------------------------------------------------------


def test_assess_openhands_failed(tmp_path: Path) -> None:
    a = assess_iteration(tmp_path, "failed: error", "success", "success", "success")
    assert a.classification == "FAIL"
    assert a.issue == "failed: error"


def test_assess_build_failed(tmp_path: Path) -> None:
    a = assess_iteration(tmp_path, "success", "failed: compile", "success", "success")
    assert a.classification == "FAIL"
    assert a.issue == "failed: compile"


def test_assess_deploy_failed(tmp_path: Path) -> None:
    a = assess_iteration(tmp_path, "success", "success", "failed: adb", "success")
    assert a.classification == "FAIL"
    assert a.issue == "failed: adb"


def test_assess_validation_success_openhands_ok(tmp_path: Path) -> None:
    a = assess_iteration(tmp_path, "success", "success", "success", "success")
    assert a.classification == "PASS"
    assert "passed" in a.issue.lower()


def test_assess_validation_success_with_warning(tmp_path: Path) -> None:
    a = assess_iteration(tmp_path, "warning: limit", "success", "success", "success")
    assert a.classification == "FAIL"
    assert a.issue == "warning: limit"


def test_assess_validation_blocked(tmp_path: Path) -> None:
    a = assess_iteration(tmp_path, "success", "success", "success", "blocked: host down")
    assert a.classification == "BLOCKED"
    assert a.issue.startswith("blocked")


def test_assess_validation_failed_no_report(
    patched_env: RuntimePaths, tmp_path: Path
) -> None:
    # patched_env ensures VALIDATION_REPORT_PATH points to a non-existent temp file.
    a = assess_iteration(tmp_path, "success", "success", "success", "failed: timeout")
    assert a.classification == "FAIL"
    assert a.issue == "Validation failed without a readable report."


# ---------------------------------------------------------------------------
# copy_validation_artifacts
# ---------------------------------------------------------------------------


def test_copy_validation_artifacts_copies_specials(
    patched_env: RuntimePaths, tmp_path: Path
) -> None:
    source_root = patched_env.c64scope_root / "artifacts"
    report = source_root / "validation-report.md"
    report.write_text("# OK")
    results = source_root / "validation-results.json"
    results.write_text("{}")

    dest = tmp_path / "dest"
    copied = copy_validation_artifacts(dest, set())
    assert "validation-report.md" in copied
    assert "validation-results.json" in copied
    assert (dest / "validation-report.md").exists()


def test_copy_validation_artifacts_copies_new_dirs(
    patched_env: RuntimePaths, tmp_path: Path
) -> None:
    source_root = patched_env.c64scope_root / "artifacts"
    new_run_dir = source_root / "run-new"
    new_run_dir.mkdir()
    (new_run_dir / "data.txt").write_text("content")

    dest = tmp_path / "dest"
    copied = copy_validation_artifacts(dest, set())
    assert "run-new" in copied
    assert (dest / "run-new" / "data.txt").exists()


def test_copy_validation_artifacts_skips_before_names(
    patched_env: RuntimePaths, tmp_path: Path
) -> None:
    source_root = patched_env.c64scope_root / "artifacts"
    old_dir = source_root / "old-run"
    old_dir.mkdir()

    dest = tmp_path / "dest"
    copied = copy_validation_artifacts(dest, {"old-run"})
    assert "old-run" not in copied


def test_copy_validation_artifacts_copies_new_files(
    patched_env: RuntimePaths, tmp_path: Path
) -> None:
    source_root = patched_env.c64scope_root / "artifacts"
    new_file = source_root / "extra.json"
    new_file.write_text("{}")

    dest = tmp_path / "dest"
    copied = copy_validation_artifacts(dest, set())
    assert "extra.json" in copied


# ---------------------------------------------------------------------------
# run_openhands_iteration
# ---------------------------------------------------------------------------


def test_run_openhands_iteration_success(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    logger = _make_logger(patched_env)
    selection = _make_selection()
    state = LoopState(run_id="run-001", current_issue="Test.")
    iteration_dir = tmp_path / "iter"

    def mock_verify() -> None:
        pass

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        # Create the openhands log so post-processing finds it.
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("All done successfully.")
        # Create the analysis file that OpenHands should produce.
        analysis = log_path.parent / "iteration-analysis.md"
        analysis.write_text("## Analysis\nEverything looked good.")
        return _make_result("openhands", 0, str(log_path))

    monkeypatch.setattr("openhands.run_loop.verify_local_tool_paths", mock_verify)
    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)
    monkeypatch.setattr("openhands.run_loop.provider_runtime_env", lambda s: {})

    result = run_openhands_iteration(logger, selection, state, 1, iteration_dir)
    assert result == "success"


def test_run_openhands_iteration_no_analysis_file(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    logger = _make_logger(patched_env)
    selection = _make_selection()
    state = LoopState(run_id="run-001", current_issue="Test.")
    iteration_dir = tmp_path / "iter"

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("No error markers, but no analysis file either.")
        return _make_result("openhands", 0, str(log_path))

    monkeypatch.setattr("openhands.run_loop.verify_local_tool_paths", lambda: None)
    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)
    monkeypatch.setattr("openhands.run_loop.provider_runtime_env", lambda s: {})

    result = run_openhands_iteration(logger, selection, state, 1, iteration_dir)
    assert result.startswith("warning:")
    # Synthetic analysis file should have been created.
    analysis = iteration_dir / "openhands" / "iteration-analysis.md"
    assert analysis.exists()


def test_run_openhands_iteration_error_at_limit(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """AgentState.ERROR in log + iteration limit marker → warning."""
    logger = _make_logger(patched_env)
    selection = _make_selection()
    state = LoopState(run_id="run-001", current_issue="Test.")
    iteration_dir = tmp_path / "iter"

    log_content = (
        "AgentState.ERROR some message\n"
        "Current iteration: 12 of max iteration: 12\n"
    )

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text(log_content)
        return _make_result("openhands", 0, str(log_path))

    monkeypatch.setattr("openhands.run_loop.verify_local_tool_paths", lambda: None)
    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)
    monkeypatch.setattr("openhands.run_loop.provider_runtime_env", lambda s: {})

    result = run_openhands_iteration(logger, selection, state, 1, iteration_dir)
    assert result.startswith("warning: OpenHands reached its iteration limit")


def test_run_openhands_iteration_error_not_at_limit(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """AgentState.ERROR in log without iteration limit → raises RuntimeError."""
    logger = _make_logger(patched_env)
    selection = _make_selection()
    state = LoopState(run_id="run-001", current_issue="Test.")
    iteration_dir = tmp_path / "iter"

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("AgentState.ERROR something went wrong badly")
        return _make_result("openhands", 0, str(log_path))

    monkeypatch.setattr("openhands.run_loop.verify_local_tool_paths", lambda: None)
    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)
    monkeypatch.setattr("openhands.run_loop.provider_runtime_env", lambda s: {})

    with pytest.raises(RuntimeError, match="execution error"):
        run_openhands_iteration(logger, selection, state, 1, iteration_dir)


def test_run_openhands_iteration_no_log_file(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """No openhands.log produced → skips log check, then checks for analysis file."""
    logger = _make_logger(patched_env)
    selection = _make_selection()
    state = LoopState(run_id="run-001", current_issue="Test.")
    iteration_dir = tmp_path / "iter"

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        # Don't create log_path or the analysis file.
        log_path.parent.mkdir(parents=True, exist_ok=True)
        return _make_result("openhands", 0, str(log_path))

    monkeypatch.setattr("openhands.run_loop.verify_local_tool_paths", lambda: None)
    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)
    monkeypatch.setattr("openhands.run_loop.provider_runtime_env", lambda s: {})

    result = run_openhands_iteration(logger, selection, state, 1, iteration_dir)
    assert result.startswith("warning:")


# ---------------------------------------------------------------------------
# run_build
# ---------------------------------------------------------------------------


def test_run_build_success(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    logger = _make_logger(patched_env)
    calls: list[str] = []

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        calls.append(label)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("")
        return _make_result(label, 0, str(log_path))

    apk_dir = patched_env.repo_root / "android" / "app" / "build" / "outputs" / "apk" / "debug"
    apk_dir.mkdir(parents=True)
    (apk_dir / "app-debug.apk").write_bytes(b"")

    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)

    result = run_build(logger, tmp_path / "iter")
    assert result == "success"
    assert "scope-build" in calls
    assert "cap-build" in calls
    assert "android-apk" in calls


# ---------------------------------------------------------------------------
# run_deploy
# ---------------------------------------------------------------------------


def test_run_deploy_success(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    logger = _make_logger(patched_env)
    calls: list[str] = []

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        calls.append(label)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("")
        return _make_result(label, 0, str(log_path))

    apk_dir = patched_env.repo_root / "android" / "app" / "build" / "outputs" / "apk" / "debug"
    apk_dir.mkdir(parents=True)
    (apk_dir / "app-debug.apk").write_bytes(b"")

    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)

    result = run_deploy(logger, tmp_path / "iter", "device-123")
    assert result == "success"
    assert "adb-install" in calls
    assert "adb-force-stop" in calls
    assert "adb-launch" in calls


# ---------------------------------------------------------------------------
# run_validate
# ---------------------------------------------------------------------------


def test_run_validate_success(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    logger = _make_logger(patched_env)

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("")
        return _make_result(label, 0, str(log_path))

    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)
    monkeypatch.setattr(
        "openhands.run_loop.copy_validation_artifacts",
        lambda dest, before: [],
    )

    result = run_validate(logger, tmp_path / "iter", "device-123", "192.168.1.1")
    assert result == "success"


def test_run_validate_failure_raises(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    logger = _make_logger(patched_env)

    def mock_run_logged(logger, label, command, cwd, log_path, env=None, check=True):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("fatal error")
        return _make_result(label, 1, str(log_path))

    monkeypatch.setattr("openhands.run_loop.run_logged_command", mock_run_logged)
    monkeypatch.setattr(
        "openhands.run_loop.copy_validation_artifacts",
        lambda dest, before: [],
    )

    with pytest.raises(CommandFailure):
        run_validate(logger, tmp_path / "iter", "device-123", "192.168.1.1")


# ---------------------------------------------------------------------------
# run_loop (integration-level with all I/O mocked)
# ---------------------------------------------------------------------------


def _base_run_loop_mocks(monkeypatch: pytest.MonkeyPatch, patched_env: RuntimePaths) -> None:
    monkeypatch.setattr("openhands.run_loop.resolve_android_serial", lambda s: "device-123")
    monkeypatch.setattr("openhands.run_loop.resolve_c64u_host", lambda: "192.168.1.1")
    monkeypatch.setattr("openhands.run_loop.snapshot_git_status", lambda: set())
    monkeypatch.setattr("openhands.run_loop.append_iteration_markdown", lambda lines: None)


def test_run_loop_pass_on_first_iteration(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)
    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", lambda *a, **kw: "success")

    selection = _make_selection()
    run_loop(selection, max_iterations=3)

    # LoopState.save default path is patched to tmp path via conftest.patched_env.
    state = LoopState.load()
    assert state.last_iteration_classification == "PASS"


def test_run_loop_resumes_after_fail(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)
    # First call fails, second succeeds.
    call_count = {"n": 0}

    def validate_side_effect(*a, **kw):
        call_count["n"] += 1
        if call_count["n"] == 1:
            return "failed: timeout"
        return "success"

    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", validate_side_effect)

    selection = _make_selection()
    run_loop(selection, max_iterations=2)

    state = LoopState.load()
    assert state.last_iteration_classification == "PASS"
    assert call_count["n"] == 2


def test_run_loop_starts_new_run_after_pass(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    # Seed state with PASS classification (patched default path).
    existing = LoopState(
        run_id="run-old",
        provider="openai",
        next_iteration=2,
        last_iteration_classification="PASS",
    )
    existing.save()  # uses patched default path

    _base_run_loop_mocks(monkeypatch, patched_env)
    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", lambda *a, **kw: "success")

    selection = _make_selection()
    run_loop(selection, max_iterations=1)

    state = LoopState.load()
    assert state.run_id != "run-old"


def test_run_loop_starts_new_run_when_over_max(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    # If next_iteration > max_iterations, a new run is started.
    existing = LoopState(
        run_id="run-old",
        provider="openai",
        next_iteration=10,
        last_iteration_classification="FAIL",
    )
    existing.save()  # uses patched default path

    _base_run_loop_mocks(monkeypatch, patched_env)
    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", lambda *a, **kw: "success")

    selection = _make_selection()
    run_loop(selection, max_iterations=3)

    state = LoopState.load()
    assert state.run_id != "run-old"


def test_run_loop_blocked_stops_iterations(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)
    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr(
        "openhands.run_loop.run_validate",
        lambda *a, **kw: "blocked: device offline",
    )

    selection = _make_selection()
    run_loop(selection, max_iterations=5)

    state = LoopState.load()
    assert state.last_iteration_classification == "BLOCKED"
    assert state.next_iteration == 2  # Only ran iteration 1.


def test_run_loop_command_failure_from_adb(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)

    def fail_deploy(*a, **kw):
        log_path = patched_env.runs_root / "fail.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("adb failed")
        result = _make_result("adb-install", 1, str(log_path))
        raise CommandFailure(result, "adb failed")

    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", fail_deploy)
    monkeypatch.setattr("openhands.run_loop.run_validate", lambda *a, **kw: "success")

    selection = _make_selection()
    run_loop(selection, max_iterations=1)

    state = LoopState.load()
    assert state.last_iteration_classification == "FAIL"
    assert state.last_deploy_result is not None
    assert "failed" in state.last_deploy_result


def test_run_loop_command_failure_from_build(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)

    def fail_build(*a, **kw):
        log_path = patched_env.runs_root / "build-fail.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("build error")
        result = _make_result("cap-build", 1, str(log_path))
        raise CommandFailure(result, "build failed")

    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", fail_build)
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", lambda *a, **kw: "success")

    selection = _make_selection()
    run_loop(selection, max_iterations=1)

    state = LoopState.load()
    assert state.last_iteration_classification == "FAIL"
    assert "failed" in state.last_build_result


def test_run_loop_command_failure_from_validation_preflight(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)

    def fail_validate(*a, **kw):
        log_path = patched_env.runs_root / "val-fail.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("preflight failed: device not ready")
        result = _make_result("autonomous-validation", 1, str(log_path))
        raise CommandFailure(result, "preflight failed")

    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", fail_validate)

    selection = _make_selection()
    run_loop(selection, max_iterations=1)

    state = LoopState.load()
    assert state.last_iteration_classification == "BLOCKED"


def test_run_loop_command_failure_from_validation_not_preflight(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)

    def fail_validate(*a, **kw):
        log_path = patched_env.runs_root / "val-err.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("assertion failed: expected green screen")
        result = _make_result("autonomous-validation", 1, str(log_path))
        raise CommandFailure(result, "validation failed")

    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", fail_validate)

    selection = _make_selection()
    run_loop(selection, max_iterations=1)

    state = LoopState.load()
    assert state.last_iteration_classification == "FAIL"


def test_run_loop_command_failure_from_openhands(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)

    def fail_oh(*a, **kw):
        log_path = patched_env.runs_root / "oh-fail.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("openhands crashed")
        result = _make_result("openhands", 1, str(log_path))
        raise CommandFailure(result, "openhands failed")

    monkeypatch.setattr("openhands.run_loop.run_openhands_iteration", fail_oh)
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", lambda *a, **kw: "success")

    selection = _make_selection()
    run_loop(selection, max_iterations=1)

    state = LoopState.load()
    assert state.last_iteration_classification == "FAIL"


def test_run_loop_generic_exception(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    _base_run_loop_mocks(monkeypatch, patched_env)

    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: (_ for _ in ()).throw(ValueError("unexpected")),
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", lambda *a, **kw: "success")

    selection = _make_selection()
    run_loop(selection, max_iterations=1)

    state = LoopState.load()
    assert state.last_iteration_classification == "FAIL"
    assert "unexpected" in state.last_openhands_result


def test_run_loop_resumes_existing_fail_run(
    patched_env: RuntimePaths, monkeypatch: pytest.MonkeyPatch
) -> None:
    existing = LoopState(
        run_id="run-resume",
        provider="copilot",
        next_iteration=2,
        last_iteration_classification="FAIL",
        current_issue="Fix the previous issue.",
    )
    existing.save()  # uses patched default path

    _base_run_loop_mocks(monkeypatch, patched_env)
    monkeypatch.setattr(
        "openhands.run_loop.run_openhands_iteration",
        lambda *a, **kw: "success",
    )
    monkeypatch.setattr("openhands.run_loop.run_build", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_deploy", lambda *a, **kw: "success")
    monkeypatch.setattr("openhands.run_loop.run_validate", lambda *a, **kw: "success")

    selection = _make_selection()
    run_loop(selection, max_iterations=3)

    state = LoopState.load()
    assert state.run_id == "run-resume"
    assert state.last_iteration_classification == "PASS"
