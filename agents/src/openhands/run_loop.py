from __future__ import annotations

import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

from .config import (
    APP_ACTIVITY,
    APP_PACKAGE,
    DEFAULT_MAX_ITERATIONS,
    LOOP_STATE_PATH,
    PATHS,
    ensure_runtime_directories,
    iteration_directory,
    iteration_slug,
    new_run_id,
    run_directory,
    utc_timestamp,
)
from .logging_utils import CommandFailure, LoopLogger, append_iteration_markdown, run_logged_command, tail_text
from .providers import ProviderSelection, provider_runtime_env
from .state import LoopState
from .tools import resolve_android_serial, resolve_c64u_host, tool_shell_hints, verify_local_tool_paths


VALIDATION_RESULTS_PATH = PATHS.repo_root / "c64scope" / "artifacts" / "validation-results.json"
VALIDATION_REPORT_PATH = PATHS.repo_root / "c64scope" / "artifacts" / "validation-report.md"


@dataclass
class IterationAssessment:
    classification: str
    issue: str
    openhands_status: str
    build_status: str
    deploy_status: str
    validation_status: str


def snapshot_git_status() -> set[str]:
    completed = subprocess.run(
        ["git", "status", "--short"],
        cwd=str(PATHS.repo_root),
        check=True,
        capture_output=True,
        text=True,
    )
    return {line.rstrip() for line in completed.stdout.splitlines() if line.strip()}


def derive_new_status_entries(before: set[str], after: set[str]) -> list[str]:
    return sorted(after - before)


def build_openhands_prompt(
    iteration: int,
    iteration_dir: Path,
    state: LoopState,
) -> str:
    openhands_log_path = iteration_dir / "openhands" / "iteration-analysis.md"
    shell_hints = "\n".join(f"- {hint}" for hint in tool_shell_hints())
    return f"""You are running an autonomous engineering iteration for C64 Commander.

Repository root: {PATHS.repo_root}
Iteration: {iteration_slug(iteration)}
Current issue: {state.current_issue}
Loop state file: {LOOP_STATE_PATH}
Human-readable loop log: {PATHS.iteration_log_path}
Write iteration log to: {openhands_log_path}

Required workflow for this iteration:
1. Read {PATHS.repo_root / 'README.md'}, {PATHS.repo_root / 'AGENTS.md'}, {PATHS.repo_root / '.github' / 'copilot-instructions.md'}, and {PATHS.agents_root / 'README.md'}.
2. Inspect relevant code, tests, documentation, prior run artifacts, and validation outputs.
3. Make the smallest useful code or tooling change to improve the project.
4. Keep the change narrow. Do not build a new agent framework and do not do a large refactor.
5. Write {openhands_log_path} with:
   - analyze summary
   - root cause
   - files changed
   - tests or checks you ran
   - remaining risks
6. Finish after the smallest useful change is complete.

Important constraints:
- The wrapper will handle Android build, install, app launch, and hardware validation after your change.
- Hardware-related shell tools available in the workspace:
{shell_hints}
- Prefer fixing the app or its validation selectors/observability before changing the loop itself.
"""


def build_openhands_config() -> str:
    return f"""[agent]
runtime = "cli"
enable_jupyter = false
enable_browsing = false
enable_mcp = false
"""


