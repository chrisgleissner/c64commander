# Agentic Test Implementation Plan

## Objective

Deliver one actually working autonomous physical LLM-driven regression that:

- runs against the real Android device and real C64 Ultimate
- uses only `c64bridge`, `droidmind`, and `c64scope`
- plays a short mixed queue of `prg`, `crt`, `mod`, `sid`, `d64`, `d71`, and `d81`
- verifies playback start for each item
- verifies automatic progression across the full queue
- verifies emitted video and audio for each item
- emits a complete artifact bundle for triage

## Hard Rules

- [ ] Keep `c64scope` in a dedicated top-level `c64scope/` folder.
- [ ] Do not modify `c64bridge`.
- [ ] Do not modify `droidmind`.
- [ ] Do not add duplicate control tools already owned by those servers.
- [ ] Do not rely on Maestro for the baseline end-to-end physical regression.
- [ ] Use C64 Commander wherever it already supports the required C64 action.
- [ ] Use `c64bridge` only for fast RAM assertions, fast stream start/stop, emergency recovery, or infrastructure-only calibration.

## Phase 0: Contract Freeze

### Deliverables

- [ ] Finalize [c64scope-spec.md](./c64scope-spec.md).
- [ ] Finalize [agentic-test-architecture.md](./agentic-test-architecture.md).
- [ ] Freeze the first test-case manifest shape and artifact contract.

### Tasks

- [ ] Confirm the final `c64scope` tool groups: `scope_session`, `scope_lab`, `scope_capture`, `scope_assert`, `scope_artifact`, `scope_catalog`.
- [ ] Freeze the required resource URIs and prompt names.
- [ ] Freeze the failure taxonomy and timeline schema.
- [ ] Freeze the mixed-format playback manifest schema.
- [ ] Freeze the app-first control policy and the allowed `c64bridge` exceptions.

### Exit Criteria

- [ ] No unresolved architectural ambiguity remains about server ownership.
- [ ] The first end-to-end case can be described without inventing new cross-server wrappers.

## Phase 1: `c64scope` Server Skeleton

### Deliverables

- [ ] Create `c64scope/package.json` and server entrypoint.
- [ ] Implement MCP registration for tools, resources, and prompts.
- [ ] Add configuration loading for artifact root, bind host, and port reservation range.

### Tasks

- [ ] Create `c64scope/src/server.ts`.
- [ ] Create `c64scope/src/config/` for lab profile and defaults.
- [ ] Create `c64scope/src/resources/` for playbooks, schemas, and case metadata.
- [ ] Create `c64scope/src/prompts/` for the two required prompts.
- [ ] Add unit tests that prove the server exposes the expected surface.
- [ ] Encode the app-first rule directly in case metadata and playbooks so the LLM discovers it instead of inferring it.

### Exit Criteria

- [ ] An MCP client can list the `c64scope` tools, resources, and prompts.
- [ ] `scope_session.start` can create a run directory and reserve endpoints.

## Phase 2: Capture Engine

### Deliverables

- [ ] Working UDP video receiver.
- [ ] Working UDP audio receiver.
- [ ] JSONL feature stream writers.
- [ ] Capture status and health metrics.

### Tasks

- [ ] Implement video packet validation and frame assembly.
- [ ] Implement audio packet validation and PCM windowing.
- [ ] Implement bounded reorder buffering and stale-frame detection.
- [ ] Implement `scope_capture.start`, `scope_capture.status`, `scope_capture.stop`.
- [ ] Implement `scope_lab.calibrate` baseline capture.
- [ ] Add fixture-driven tests for packet parsing, wraparound handling, and stale-frame behavior.

### Exit Criteria

- [ ] `c64bridge` can stream into `c64scope` and `c64scope` can persist valid feature files.
- [ ] Capture health metrics identify packet loss and receiver degradation.
- [ ] The capture design assumes `c64bridge` stream toggling only, not general direct-C64 media control.

## Phase 3: Feature Extraction And Assertions

### Deliverables

- [ ] Video feature extraction.
- [ ] Audio feature extraction.
- [ ] Assertion engine.
- [ ] Failure classification.

### Tasks

- [ ] Compute video features: histogram, dominant colours, text hash, frame diff, all-white/all-black markers.
- [ ] Compute audio features: RMS, dominant frequency, peak amplitude, silence flag, envelope transitions.
- [ ] Implement `frame_change_within`, `colour_signature`, `tone_present`, `silence_window`, `av_alignment`, `progression_detected`, `packet_health`, `state_signal_consistency`.
- [ ] Add tests for positive and negative assertion cases using deterministic captured fixtures.
- [ ] Validate confidence and evidence payload shape.

### Exit Criteria

- [ ] The assertion engine can prove or reject short deterministic clips without human judgment.
- [ ] Progression detection works across at least two adjacent synthetic items.

## Phase 4: Artifact Pipeline

### Deliverables

- [ ] Session manifest writer.
- [ ] Timeline writer.
- [ ] Failure bundle generator.
- [ ] MP4 mux pipeline.
- [ ] Human-readable `README.md` generator.

### Tasks

- [ ] Implement `scope_session.record_step` and `timeline.jsonl` schema validation.
- [ ] Implement `scope_artifact.pin_frame`, `pin_audio_excerpt`, `attach_state_ref`, `mark_failure`, `finalize`.
- [ ] Integrate `ffmpeg` to build `recording.mp4` from captured C64 video/audio.
- [ ] Add tests for artifact directory shape and manifest completeness.

