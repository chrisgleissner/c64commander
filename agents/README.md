# C64 Commander Autonomous Agent

This directory contains the minimal OpenHands wrapper for the autonomous
engineering loop.

## Commands

Use the `scripts/agent` script from the `agents/` directory (or adjust your PATH):

```bash
agents/scripts/agent login
agents/scripts/agent run
```

## What `agent login` does

- Lets you pick one provider: `OpenAI`, `Copilot`, or `KiloCode`
- Starts that provider's browser or device-auth flow
- Validates the credential
- Stores agent metadata outside the repository under
  `~/.config/c64commander-agent/`

Provider secrets are never stored in this repository.

## What `agent run` does

`agent run` resumes or starts a loop under `agents/runtime/runs/` and `agents/runtime/state/`.
Each iteration does:

1. Analyze and fix via OpenHands
2. Build the Android app
3. Deploy it to the connected Android device
4. Validate through the Android app using `droidmind` and `c64scope`
5. Collect evidence and classify the iteration as `PASS`, `FAIL`, or `BLOCKED`

## Repository paths

- Detailed machine logs: `agents/runtime/logs/`
- Per-run artifacts: `agents/runtime/runs/`
- Resume state: `agents/runtime/state/loop-state.json`
- Human-readable iteration log: `agents/runtime/state/iteration-log.md`

## Testing

Run the unit tests with branch-coverage reporting from the repository root:

```bash
npm run test:agents
```

The test suite lives in `agents/tests/` and covers all code under
`agents/src/openhands/`. CI enforces ≥90% branch coverage and uploads the results
to Codecov under the `python` flag.

To set up the Python environment locally:

```bash
uv venv .venv
uv pip install --python .venv pytest pytest-cov
```

## Notes

- `adb`, `gradle`, `droidmind`, `c64scope`, and `c64bridge` are available to
  OpenHands through shell commands.
- The wrapper itself uses `c64scope` for the app-first validation pass.
- The loop keeps changes small and relies on existing project tooling.
