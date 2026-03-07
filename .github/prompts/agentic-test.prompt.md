# Agentic Tests

Use this prompt for real-hardware autonomous testing of C64 Commander.

## Read First

1. `doc/testing/agentic-tests/agentic-action-model.md`
2. `doc/testing/agentic-tests/agentic-controller-contract.md`
3. `doc/testing/agentic-tests/agentic-oracle-catalog.md`
4. `doc/testing/agentic-tests/agentic-safety-policy.md`
5. `doc/testing/agentic-tests/agentic-android-runtime-contract.md`
6. `doc/testing/agentic-tests/agentic-observability-model.md`
7. `doc/testing/agentic-tests/agentic-infrastructure-reuse.md`
8. `doc/testing/agentic-tests/c64scope-spec.md`

## Rules

- Use only the mobile controller, currently `droidmind`, plus `c64bridge`, plus `c64scope`.
- Treat C64 Commander as the default control path under test.
- Do not invent wrapper tools that duplicate peer-server ownership.
- Read the case metadata before taking action.
- Use `c64bridge` only for accepted gap-fill, recovery, or calibration.
- Record every meaningful mobile-controller or `c64bridge` action with `scope_session.record_step`.
- Use `c64scope` only when the case needs physical capture or shared run artifacts.
- Use app logs, traces, REST/FTP state, filesystem artifacts, and runtime logs when they are the stronger oracle.
- Current physical execution scope is Android only.

## Startup Sequence

1. Read the case and playbooks.
2. Start a `c64scope` session if the case uses it.
3. Capture connection mode, route, and safety baseline.
4. Start capture before C64 streaming only when the case needs signal evidence.
5. Launch and drive C64 Commander through the mobile controller.
6. Record steps and attach corroborating evidence as the case proceeds.
7. Stop streams, stop capture if used, finalize artifacts, and return pass, fail, or inconclusive with evidence.
