# Runs Index

This index links feature prompts to concrete execution artifacts.

## Run Catalog

| Run Label | Type | Run IDs | Artifact Path | Notes |
| --- | --- | --- | --- | --- |
| `fac-20260308T103247Z-mcp-probe` | MCP capability probe | n/a | [fac-20260308T103247Z-mcp-probe.json](/home/chris/dev/c64/c64commander/doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T103247Z-mcp-probe.json) | Verified all three MCP servers callable; sample calls succeeded. |
| `autonomous-product-20260308T112608Z` | Product-track app-first validation | `pt-20260308T112608Z`…`pt-20260308T112856Z` | `/home/chris/dev/c64/c64commander/c64scope/artifacts/validation-results.json` | 8/8 expected product outcomes matched. |
| `fac-20260308T113247Z-executor-manifest` | Full feature executor (intermediate) | mixed feature-mapped runs | [fac-20260308T113247Z-executor-manifest.json](/home/chris/dev/c64/c64commander/doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113247Z-executor-manifest.json) | Intermediate pass after primary blocker fix; surfaced route-focus flake. |
| `fac-20260308T113632Z-executor-manifest` | Full feature executor (converged) | mixed feature-mapped runs | [fac-20260308T113632Z-executor-manifest.json](/home/chris/dev/c64/c64commander/doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.json) | Canonical final mapping for all 23 features (`PASS:23`, `FAIL:0`, `BLOCKED:0`). |

## Prompt-to-Run Mapping

Use the converged executor manifest as source of truth:

- JSON: [fac-20260308T113632Z-executor-manifest.json](/home/chris/dev/c64/c64commander/doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.json)
- Summary: [fac-20260308T113632Z-executor-manifest.md](/home/chris/dev/c64/c64commander/doc/testing/agentic-tests/full-app-coverage/runs/fac-20260308T113632Z-executor-manifest.md)