def run_openhands_iteration(
    logger: LoopLogger,
    selection: ProviderSelection,
    state: LoopState,
    iteration: int,
    iteration_dir: Path,
) -> str:
    verify_local_tool_paths()
    openhands_dir = iteration_dir / "openhands"
    openhands_dir.mkdir(parents=True, exist_ok=True)
    prompt_path = openhands_dir / "task.md"
    config_path = openhands_dir / "config.toml"
    prompt_path.write_text(build_openhands_prompt(iteration, iteration_dir, state), encoding="utf-8")
    config_path.write_text(build_openhands_config(), encoding="utf-8")

    env = {
        **os.environ,
        **provider_runtime_env(selection),
        "RUNTIME": "cli",
        "WORKSPACE_BASE": str(PATHS.repo_root),
    }
    run_logged_command(
        logger=logger,
        label="openhands",
        command=[
            "uv",
            "run",
            "--with",
            "openhands-ai",
            "python",
            "-m",
            "openhands.core.main",
            "--config-file",
            str(config_path),
            "-f",
            str(prompt_path),
            "-d",
            str(PATHS.repo_root),
            "-i",
            "12",
        ],
        cwd=PATHS.repo_root,
        log_path=openhands_dir / "openhands.log",
        env=env,
        check=True,
    )
    analysis_path = openhands_dir / "iteration-analysis.md"
    openhands_log = openhands_dir / "openhands.log"
    log_tail = ""
    if openhands_log.exists():
        log_text = openhands_log.read_text(encoding="utf-8", errors="replace")
        log_tail = tail_text(openhands_log)
        if "AgentState.ERROR" in log_text or "BadRequestError" in log_text:
            if "Current iteration:" in log_text and "max iteration:" in log_text:
                analysis_path.write_text(
                    "OpenHands reached its iteration limit before writing the requested analysis.\n\n"
                    "The wrapper continued with build/deploy/validate so the loop still completed.\n\n"
                    f"Recent OpenHands log tail:\n\n{log_tail}\n",
                    encoding="utf-8",
                )
                return f"warning: OpenHands reached its iteration limit.\n{log_tail}"
            raise RuntimeError(f"OpenHands reported an execution error:\n{log_tail}")
    if not analysis_path.exists():
        analysis_path.write_text(
            "OpenHands did not produce the requested iteration analysis file.\n\n"
            f"Recent OpenHands log tail:\n\n{log_tail}\n",
            encoding="utf-8",
        )
        return f"warning: OpenHands did not produce iteration-analysis.md.\n{log_tail}"
    return "success"


def find_debug_apk() -> Path:
    apk_dir = PATHS.repo_root / "android" / "app" / "build" / "outputs" / "apk" / "debug"
    candidates = sorted(apk_dir.glob("*-debug.apk"))
    if not candidates:
        raise RuntimeError(f"Expected a debug APK under {apk_dir}, but none was produced.")
    return candidates[-1]


def run_build(logger: LoopLogger, iteration_dir: Path) -> str:
    build_dir = iteration_dir / "build"
    build_dir.mkdir(parents=True, exist_ok=True)
    run_logged_command(
        logger,
        "scope-build",
        ["npm", "run", "scope:build"],
        PATHS.repo_root,
        build_dir / "01-scope-build.log",
    )
    run_logged_command(
        logger,
        "cap-build",
        ["npm", "run", "cap:build"],
        PATHS.repo_root,
        build_dir / "02-cap-build.log",
    )
    run_logged_command(
        logger,
        "android-apk",
        ["npm", "run", "android:apk"],
        PATHS.repo_root,
        build_dir / "03-android-apk.log",
    )
    find_debug_apk()
    return "success"


def run_deploy(logger: LoopLogger, iteration_dir: Path, serial: str) -> str:
    deploy_dir = iteration_dir / "deploy"
    deploy_dir.mkdir(parents=True, exist_ok=True)
    apk_path = find_debug_apk()
    run_logged_command(
        logger,
        "adb-install",
        ["adb", "-s", serial, "install", "-r", str(apk_path)],
        PATHS.repo_root,
        deploy_dir / "01-adb-install.log",
    )
    run_logged_command(
        logger,
        "adb-force-stop",
        ["adb", "-s", serial, "shell", "am", "force-stop", APP_PACKAGE],
        PATHS.repo_root,
        deploy_dir / "02-force-stop.log",
    )
    run_logged_command(
        logger,
        "adb-launch",
        ["adb", "-s", serial, "shell", "am", "start", "-n", APP_ACTIVITY],
        PATHS.repo_root,
        deploy_dir / "03-launch.log",
    )
    return "success"


