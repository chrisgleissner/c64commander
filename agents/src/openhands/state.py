from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

from .config import LOOP_STATE_PATH, ensure_runtime_directories, utc_timestamp


@dataclass
class LoopState:
    run_id: str | None = None
    provider: str | None = None
    next_iteration: int = 1
    current_issue: str = "No issue recorded yet."
    last_openhands_result: str | None = None
    last_build_result: str | None = None
    last_deploy_result: str | None = None
    last_validation_result: str | None = None
    last_iteration_classification: str | None = None
    last_iteration_dir: str | None = None
    updated_at: str | None = None

    def save(self, path: Path = LOOP_STATE_PATH) -> None:
        ensure_runtime_directories()
        self.updated_at = utc_timestamp()
        path.write_text(json.dumps(asdict(self), indent=2) + "\n", encoding="utf-8")

    @classmethod
    def load(cls, path: Path = LOOP_STATE_PATH) -> "LoopState":
        ensure_runtime_directories()
        if not path.exists():
            return cls()
        data = json.loads(path.read_text(encoding="utf-8"))
        return cls(**data)
