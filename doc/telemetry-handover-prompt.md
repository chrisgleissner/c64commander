# Handover Prompt: Finish CI Telemetry + Due Diligence

You are taking over work in the `c64commander` repo on branch `fix/hvsc-crash`.

## Mission
Complete and verify end-to-end CI telemetry implementation across Android, iOS, Web/Docker, and fuzz, ensuring:
1. Resource CSV creation is correct and non-empty.
2. Rendered chart files (SVG + PNG) are generated and valid.
3. Artifacts are uploaded on success and failure.
4. Telemetry gates fail correctly on bad conditions.
5. CI is fully green for the branch head.

## Current Implementation Scope (already in progress)
- Telemetry monitors exist under `ci/telemetry/`:
  - `android/monitor_android.sh`
  - `ios/monitor_ios.sh`
  - `docker/monitor_docker.sh`
  - `linux/monitor_linux_process.sh` (for fuzz host process monitoring)
- Summary/chart tooling exists:
  - `ci/telemetry/summarize_metrics.py`
  - `ci/telemetry/render_charts.py`
- Workflows modified:
  - `.github/workflows/android.yaml`
  - `.github/workflows/ios.yaml`
  - `.github/workflows/web.yaml`
  - `.github/workflows/fuzz.yaml`
- Artifacts expected to include raw telemetry + summaries + charts.
- `.gitignore` updated for Python cache exclusions (`__pycache__/`, `*.py[cod]`).

## Required Due Diligence Tasks

### 1) Validate repository state and diffs
- Inspect `git status` and `git diff` carefully.
- Confirm all intended telemetry changes are present and no unintended regressions.
- Ensure no Python cache files are tracked (`__pycache__`, `.pyc`, `.pyo`).

### 2) Verify telemetry file correctness
For each platform monitor output schema:
- Header must be exactly:
  `timestamp,platform,device,process_name,pid,cpu_percent,rss_kb,threads,pss_kb,dalvik_pss_kb,native_pss_kb,total_pss_kb`
- Numeric semantics:
  - `cpu_percent` float (1 decimal)
  - memory/thread fields integer-or-empty per platform constraints
- Ensure iOS/Docker/Linux leave Android-only PSS columns empty.
- Ensure event log and metadata are written.

### 3) Verify chart generation outputs
- Run chart rendering against synthetic telemetry input and CI-like output directories.
- Confirm:
  - SVG files exist per platform where data exists.
  - PNG files are emitted.
  - PNG signature is valid (`\x89PNG\r\n\x1a\n`) and files are non-trivial size.
- Confirm chart index/summary references are coherent.

### 4) Validate workflow behavior (logic-level)
For `android.yaml`, `ios.yaml`, `web.yaml`, `fuzz.yaml`:
- Monitor starts before test execution.
- Monitor stop runs with `if: always()`.
- Summarize + chart render run with `if: always()`.
- Artifact upload includes raw CSV + events + metadata + summary + charts.
- Telemetry gate runs after upload and fails on:
  - missing/empty CSV
  - monitor non-zero exit code
  - unexpected process disappearance where applicable.

### 5) Validate constrained Docker settings
In `web.yaml`:
- Ensure container is limited to Raspberry Pi Zero 2W-like constraints:
  - memory `512MiB` equivalent (`512m` accepted)
  - 2 CPUs (`--cpus 2`, quota/period set coherently)
- Ensure telemetry captures container CPU/RAM over time during smoke + Playwright checks.

### 6) Run local validation commands (mandatory)
Run and record outcomes:
- `npm run lint`
- `npm run test:coverage`
- `npm run build`
- `./build`

If failures occur, fix root cause (do not skip tests).

### 7) Verify CI green status
- Push changes if needed.
- Query GitHub Actions for current HEAD SHA and verify workflows complete successfully (at least `web`, `android`, `ios`; include `fuzz` if triggered).
- If any workflow fails, triage from logs and fix.

### 8) Verify artifact content from CI (as much as possible)
For successful and/or failed runs where available:
- Confirm telemetry artifacts exist.
- Confirm CSV files are non-empty and contain expected headers.
- Confirm chart PNG/SVG files exist in artifact payload.
- Confirm summary JSON/MD present and parseable.

## Known Risk Areas to Re-check
- Workflow YAML structural integrity after multiple edits.
- Any truncated/malformed shell blocks in workflow `run:` sections.
- Android/iOS monitor robustness under process restarts/disappearance.
- Fuzz telemetry integration accuracy (target process identification + lifecycle).
- Chart renderer behavior when only one sample point exists.

## Definition of Done
Only declare complete when all are true:
1. Local validation commands pass.
2. CI for HEAD is green.
3. Telemetry CSV + PNG/SVG + summaries are confirmed generated and uploaded.
4. Gates enforce failure conditions correctly.
5. No Python cache artifacts are tracked.

## Deliverable format requested at completion
Provide a concise report with:
- Files changed
- Validation commands + pass/fail
- CI run URLs/status for HEAD
- Artifact verification evidence (what files found)
- Any residual limitations or follow-ups