def copy_validation_artifacts(destination: Path, before_names: set[str]) -> list[str]:
    source_root = PATHS.repo_root / "c64scope" / "artifacts"
    destination.mkdir(parents=True, exist_ok=True)
    copied: list[str] = []
    after_names = {path.name for path in source_root.iterdir()}
    for special in ("validation-report.md", "validation-results.json"):
        source = source_root / special
        if source.exists():
            target = destination / special
            shutil.copy2(source, target)
            copied.append(target.name)
    new_names = sorted(after_names - before_names)
    for name in new_names:
        source = source_root / name
        target = destination / name
        if source.is_dir():
            shutil.copytree(source, target, dirs_exist_ok=True)
        else:
            shutil.copy2(source, target)
        copied.append(name)
    return copied


def summarize_validation_failure(iteration_dir: Path) -> str:
    summary_candidates = [
        iteration_dir / "validate" / "validation-report.md",
        VALIDATION_REPORT_PATH,
        iteration_dir / "validate" / "01-autonomous-validation.log",
    ]
    for candidate in summary_candidates:
        if candidate.exists():
            content = candidate.read_text(encoding="utf-8", errors="replace").strip()
            if content:
                return "\n".join(content.splitlines()[:20])
    return "Validation failed without a readable report."


def run_validate(logger: LoopLogger, iteration_dir: Path, serial: str, c64u_host: str) -> str:
    validate_dir = iteration_dir / "validate"
    validate_dir.mkdir(parents=True, exist_ok=True)
    artifact_root = PATHS.repo_root / "c64scope" / "artifacts"
    artifact_root.mkdir(parents=True, exist_ok=True)
    before_names = {path.name for path in artifact_root.iterdir()}
    env = {
        **os.environ,
        "ANDROID_SERIAL": serial,
        "C64U_HOST": c64u_host,
        "VALIDATION_TRACK": "product",
    }
    result = run_logged_command(
        logger,
        "autonomous-validation",
        ["node", str(PATHS.repo_root / "c64scope" / "dist" / "autonomousValidation.js")],
        PATHS.repo_root,
        validate_dir / "01-autonomous-validation.log",
        env=env,
        check=False,
    )
    copied = copy_validation_artifacts(validate_dir, before_names)
    logger.event("artifacts_copied", "Validation artifacts copied", artifacts=copied, destination=str(validate_dir))
    if result.exit_code != 0:
        raise CommandFailure(result, f"autonomous-validation failed with exit code {result.exit_code}")
    return "success"


def assess_iteration(
    iteration_dir: Path,
    openhands_status: str,
    build_status: str,
    deploy_status: str,
    validation_status: str,
) -> IterationAssessment:
    if openhands_status.startswith("failed:"):
        return IterationAssessment("FAIL", openhands_status, openhands_status, build_status, deploy_status, validation_status)
    if build_status != "success":
        return IterationAssessment("FAIL", build_status, openhands_status, build_status, deploy_status, validation_status)
    if deploy_status != "success":
        return IterationAssessment("FAIL", deploy_status, openhands_status, build_status, deploy_status, validation_status)
    if validation_status == "success":
        if openhands_status.startswith("warning:"):
            return IterationAssessment("FAIL", openhands_status, openhands_status, build_status, deploy_status, validation_status)
        return IterationAssessment("PASS", "All known requirements passed in this iteration.", openhands_status, build_status, deploy_status, validation_status)
    if validation_status.startswith("blocked"):
        return IterationAssessment("BLOCKED", validation_status, openhands_status, build_status, deploy_status, validation_status)
    return IterationAssessment("FAIL", summarize_validation_failure(iteration_dir), openhands_status, build_status, deploy_status, validation_status)


