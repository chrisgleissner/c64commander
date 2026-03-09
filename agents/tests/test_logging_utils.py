"""Tests for openhands.logging_utils."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from openhands.config import RuntimePaths
from openhands.logging_utils import (
    CommandFailure,
    CommandResult,
    LoopLogger,
    append_iteration_markdown,
    redact_env,
    run_logged_command,
    tail_text,
)


# ---------------------------------------------------------------------------
# redact_env
# ---------------------------------------------------------------------------


def test_redact_env_empty() -> None:
    assert redact_env({}) == {}


def test_redact_env_none() -> None:
    assert redact_env(None) == {}


def test_redact_env_redacts_sensitive_keys() -> None:
    env = {
        "MY_API_KEY": "supersecret",
        "OAUTH_TOKEN": "tok",
        "DB_PASSWORD": "pass",
        "MY_SECRET": "s3cr3t",
        "NORMAL_VAR": "show-me",
    }
    result = redact_env(env)
    assert result["MY_API_KEY"] == "<redacted>"
    assert result["OAUTH_TOKEN"] == "<redacted>"
    assert result["DB_PASSWORD"] == "<redacted>"
    assert result["MY_SECRET"] == "<redacted>"
    assert result["NORMAL_VAR"] == "show-me"


def test_redact_env_case_insensitive() -> None:
    result = redact_env({"my_api_key": "secret"})
    assert result["my_api_key"] == "<redacted>"


# ---------------------------------------------------------------------------
# append_iteration_markdown
# ---------------------------------------------------------------------------


def test_append_iteration_markdown_creates_file(
    patched_env: RuntimePaths,
) -> None:
    log_path = patched_env.iteration_log_path
    append_iteration_markdown(["# Header", "line 1"])
    assert log_path.exists()
    content = log_path.read_text()
    assert "# Header" in content
    assert "line 1" in content


def test_append_iteration_markdown_appends(patched_env: RuntimePaths) -> None:
    append_iteration_markdown(["first"])
    append_iteration_markdown(["second"])
    content = patched_env.iteration_log_path.read_text()
    assert "first" in content
    assert "second" in content


# ---------------------------------------------------------------------------
# LoopLogger
# ---------------------------------------------------------------------------


def test_loop_logger_creates_log_file(patched_env: RuntimePaths) -> None:
    logger = LoopLogger("run-test-001")
    logger.event("test_event", "hello", key="value")
    log_file = patched_env.logs_root / "run-test-001.jsonl"
    assert log_file.exists()
    payload = json.loads(log_file.read_text().strip())
    assert payload["event_type"] == "test_event"
    assert payload["message"] == "hello"
    assert payload["data"]["key"] == "value"
    assert payload["run_id"] == "run-test-001"


def test_loop_logger_appends_multiple_events(patched_env: RuntimePaths) -> None:
    logger = LoopLogger("run-multi")
    logger.event("a", "first")
    logger.event("b", "second")
    lines = (patched_env.logs_root / "run-multi.jsonl").read_text().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["event_type"] == "a"
    assert json.loads(lines[1])["event_type"] == "b"


# ---------------------------------------------------------------------------
# CommandResult / CommandFailure
# ---------------------------------------------------------------------------


def _make_result(exit_code: int = 0, label: str = "cmd", log_path: str = "/tmp/x.log") -> CommandResult:
    return CommandResult(
        label=label,
        command=["echo", "hi"],
        cwd="/tmp",
        exit_code=exit_code,
        started_at="2024-01-01T00:00:00Z",
        finished_at="2024-01-01T00:00:01Z",
        log_path=log_path,
    )


def test_command_result_fields() -> None:
    r = _make_result(exit_code=0)
    assert r.label == "cmd"
    assert r.exit_code == 0


def test_command_failure_carries_result() -> None:
    r = _make_result(exit_code=1)
    exc = CommandFailure(r, "it failed")
    assert exc.result is r
    assert "it failed" in str(exc)


# ---------------------------------------------------------------------------
# tail_text
# ---------------------------------------------------------------------------


def test_tail_text_missing_file(tmp_path: Path) -> None:
    assert tail_text(tmp_path / "no-such.log") == ""


def test_tail_text_full_file(tmp_path: Path) -> None:
    log = tmp_path / "out.log"
    log.write_text("line1\nline2\nline3\n")
    result = tail_text(log)
    assert "line1" in result
    assert "line3" in result


def test_tail_text_truncates(tmp_path: Path) -> None:
    log = tmp_path / "big.log"
    lines = [f"line{i}" for i in range(100)]
    log.write_text("\n".join(lines))
    result = tail_text(log, line_count=10)
    result_lines = result.splitlines()
    assert len(result_lines) == 10
    assert result_lines[-1] == "line99"


# ---------------------------------------------------------------------------
# run_logged_command
# ---------------------------------------------------------------------------


def test_run_logged_command_success(patched_env: RuntimePaths, tmp_path: Path) -> None:
    logger = LoopLogger("run-cmd-success")
    log_path = tmp_path / "out.log"
    result = run_logged_command(
        logger=logger,
        label="echo-test",
        command=["echo", "hello-world"],
        cwd=tmp_path,
        log_path=log_path,
        check=True,
    )
    assert result.exit_code == 0
    assert result.label == "echo-test"
    assert log_path.exists()
    assert "hello-world" in log_path.read_text()


def test_run_logged_command_failure_raises(patched_env: RuntimePaths, tmp_path: Path) -> None:
    logger = LoopLogger("run-cmd-fail")
    log_path = tmp_path / "fail.log"
    with pytest.raises(CommandFailure) as exc_info:
        run_logged_command(
            logger=logger,
            label="fail-cmd",
            command=["false"],
            cwd=tmp_path,
            log_path=log_path,
            check=True,
        )
    assert exc_info.value.result.exit_code != 0
    assert exc_info.value.result.label == "fail-cmd"


def test_run_logged_command_check_false_no_raise(
    patched_env: RuntimePaths, tmp_path: Path
) -> None:
    logger = LoopLogger("run-cmd-nocheck")
    log_path = tmp_path / "no-raise.log"
    result = run_logged_command(
        logger=logger,
        label="false-no-check",
        command=["false"],
        cwd=tmp_path,
        log_path=log_path,
        check=False,
    )
    assert result.exit_code != 0


def test_run_logged_command_with_env(patched_env: RuntimePaths, tmp_path: Path) -> None:
    import os

    logger = LoopLogger("run-cmd-env")
    log_path = tmp_path / "env.log"
    env = {**os.environ, "TEST_UNIQUE_VAR": "hello-env"}
    result = run_logged_command(
        logger=logger,
        label="env-test",
        command=["sh", "-c", "echo $TEST_UNIQUE_VAR"],
        cwd=tmp_path,
        log_path=log_path,
        env=env,
        check=True,
    )
    assert result.exit_code == 0
    assert "hello-env" in log_path.read_text()
