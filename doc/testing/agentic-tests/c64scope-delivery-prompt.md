# C64 Scope Delivery Prompt

## Purpose

This is the execution prompt for an LLM that must introduce `c64scope` into this repository and carry the work to a genuinely usable end state.

The goal is not to sketch the idea. The goal is to deliver a working `c64scope` MCP server, keep server boundaries intact, and prove one fully autonomous real-hardware regression end to end.

## Immediate Required Reading

Read these files in order before proposing architecture changes or writing code:

1. [c64scope-spec.md](./c64scope-spec.md)
   The single authoritative `c64scope` specification. This defines server boundaries, MCP contracts, artifacts, failure classes, discovery resources, and the canonical autonomous flow.
2. [agentic-test-architecture.md](./agentic-test-architecture.md)
   The cross-server ownership model. This is where app-first control, `record_step`, discovery layering, and the three-server orchestration model are defined.
3. [agentic-test-implementation-plan.md](./agentic-test-implementation-plan.md)
   The required delivery sequence, exit criteria, and definition of done.
4. [c64u-stream-spec.md](../../c64/c64u-stream-spec.md)
   The authoritative stream protocol needed for packet parsing, frame assembly, sample timing, PAL/NTSC handling, and receiver design.
5. [developer.md](../../developer.md)
   The repository build, validation, and workflow contract. Use this for validation commands, formatting expectations, and build discipline.

Do not begin implementation until all five have been read.

## Phase-Gated Required Reading

Read these files before entering the listed phases:

1. [c64u-openapi.yaml](../../c64/c64u-openapi.yaml)
   Read before Phase 7 or any work that depends on concrete C64U media/control assumptions, fixture launch behavior, or direct calibration flows.
2. [c64u-ftp.md](../../c64/c64u-ftp.md)
   Read before Phase 7 or any work that depends on staging media onto C64U-visible storage.
3. [physical-device-matrix.md](../physical-device-matrix.md)
   Read before Phase 8 and before claiming real-hardware completion.
4. [tracing-spec.md](../../diagnostics/tracing-spec.md)
   Read before Phase 5 if you need to align artifact, timeline, or evidence semantics with existing repository diagnostics conventions.

## Non-Negotiable Constraints

1. Use only three peer MCP servers: `c64bridge`, `droidmind`, and `c64scope`.
2. Do not extend `c64bridge`.
3. Do not extend `droidmind`.
4. Do not duplicate tool ownership already covered by those servers.
5. Keep `c64scope` in its own top-level `c64scope/` folder.
6. Treat C64 Commander as the primary control path under test.
7. Use `c64bridge` only for fast stream start/stop, fast RAM assertions, recovery, or infrastructure-only calibration.
8. Require the LLM to read `scope_catalog.get_case` and relevant playbooks before acting.
9. Record every meaningful `c64bridge` or `droidmind` action through `scope_session.record_step`.
10. Deliver evidence-first artifacts for both passing and failing runs.

## Operating Rules

1. Do not invent wrapper APIs that hide existing MCP tool ownership.
2. Do not bypass the app for normal media start/stop or normal C64 control that C64 Commander already supports.
3. Do not leave architecture ambiguity unresolved before coding the affected phase.
4. Do not mark a phase complete until its exit criteria are satisfied with concrete evidence.
5. Do not stop at server scaffolding. The work is incomplete until the mixed-format autonomous regression actually runs end to end on real hardware.

## Delivery Phases

Work in order. At the end of each phase, update the implementation checklist and record what is complete, what remains, and what evidence proves it.

### Phase 0: Contract Lock

Outcome:
- one authoritative spec surface
- frozen tool groups
- frozen resources and prompts
- frozen artifact and failure taxonomy
- frozen mixed-format case shape

Required actions:
1. Re-read the three `agentic-tests` documents and confirm there is no unresolved ownership conflict.
2. Freeze tool names, response envelopes, artifact layout, failure classes, and case schema.
3. Eliminate ambiguity before any protocol or server implementation starts.

Exit criteria:
- `c64scope-spec.md` is internally consistent.
- The first end-to-end case can be described without inventing new wrappers.

### Phase 1: Server Skeleton And Discovery Surface

Outcome:
- runnable `c64scope` MCP server shell
- registered tools, resources, and prompts
- repository-owned case metadata and playbooks

Required actions:
1. Create `c64scope/package.json`, entrypoint, config loading, and MCP registration.
2. Add `scope_session`, `scope_lab`, `scope_capture`, `scope_assert`, `scope_artifact`, and `scope_catalog` registrations.
3. Add tests proving the server exposes the expected MCP surface.
4. Encode the app-first rule directly into resources and prompts so the LLM discovers it instead of inferring it.

Exit criteria:
- An MCP client can list all required tools, resources, and prompts.
- `scope_session.start` can create a run directory and reserve capture endpoints.

### Phase 2: Stream Protocol Fidelity

Outcome:
- deterministic parsing and assembly of C64U stream packets
- PAL/NTSC correctness
- receiver behavior proven against packet-order and loss edge cases

Required actions:
1. Derive the receiver design directly from [c64u-stream-spec.md](../../c64/c64u-stream-spec.md).
2. Implement video packet validation, line/frame assembly, sequence handling, and last-packet semantics.
3. Implement audio packet parsing, sample windowing, and exact-rate aware timing.
4. Add fixture-driven tests for reorder, drop, wraparound, stale frames, and calibration warm-up behavior.

Exit criteria:
- The capture engine can consume valid C64U streams deterministically.
- Packet-level edge cases are covered by automated tests.

### Phase 3: Capture Engine And Health

Outcome:
- live UDP receivers
- bounded buffering
- health metrics
- snapshots and recent-window access

