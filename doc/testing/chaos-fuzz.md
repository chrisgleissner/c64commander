# Chaos / Fuzz Testing (Playwright)

This document describes the platform-agnostic chaos/fuzz runner built on Playwright. It is designed to run identically in local and CI contexts, and to emit compact, LLM-ready issue summaries.

## Architecture overview

- **Runner**: [playwright/fuzz/chaosRunner.fuzz.ts](../../playwright/fuzz/chaosRunner.fuzz.ts)
- **Launcher**: [scripts/run-fuzz.mjs](../../scripts/run-fuzz.mjs)
- **Artifacts**: `test-results/fuzz/run-<runMode>-<platform>-<seed>/`
- **App contract**: [src/lib/fuzz/fuzzMode.ts](../../src/lib/fuzz/fuzzMode.ts)

The runner executes a series of **fuzz sessions**. Each session starts from a clean app state, records a Playwright video, performs weighted UI actions, and **terminates immediately** on the first detected issue. The session is reset and a new session begins until the run reaches its step or time budget.

## Fuzz mode contract (app-side)

Fuzz mode is enabled by setting:

- `localStorage.c64u_fuzz_mode_enabled = "1"`
- `localStorage.c64u_fuzz_mock_base_url = "http://127.0.0.1:<port>"` (from the Playwright mock server)
- `localStorage.c64u_fuzz_storage_seeded = "1"` (prevents app-side storage reset from wiping seeded fixtures)

When fuzz mode is active:

- **Mock device enforced**: `discoverConnection()` forces demo mode and uses the forced mock base URL.
- **Real device blocked**: REST requests are rejected unless the base URL is local or the forced mock URL.
- **Storage reset**: fuzz defaults clear storage, then set deterministic debug + demo settings.
- **Structured logs**: errors/warnings are persisted via the logging layer and surfaced to the runner.

## Action model & weighting

Actions are finite, weighted, and preconditioned. No random pixel clicks.

- `click` (weight 28): visible buttons/links
- `tab` (10): navigation bar buttons
- `scroll` (12)
- `select` (6): list/menu options
- `type` (8): text inputs
- `toggle` (6): switches/checkboxes
- `modal` (6): open/close dialog
- `navigate` (4): back/forward
- `background` (4): background/resume simulation
- `fault` (3): mock-device fault injection

Every interaction is logged as a single compact line in `sessions/<sessionId>.log`.

## Severity classification

The runner classifies issues into:

- `crash`: page crash or unhandled exception
- `freeze`: action/navigation timeout or unresponsive UI
- `errorLog`: app/console error-level log
- `warnLog`: app/console warning-level log

Detection sources include Playwright page crashes, navigation/action timeouts, console output, and structured app logs.

## Fail-fast session model

On **any** issue:

1. Capture screenshot.
2. Capture route + title (if available).
3. Capture last N interactions (default 50).
4. Close the session video and keep it.
5. Terminate the session immediately.
6. Reset mock server state and start a new clean session.

This prevents error compounding across corrupted states.

## Video capture semantics

Each session records a Playwright video:

- Recording begins at clean launch.
- Stops on issue or session completion.
- Videos are kept **only for failing sessions**.
- Video filenames are deterministic and tied to issue group + session ID.

## Issue grouping strategy

Issues are grouped by a **root-cause signature** composed of:

- Exception type
- Normalized message
- Top 3–5 stack frames

Platform and interaction traces are secondary metadata only.

## Reports (LLM-ready)

Every run emits:

- `fuzz-issue-report.json` (grouped, compact, machine-readable)
- `fuzz-issue-summary.md` (short human summary)

Both are designed to be pasted directly into an LLM prompt.

### LLM usage

Paste `fuzz-issue-summary.md` first, then attach `fuzz-issue-report.json` for structured details. Ask the LLM to propose fixes per issue group ID, using the top frame and last interaction trace for context.

## Reproducing issues

Use the same seed and platform, then re-run:

- Local: `./local-build.sh --fuzz --seed <seed>`
- Script: `node scripts/run-fuzz.mjs --seed <seed>`

The interaction logs and last-N traces in the issue report provide the step index where the failure occurred.

## Safety guarantees

- Always mock-device only.
- Deterministic seed-based randomness.
- No random pixel clicks.
- Recover-and-continue after each failure.
- Bounded artifact output.
