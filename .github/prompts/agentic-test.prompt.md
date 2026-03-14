---
description: Run autonomous real-hardware Android tests for C64 Commander using droidmind, c64bridge, and c64scope with evidence-backed outcomes.
---

ROLE

You are executing **agentic real-hardware tests** for the C64 Commander system.

The goal is to drive the mobile application on a physical Android device and validate behavior using the approved controller and hardware-observability tooling.

The system under test is **C64 Commander**.

CONTEXT

The agentic testing system uses:

- a mobile controller (`droidmind`)
- a bridge for device interaction (`c64bridge`)
- a hardware observability system (`c64scope`)

C64 Commander is the **primary control path under test**.

READ FIRST

Before executing any actions, read the following specifications:

1. `doc/testing/agentic-tests/agentic-action-model.md`
2. `doc/testing/agentic-tests/agentic-controller-contract.md`
3. `doc/testing/agentic-tests/agentic-oracle-catalog.md`
4. `doc/testing/agentic-tests/agentic-safety-policy.md`
5. `doc/testing/agentic-tests/agentic-android-runtime-contract.md`
6. `doc/testing/agentic-tests/agentic-observability-model.md`
7. `doc/testing/agentic-tests/agentic-infrastructure-reuse.md`
8. `doc/testing/agentic-tests/c64scope-spec.md`

TOOLS

Allowed tools:

- `droidmind`
- `c64bridge`
- `c64scope`

Do not introduce additional wrappers or duplicate functionality already owned by these systems.

RULES

- Use **C64 Commander** as the primary device control interface.
- Read test case metadata before executing actions.
- Use `c64bridge` only for gap-fill, calibration, or recovery operations.
- Record all meaningful actions using:

  `scope_session.record_step`

- Use `c64scope` only when the test case requires physical capture or shared artifacts.
- Prefer stronger oracles when available, including:
  - application logs
  - traces
  - REST or FTP state
  - filesystem artifacts
  - runtime logs

- Current physical execution scope is **Android only**.

WORKFLOW

1. Read the test case and relevant playbooks.
2. Start a `c64scope` session if the case requires physical capture.
3. Capture connection mode, routing, and safety baseline.
4. Start capture before C64 signal streaming only when required for signal evidence.
5. Launch and drive C64 Commander using the mobile controller.
6. Record steps and attach supporting evidence throughout execution.
7. Stop streaming and stop capture if active.
8. Finalize artifacts and return one of:

- pass
- fail
- inconclusive

Each outcome must include supporting evidence.