### Exit Criteria

- [ ] A failed run can be debugged from artifacts alone.
- [ ] A passing run still produces a complete `README.md`, `session.json`, and `recording.mp4`.

## Phase 5: Mixed-Format Smoke Corpus

### Deliverables

- [ ] One short verified media item for each required format.
- [ ] One mixed-queue case manifest.
- [ ] Expected A/V signatures for every item.
- [ ] A staging plan that makes every item reachable through C64 Commander.

### Tasks

- [ ] Select or create one deterministic short item each for `prg`, `crt`, `mod`, `sid`, `d64`, `d71`, and `d81`.
- [ ] Ensure every item has a distinct visual signature; add audio signatures where applicable.
- [ ] For every item, define whether it is prepositioned on C64U storage or placed via `adb` into app-visible Android storage.
- [ ] For disk-image items, define the exact app-driven boot or launch behavior so the LLM can prove progression without guessing.
- [ ] Store the queue order and expectations in a repository-owned case manifest exposed by `scope_catalog.get_case`.
- [ ] Add at least one calibration fixture that can be started directly through `c64bridge` when infrastructure debugging is needed.

### Exit Criteria

- [ ] Every queue item has a deterministic expectation set.
- [ ] No item in the smoke queue requires subjective visual interpretation.
- [ ] Every item is reachable through the app path being tested.

## Phase 6: LLM Bootstrap Files And MCP Wiring

### Deliverables

- [ ] Delivery prompt in `doc/testing/agentic-tests/`.
- [ ] Copilot prompt file.
- [ ] OpenCode agent file.
- [ ] Example MCP configuration snippets for local use.

### Tasks

- [ ] Keep [c64scope-delivery-prompt.md](./c64scope-delivery-prompt.md) aligned with the final tool names, required reading list, and delivery phases.
- [ ] Keep [.github/prompts/autonomous-physical-playback.prompt.md](../../../.github/prompts/autonomous-physical-playback.prompt.md) aligned with the final tool names.
- [ ] Keep [.opencode/agents/c64-physical-test-orchestrator.md](../../../.opencode/agents/c64-physical-test-orchestrator.md) aligned with the final tool names.
- [ ] Add documented example server entries for `c64bridge`, `droidmind`, and `c64scope` without changing the repo's active MCP config prematurely.
- [ ] Verify that the bootstrap files explicitly tell the LLM to read `scope_catalog.get_case` before acting.
- [ ] Verify that the bootstrap files state clearly that media start/stop and normal C64 control must go through C64 Commander whenever the app supports them.

### Exit Criteria

- [ ] A fresh Copilot or OpenCode session can discover the intended workflow without human restatement.

## Phase 7: End-to-End Autonomous Run

### Deliverables

- [ ] One passing fully autonomous run on real hardware.
- [ ] One intentionally broken run proving failure evidence quality.

### Tasks

- [ ] Start a `c64scope` session and capture.
- [ ] Start C64 video/audio streaming through `c64bridge` to the reserved endpoints.
- [ ] Ensure the mixed-format media corpus is available either on prepositioned C64U storage or in app-visible Android storage via `adb`.
- [ ] Use `droidmind` to launch C64 Commander, build the queue, and trigger playback through the app UI.
- [ ] Record every meaningful peer-server action with `scope_session.record_step`.
- [ ] Use `c64bridge` only for fast RAM assertions, fast stream start/stop, or recovery during the run.
- [ ] For each queue item, assert start signature, dwell, and automatic progression.
- [ ] Stop the run cleanly and finalize artifacts.
- [ ] Repeat once with a deliberately wrong expectation to prove bundle quality and failure classification.

### Exit Criteria

- [ ] The LLM completes the queue without manual intervention.
- [ ] The final run order matches the manifest exactly.
- [ ] Every item has at least one passing A/V assertion.
- [ ] Failure bundles point to the exact broken item and transition when expectations are deliberately wrong.
- [ ] The run proves that media start/stop and normal control were exercised through C64 Commander, not bypassed through `c64bridge`.

## Phase 8: Hardening

### Deliverables

- [ ] Retry guidance.
- [ ] Operational thresholds.
- [ ] Regression entrypoint for repeated use.

### Tasks

- [ ] Define retry rules for infrastructure failures versus product failures.
- [ ] Define packet-loss thresholds that force inconclusive or infrastructure-failure verdicts.
- [ ] Add a named physical regression entrypoint that references the mixed-format case.
- [ ] Document long-run cleanup: stream stop, app stop, state reset, artifact retention.
- [ ] Add regression tests for timeline completeness and manifest validation.

### Exit Criteria

- [ ] Repeated autonomous runs are stable enough to be used as a real regression tool.

## Definition Of Done

The implementation is complete only when all items below are true.

- [ ] `c64scope` exists as a standalone MCP server in `c64scope/`.
- [ ] `c64bridge` and `droidmind` remain unmodified.
- [ ] The LLM can discover the case through `c64scope` resources or catalog tools.
- [ ] The LLM can execute the mixed-format queue using only the three MCP servers.
- [ ] The LLM uses C64 Commander for media start/stop and normal C64 control wherever the app supports them.
- [ ] The LLM can prove automatic progression through `prg`, `crt`, `mod`, `sid`, `d64`, `d71`, and `d81`.
- [ ] The run produces complete artifacts, including `recording.mp4` and `README.md`.
- [ ] A deliberately broken run produces a precise failure bundle.
