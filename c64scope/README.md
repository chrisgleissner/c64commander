# C64 Scope

This folder is reserved for the standalone `c64scope` MCP server.

Authoritative design documents:

- `doc/testing/agentic-tests/c64scope-spec.md`
- `doc/testing/agentic-tests/agentic-test-architecture.md`
- `doc/testing/agentic-tests/agentic-test-implementation-plan.md`
- `doc/testing/agentic-tests/c64scope-delivery-prompt.md`

Implementation rules:

- keep `c64scope` self-contained in this folder
- do not extend `c64bridge`
- do not extend `droidmind`
- keep tool ownership strictly separated
