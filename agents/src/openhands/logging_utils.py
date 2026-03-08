from __future__ import annotations

import json
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Mapping

from .config import ITERATION_LOG_PATH, LOGS_ROOT, ensure_runtime_directories, utc_timestamp


SECRET_ENV_MARKERS = ("KEY", "TOKEN", "SECRET", "PASSWORD")


def redact_env(env: Mapping[str, str] | None) -> dict[str, str]:
    if not env:
        return {}
    redacted: dict[str, str] = {}
    for key, value in env.items():
        if any(marker in key.upper() for marker in SECRET_ENV_MARKERS):
            redacted[key] = "<redacted>"
        else:
            redacted[key] = value
    return redacted


def append_iteration_markdown(lines: list[str]) -> None:
    ensure_runtime_directories()
    with ITERATION_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write("\n".join(lines) + "\n")


class LoopLogger:
    def __init__(self, run_id: str) -> None:
        ensure_runtime_directories()
        self.run_id = run_id
        self.log_path = LOGS_ROOT / f"{run_id}.jsonl"

    def event(self, event_type: str, message: str, **data: object) -> None:
        payload = {
            "timestamp": utc_timestamp(),
            "run_id": self.run_id,
            "event_type": event_type,
            "message": message,
            "data": data,
        }
        with self.log_path.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(payload, sort_keys=True) + "\n")


@dataclass
class CommandResult:
    label: str
    command: list[str]
    cwd: str
    exit_code: int
    started_at: str
    finished_at: str
    log_path: str


class CommandFailure(RuntimeError):
    def __init__(self, result: CommandResult, reason: str) -> None:
        super().__init__(reason)
        self.result = result


def run_logged_command(
    logger: LoopLogger,
    label: str,
    command: list[str],
    cwd: Path,
    log_path: Path,
    env: Mapping[str, str] | None = None,
    check: bool = True,
) -> CommandResult:
    ensure_runtime_directories()
    log_path.parent.mkdir(parents=True, exist_ok=True)
    started_at = utc_timestamp()
    logger.event(
        "command_started",
        f"{label} started",
        label=label,
        command=command,
        cwd=str(cwd),
        env=redact_env(env),
        log_path=str(log_path),
    )
    with log_path.open("w", encoding="utf-8") as handle:
        process = subprocess.Popen(
            command,
            cwd=str(cwd),
            env=dict(env) if env else None,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
        )
        assert process.stdout is not None
        for line in process.stdout:
            handle.write(line)
        exit_code = process.wait()
    finished_at = utc_timestamp()
    result = CommandResult(
        label=label,
        command=command,
        cwd=str(cwd),
        exit_code=exit_code,
        started_at=started_at,
        finished_at=finished_at,
        log_path=str(log_path),
    )
    logger.event(
        "command_finished",
        f"{label} finished",
        **asdict(result),
    )
    if check and exit_code != 0:
        raise CommandFailure(result, f"{label} failed with exit code {exit_code}")
    return result


def tail_text(path: Path, line_count: int = 40) -> str:
    if not path.exists():
        return ""
    lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    return "\n".join(lines[-line_count:])