Required actions:
1. Implement `scope_capture.start`, `status`, `snapshot`, `recent_video`, `recent_audio`, and `stop`.
2. Implement `scope_lab.inspect` and `scope_lab.calibrate`.
3. Persist JSONL feature streams incrementally without waiting for finalization.
4. Surface packet loss, stale frames, start times, and degradation indicators.

Exit criteria:
- `c64bridge` can stream into `c64scope`.
- `c64scope` can persist valid JSONL feature output and report receiver health clearly.

### Phase 4: Feature Extraction And Assertions

Outcome:
- deterministic video and audio features
- assertion engine with confidence and evidence
- progression detection suitable for autonomous runs

Required actions:
1. Implement the video and audio feature model exactly as specified.
2. Implement all required assertions, especially `progression_detected`, `packet_health`, and `state_signal_consistency`.
3. Add positive and negative fixture tests for each assertion family.
4. Validate that evidence references and confidence values are structurally consistent.

Exit criteria:
- Short deterministic clips can be proven or rejected automatically.
- Adjacent-item progression can be detected without human interpretation.

### Phase 5: Artifact And Timeline Pipeline

Outcome:
- complete evidence bundle for both success and failure
- authoritative timeline
- failure bundles usable without rerunning immediately

Required actions:
1. Implement `scope_session.record_step` and timeline schema validation.
2. Implement `scope_artifact.pin_frame`, `pin_audio_excerpt`, `attach_state_ref`, `mark_failure`, and `finalize`.
3. Produce `recording.mp4` from captured C64 signal artifacts.
4. Keep the artifact contract aligned with `c64scope-spec.md`.

Exit criteria:
- A failed run can be diagnosed from artifacts alone.
- A passing run still produces the full artifact set.

### Phase 6: Bootstrap And Discovery Hardening

Outcome:
- strong prompts and case metadata
- clear bootstrap path for Copilot, OpenCode, and future MCP-capable agents

Required actions:
1. Keep the repo bootstrap files aligned with the final `c64scope` surface.
2. Make required reading, app-first behavior, and `scope_catalog.get_case` mandatory in the prompt text.
3. Ensure the LLM is told exactly when to start capture, when to start C64 streaming, and when to record steps.
4. Ensure the prompt forbids bypassing the app except for the allowed `c64bridge` gaps.

Exit criteria:
- A fresh agent session can discover the intended workflow without human restatement.

### Phase 7: Mixed-Format Corpus And Case Manifest

Outcome:
- deterministic short corpus across `prg`, `crt`, `mod`, `sid`, `d64`, `d71`, and `d81`
- exact expected A/V signatures
- case manifest consumable by `scope_catalog.get_case`

Required actions:
1. Read [c64u-openapi.yaml](../../c64/c64u-openapi.yaml) and [c64u-ftp.md](../../c64/c64u-ftp.md) before finalizing staging and launch assumptions.
2. Select or create short fixtures with distinct signatures.
3. Define per-item staging, trigger method, expected A/V signatures, dwell, and progression timeout.
4. Ensure every item is reachable through C64 Commander.
5. Include at least one direct-calibration fixture for infrastructure debugging.

Exit criteria:
- Every queue item is deterministic, distinct, and app-reachable.
- The manifest is complete enough for the LLM to execute without guessing.

### Phase 8: Real-Hardware Autonomous Proof

Outcome:
- one passing end-to-end autonomous run
- one intentionally failing run with precise evidence

Required actions:
1. Read [physical-device-matrix.md](../physical-device-matrix.md) before claiming completion.
2. Run the mixed-format case using only `c64bridge`, `droidmind`, and `c64scope`.
3. Prove media start, A/V correctness, dwell, and automatic progression per item.
4. Prove the app path was used for normal control and media start/stop.
5. Repeat once with a deliberately wrong expectation to prove failure-bundle quality.

Exit criteria:
- The queue completes without manual intervention.
- The evidence bundle is complete for both the passing and failing run.

### Phase 9: Hardening And Closeout

Outcome:
- repeatable regression entrypoint
- stable thresholds
- cleanup and retry rules
- fully synchronized docs and bootstrap artifacts

Required actions:
1. Define retry policy for infrastructure failures versus product failures.
2. Define packet-loss and degradation thresholds for `fail` versus `inconclusive`.
3. Document cleanup, artifact retention, and rerun behavior.
4. Sync the implementation back to the spec, plan, and bootstrap prompt set.

Exit criteria:
- Repeated runs are stable enough to be used as a regression tool.
- No document or bootstrap file contradicts the implemented behavior.

## Validation Discipline

At minimum:

1. Run targeted tests after each implementation phase.
2. Run repository validation before declaring completion.
3. Run `npm run test:coverage` before completion and keep global branch coverage at or above 90%.
4. Run the relevant build path described in [developer.md](../../developer.md) before closing the work.

## Completion Checklist

Before declaring the delivery complete:

- [ ] `c64scope` exists as a standalone MCP server in `c64scope/`.
- [ ] The final implementation matches [c64scope-spec.md](./c64scope-spec.md).
- [ ] The three-server ownership model from [agentic-test-architecture.md](./agentic-test-architecture.md) is preserved.
- [ ] The implementation satisfies the definition of done in [agentic-test-implementation-plan.md](./agentic-test-implementation-plan.md).
- [ ] The stream implementation matches [c64u-stream-spec.md](../../c64/c64u-stream-spec.md).
- [ ] The LLM can discover the case through `scope_catalog.get_case`.
- [ ] The LLM uses C64 Commander as the normal control path under test.
- [ ] The mixed-format queue passes autonomously on real hardware.
- [ ] A deliberately broken run produces a precise failure bundle.
- [ ] Coverage and build validation both pass.
