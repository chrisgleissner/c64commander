# C64 Scope

Physical-evidence MCP server for autonomous C64 Commander hardware testing.

## Quick start

```bash
cd c64scope
npm install
npm run check          # build + test
npm run mcp            # start MCP server (stdio transport)
node scripts/start.mjs # bootstrap deps if needed, then start from TypeScript
```

## Repository scripts (from root)

```bash
npm run scope:build          # compile TypeScript
npm run scope:test           # run unit tests
npm run scope:test:coverage  # run tests with coverage
npm run scope:check          # build + test
npm run scope:mcp            # start MCP server
npm run scope:preflight      # check lab prerequisites
```

The workspace MCP launcher at `.vscode/mcp.json` now starts `c64scope/scripts/start.mjs`, so `c64scope` remains self-contained and can bootstrap its own package dependencies on first start.

## Preflight checks

Before running agentic tests against real hardware, verify lab readiness:

```bash
# Full preflight (requires device + C64U)
npm run scope:preflight

# CI dry-run (skips hardware checks)
npm run scope:preflight -- --dry-run

# With specific device and C64U host
ANDROID_SERIAL=<serial from src/deviceRegistry.ts> C64U_HOST=192.168.1.13 npm run scope:preflight
```

Preflight verifies: Node.js version, adb availability, Android device connected, C64U reachable, app installed.

## Artifact conventions

Session artifacts are stored under `c64scope/artifacts/<run-id>/`:

```
artifacts/
  pt-20260307T140000Z/
    session.json          # full session timeline, steps, evidence, assertions
    summary.md            # human-readable run summary
    *.png                 # screenshot evidence
    *.json                # diagnostics exports, state snapshots
```

Server logs go to `c64scope/logs/` (gitignored).

Both `artifacts/` and `logs/` are gitignored.

## Architecture

Three peer MCP servers are orchestrated by a single LLM:

| Peer                                                      | Role                                                      |
| --------------------------------------------------------- | --------------------------------------------------------- |
| [Droidmind](https://github.com/hyperb1iss/droidmind)      | App lifecycle, UI interaction, screenshots, logcat        |
| [C64 Bridge](https://github.com/chrisgleissner/c64bridge) | Stream start/stop, RAM reads, emergency recovery          |
| C64 Scope (this server)                                   | Evidence capture, session timeline, assertions, artifacts |

## Design documents

- [C64 Scope Spec](../docs/testing/agentic-tests/c64scope-spec.md)
- [Agentic Test Architecture](../docs/testing/agentic-tests/agentic-test-architecture.md)
- [Agentic Test Implementation](../docs/testing/agentic-tests/agentic-test-implementation-plan.md)
- [Agentic Oracle Catalog](../docs/testing/agentic-tests/agentic-oracle-catalog.md)

## Implementation rules

- Keep `c64scope` self-contained in this folder.
- Do not extend `c64bridge` or `droidmind`.
- Keep tool ownership strictly separated.
