from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path


def utc_timestamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def utc_run_stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


REPO_ROOT = Path(__file__).resolve().parents[3]
AGENTS_ROOT = REPO_ROOT / "agents"
RUNTIME_ROOT = AGENTS_ROOT / "runtime"
LOGS_ROOT = RUNTIME_ROOT / "logs"
RUNS_ROOT = RUNTIME_ROOT / "runs"
STATE_ROOT = RUNTIME_ROOT / "state"
C64SCOPE_ROOT = REPO_ROOT / "c64scope"
ANDROID_ROOT = REPO_ROOT / "android"

USER_CONFIG_ROOT = Path.home() / ".config" / "c64commander-agent"
USER_DATA_ROOT = Path.home() / ".local" / "share" / "c64commander-agent"
PROVIDER_STATE_PATH = USER_CONFIG_ROOT / "provider.json"
COPILOT_TOKEN_DIR = USER_CONFIG_ROOT / "providers" / "copilot"

LOOP_STATE_PATH = STATE_ROOT / "loop-state.json"
ITERATION_LOG_PATH = STATE_ROOT / "iteration-log.md"

DEFAULT_C64U_HOST = os.environ.get("C64U_HOST", "192.168.1.13")
APP_PACKAGE = "uk.gleissner.c64commander"
APP_ACTIVITY = f"{APP_PACKAGE}/.MainActivity"
DEFAULT_MAX_ITERATIONS = int(os.environ.get("AGENT_MAX_ITERATIONS", "5"))


@dataclass(frozen=True)
class RuntimePaths:
    repo_root: Path = REPO_ROOT
    agents_root: Path = AGENTS_ROOT
    runtime_root: Path = RUNTIME_ROOT
    logs_root: Path = LOGS_ROOT
    runs_root: Path = RUNS_ROOT
    state_root: Path = STATE_ROOT
    c64scope_root: Path = C64SCOPE_ROOT
    android_root: Path = ANDROID_ROOT
    user_config_root: Path = USER_CONFIG_ROOT
    user_data_root: Path = USER_DATA_ROOT
    provider_state_path: Path = PROVIDER_STATE_PATH
    copilot_token_dir: Path = COPILOT_TOKEN_DIR
    loop_state_path: Path = LOOP_STATE_PATH
    iteration_log_path: Path = ITERATION_LOG_PATH


PATHS = RuntimePaths()


def ensure_runtime_directories() -> None:
    for path in (
        PATHS.logs_root,
        PATHS.runs_root,
        PATHS.state_root,
        PATHS.user_config_root,
        PATHS.user_data_root,
        PATHS.copilot_token_dir,
    ):
        path.mkdir(parents=True, exist_ok=True)


def new_run_id() -> str:
    return f"run-{utc_run_stamp()}"


def iteration_slug(iteration: int) -> str:
    return f"iteration-{iteration:03d}"


def run_directory(run_id: str) -> Path:
    return PATHS.runs_root / run_id


def iteration_directory(run_id: str, iteration: int) -> Path:
    return run_directory(run_id) / iteration_slug(iteration)
