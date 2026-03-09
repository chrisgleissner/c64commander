# F004 Home quick config + LED/SID controls

## Feature Under Test

Home quick config + LED/SID controls

## Preconditions

- Android device connected and unlocked (`ANDROID_SERIAL=2113b87f`)
- C64U reachable (`C64U_HOST=192.168.1.13`)
- C64 Commander installed (`uk.gleissner.c64commander`)
- Start route target: `/`
- Dependency features in terminal state: F001

## MCP Server Roles

- `droidmind` (primary): launch app, navigate UI, perform all user-facing actions.
- `c64scope` (evidence authority): session lifecycle, screenshots, media capture, assertions, artifact summary.
- `c64bridge` (fallback only): read-only corroboration or hard prerequisite reset/diagnostic when app path cannot do it.

## App-First Policy

1. Do not use `c64bridge` for primary feature execution.
2. If `c64bridge` is used, record:
- exact tool/action
- why app flow was insufficient
- whether action was read-only or recovery
3. If app action cannot be completed deterministically, return `BLOCKED`.

## Execution Steps (Deterministic)

1. Start a `c64scope` session with caseId `F004` and artifact root under `/home/chris/dev/c64/c64commander/doc/testing/agentic-tests/full-app-coverage/runs/`.
2. Use `droidmind` to bring app to `/`.
3. Perform feature actions through app UI only.
4. After each meaningful action, record intermediate assertion and capture app screenshot.
5. Capture corroborating state (logs/config/rest/media) only after app action is completed.
6. Finalize with explicit `PASS`, `FAIL`, or `BLOCKED`.

## Intermediate Assertions Required

- Control value changes are reflected immediately in UI.
- Value round-trip after refresh is consistent.
- Dependent controls remain coherent.

## Evidence Requirements

- App screenshots at each intermediate assertion point.
- C64 screenshots when device-visible behavior is expected.
- App/C64 video capture: optional.
- Session metadata (`session.json`, step timeline, assertions).
- `c64bridge` fallback justification file when fallback occurs.

## PASS Criteria

- Feature behavior observed via app flow matches expected user outcome.
- Evidence set is complete and mapped to `F004`.
- No unresolved contradiction between UI outcome and corroborating state.

## FAIL Criteria

- App-driven feature flow executed but expected outcome not achieved.
- Failure is reproducible or strongly evidenced with artifacts.

## BLOCKED Criteria

- Feature cannot be validly executed due to missing capability, unstable prerequisite, or determinism gap.
- Blocker category and smallest remediation are documented.

## Artifact Output Contract

- Run folder: `/home/chris/dev/c64/c64commander/doc/testing/agentic-tests/full-app-coverage/runs/<run-id>/`
- Mandatory files:
- `result.json` (`PASS|FAIL|BLOCKED`, root cause class, retry recommendation)
- `steps.json`
- `evidence-map.json`
- `post-run-analysis.md`

## Post-Run Analysis (Concise)

- What worked
- What failed or blocked
- Root cause class (`prompt|tool|app|infrastructure|observability|environment|determinism|missing reset capability`)
- Smallest next remediation