def run_loop(selection: ProviderSelection, max_iterations: int = DEFAULT_MAX_ITERATIONS) -> None:
    ensure_runtime_directories()
    state = LoopState.load()
    if state.run_id is None or state.last_iteration_classification in {"PASS", "BLOCKED"} or state.next_iteration > max_iterations:
        state = LoopState(run_id=new_run_id(), provider=selection.provider, current_issue="Start from current repo state.")
    else:
        state.provider = selection.provider
    run_dir = run_directory(state.run_id)
    run_dir.mkdir(parents=True, exist_ok=True)
    logger = LoopLogger(state.run_id)
    if not PATHS.iteration_log_path.exists():
        append_iteration_markdown(
            [
                "# Autonomous Loop Log",
                "",
                f"- Active run: `{state.run_id}`",
                f"- Provider: `{selection.label}`",
                f"- Started: `{utc_timestamp()}`",
            ]
        )
    serial = resolve_android_serial(os.environ.get("ANDROID_SERIAL"))
    c64u_host = resolve_c64u_host()
    print(f"Run {state.run_id} using {selection.label}", flush=True)
    print(f"Android device: {serial}", flush=True)
    print(f"C64 Ultimate: {c64u_host}", flush=True)
    logger.event("run_started", "Autonomous loop started", serial=serial, c64u_host=c64u_host, max_iterations=max_iterations)
    while state.next_iteration <= max_iterations:
        iteration = state.next_iteration
        iteration_dir = iteration_directory(state.run_id, iteration)
        iteration_dir.mkdir(parents=True, exist_ok=True)
        print(f"Starting {iteration_slug(iteration)}", flush=True)
        before_status = snapshot_git_status()
        append_iteration_markdown(
            [
                f"## {iteration_slug(iteration)}",
                f"- Started: `{utc_timestamp()}`",
                f"- Current issue: {state.current_issue}",
                f"- Iteration directory: `{iteration_dir}`",
            ]
        )
        openhands_status = "not-run"
        build_status = "not-run"
        deploy_status = "not-run"
        validation_status = "not-run"
        try:
            openhands_status = run_openhands_iteration(logger, selection, state, iteration, iteration_dir)
            build_status = run_build(logger, iteration_dir)
            deploy_status = run_deploy(logger, iteration_dir, serial)
            validation_status = run_validate(logger, iteration_dir, serial, c64u_host)
        except CommandFailure as failure:
            tail = tail_text(Path(failure.result.log_path))
            lower_tail = tail.lower()
            if "preflight failed" in lower_tail or "not ready" in lower_tail or "not reachable" in lower_tail:
                validation_status = f"blocked: {tail or failure}"
            elif failure.result.label.startswith("autonomous-validation"):
                validation_status = f"failed: {tail or failure}"
            elif failure.result.label.startswith("adb-"):
                deploy_status = f"failed: {tail or failure}"
            elif failure.result.label in {"scope-build", "cap-build", "android-apk"}:
                build_status = f"failed: {tail or failure}"
            else:
                openhands_status = f"failed: {tail or failure}"
        except Exception as exc:
            openhands_status = f"failed: {exc}"
            logger.event("iteration_exception", "Iteration failed with unexpected exception", error=str(exc), iteration=iteration)

        after_status = snapshot_git_status()
        changed_status_entries = derive_new_status_entries(before_status, after_status)
        assessment = assess_iteration(iteration_dir, openhands_status, build_status, deploy_status, validation_status)
        append_iteration_markdown(
            [
                f"- OpenHands: `{assessment.openhands_status}`",
                f"- Build: `{assessment.build_status}`",
                f"- Deploy: `{assessment.deploy_status}`",
                f"- Validate: `{assessment.validation_status}`",
                f"- Classification: `{assessment.classification}`",
                f"- New git status entries: `{changed_status_entries}`",
                f"- Ended: `{utc_timestamp()}`",
                "",
            ]
        )
        logger.event(
            "iteration_completed",
            "Iteration completed",
            iteration=iteration,
            iteration_dir=str(iteration_dir),
            assessment=assessment.__dict__,
            changed_status_entries=changed_status_entries,
        )
        state.current_issue = assessment.issue
        state.last_openhands_result = assessment.openhands_status
        state.last_build_result = assessment.build_status
        state.last_deploy_result = assessment.deploy_status
        state.last_validation_result = assessment.validation_status
        state.last_iteration_classification = assessment.classification
        state.last_iteration_dir = str(iteration_dir)
        state.next_iteration = iteration + 1
        state.save()
        print(f"{iteration_slug(iteration)} => {assessment.classification}", flush=True)
        if assessment.classification in {"PASS", "BLOCKED"}:
            break
    logger.event("run_finished", "Autonomous loop finished", loop_state=state.__dict__)
    print(f"Loop finished with {state.last_iteration_classification}.", flush=True)
