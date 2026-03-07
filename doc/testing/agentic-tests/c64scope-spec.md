# C64 Scope Specification

## Purpose

`c64scope` is a standalone MCP server, implemented in its own repository folder, that gives an LLM the missing capabilities needed for autonomous physical testing of C64 Commander against real hardware:

- UDP video/audio capture from the C64 Ultimate
- signal feature extraction
- signal-aware assertions
- physical-test session state and artifacts
- failure classification and evidence packaging

`c64scope` does not control the C64 Ultimate and does not control Android devices.

## Non-Goals

`c64scope` must not:

- extend `c64bridge`
- extend `droidmind`
- proxy, wrap, or rename `c64bridge` tools
- proxy, wrap, or rename `droidmind` tools
- become a general Android UI automation server
- become a general C64 control server
- require Maestro, shell scripts, or human intervention for normal test execution

The LLM uses three peer MCP servers directly:

1. `droidmind` to drive C64 Commander on Android
2. `c64bridge` only for narrow direct-C64 gap-filling
3. `c64scope` for capture, assertions, and artifacts

## Repository Placement

Implementation lives in a dedicated top-level folder:

```text
c64scope/
```

Suggested internal layout:

```text
c64scope/
  README.md
  package.json
  src/
    server.ts
    config/
    lab/
    capture/
    analysis/
    assertions/
    artifacts/
    resources/
    prompts/
  test/
```

`c64scope` is repository-owned and repository-specific, but remains cleanly isolated from the main app and from the other MCP servers.

## App-First Control Policy

Physical tests exist to validate C64 Commander itself.

Therefore, the default rule is:

- if C64 Commander can perform the C64 action, the LLM must drive C64 Commander to perform it
- if C64 Commander cannot perform the action efficiently enough for the physical-test loop, the LLM may use `c64bridge`

For product-validation runs, C64 Commander is the primary C64 control plane under test.

Allowed `c64bridge` gap-fill usage:

- fast RAM assertions
- fast video/audio stream start
- fast video/audio stream stop
- emergency recovery such as reset or reboot when the app path is no longer viable
- infrastructure-only calibration runs that intentionally bypass the app

Disallowed `c64bridge` usage for normal product-validation runs:

- starting media playback when C64 Commander can do it
- stopping media playback when C64 Commander can do it
- normal C64 control flows already implemented in C64 Commander
- queue construction or queue progression logic that the app itself is supposed to own

## External MCP Dependencies

### `c64bridge`

`c64bridge` remains the only direct-C64 MCP server, but it is not the primary control path for product-validation runs.

Use it for:

- `c64_stream.*`
- `c64_memory.*`
- `c64_system.*`
- any direct-C64 operation needed only for calibration or recovery

Primary physical-test uses of `c64bridge`:

- `c64_stream.start`
- `c64_stream.stop`
- `c64_memory.read`
- `c64_memory.read_screen`
- `c64_system.reset`

`c64bridge` direct media start tools such as `c64_program.run_prg`, `c64_program.run_crt`, `c64_sound.play_mod_file`, `c64_sound.play_sid_file`, and `c64_disk.mount` are reserved for infrastructure calibration and gap investigation, not for the primary app-validation path.

### `droidmind`

`droidmind` remains the only owner of Android-device control.

Use it for:

- `android-device`
- `android-app`
- `android-ui`
- `android-log`
- `android-screenshot`
- `android-file`
- `android-shell`
- `android-diag`

Primary physical-test uses of `droidmind`:

- `android-device` with `action: list_devices`
- `android-app` with `action: start_app`
- `android-app` with `action: stop_app`
- `android-app` with `action: clear_app_data`
- `android-file` with `action: push_file`
- `android-ui` with `action: tap`
- `android-ui` with `action: swipe`
- `android-log` with `action: get_app_logs`
- `android-screenshot`

In practice, `droidmind` drives C64 Commander to perform:

- media start and stop
- queue construction
- most C64 control exercised by the app
- playback progression behavior under test

## Runtime Boundary

`c64scope` talks directly to:

- local UDP sockets for C64U video/audio streams
- local filesystem for artifacts
- local `ffmpeg` for final MP4 muxing

`c64scope` does not call the other two MCP servers internally.

Reason: the LLM is the orchestrator. The MCP client already exposes all three servers. `c64scope` provides physical-test semantics only.

## MCP Identity And Contracts

- Server name: `c64scope`
- Transport: MCP over `stdio`
- Role: physical-test capture, assertions, and artifact management
- Non-role: C64 control and Android control

Operating rules:

1. `c64scope` never controls the C64 Ultimate directly.
2. `c64scope` never controls the Android device directly.
3. `c64scope` assumes product-validation runs are app-first.
4. `c64scope` expects the LLM to record meaningful `droidmind` and `c64bridge` actions through `scope_session.record_step`.
5. `c64scope` is authoritative only for capture, assertion, timeline, and artifact semantics.

All successful tool responses must include this common envelope:

```json
{
  "ok": true,
  "runId": "pt-20260307-101530Z",
  "timestamp": "2026-03-07T10:15:30.000Z"
}
```

Additional fields vary by operation.

For operations that do not yet belong to a session, `runId` may be omitted.

All failed tool responses must include this common error envelope:

```json
{
  "ok": false,
  "runId": "pt-20260307-101530Z",
  "timestamp": "2026-03-07T10:15:30.000Z",
  "error": {
    "code": "capture_unavailable",
    "message": "Video receiver is not running",
    "details": {}
  }
}
```

Valid high-level `error.code` values:

- `invalid_input`
- `session_not_found`
- `session_already_closed`
- `capture_unavailable`
- `capture_degraded`
- `artifact_error`
- `assertion_error`
- `environment_error`
- `internal_error`

## Core Design Rules

1. One responsibility per server.
2. No duplicated tool semantics.
3. No hidden orchestration across servers.
4. Product-validation runs are app-first: use C64 Commander wherever it already has the capability.
5. Every physical run is evidence-first.
6. Every assertion is traceable to explicit artifacts.
7. Every important peer-server action must be recorded by the LLM into the `c64scope` session timeline.

Rule 7 is required because `c64scope` cannot see calls made to `c64bridge` or `droidmind` unless the LLM records them.

## Core Concepts

### Session

A physical-test run with:

- run ID
- artifact directory
- reserved capture endpoints
- calibration state
- timeline of externally executed actions
- assertion results

### Capture Endpoint

A host UDP target reserved by `c64scope` for `c64bridge` streaming.

Example:

```json
{
  "video": "192.168.1.10:21000",
  "audio": "192.168.1.10:21001"
}
```

### Observation Window

A bounded span of captured frames and/or audio windows used for analysis.

### Feature Stream

Continuous JSONL output derived from captured packets.

- `video_features.jsonl`
- `audio_features.jsonl`
- `state_refs.jsonl`
- `timeline.jsonl`

### Assertion

A signal-aware pass/fail evaluation with:

- exact expectation
- tolerance
- observed values
- evidence references
- confidence

### Progression Event

A detected transition between expected playback items in a queue or playlist.

Examples:

- new frame signature appears
- audio frequency family changes
- combined A/V marker changes
- silence gap closes and next media item begins

## MCP Surface

`c64scope` exposes six tool groups.

### `scope_session`

Owns run lifecycle and action timeline.

#### `start`

Creates a run directory, reserves capture ports, initializes metadata, and returns the targets that `c64bridge` must stream to.

Input:

```json
{
  "goal": "mixed-format playback regression",
  "artifactRoot": "/optional/path",
  "tags": ["physical", "playback-smoke"]
}
```

Output:

```json
{
  "runId": "pt-20260307-101530Z",
  "artifactDir": "/.../artifacts/pt-20260307-101530Z",
  "captureTargets": {
    "video": "host-or-ip:21000",
    "audio": "host-or-ip:21001"
  },
  "timelineRef": "c64scope://runs/pt-20260307-101530Z/timeline"
}
```

#### `record_step`

Appends a semantic step to the session timeline. This is how the LLM records meaningful actions performed via C64 Commander through `droidmind`, or narrow gap-fill actions performed via `c64bridge`.

Input:

```json
{
  "runId": "pt-...",
  "server": "c64bridge | droidmind | c64scope",
  "tool": "android-ui.tap",
  "summary": "Tapped Play on queue item 1/7 in C64 Commander",
  "expectedOutcome": "blue border and 440 Hz tone within 2 seconds",
  "references": ["playlist-row-1", "c64commander-play-page"]
}
```

#### `status`

Returns current session state.

Output includes:

- run ID
- active capture state
- packet-loss counters
- latest assertion outcomes
- artifact sizes
- elapsed time

#### `stop`

Closes the run, writes the manifest, optionally muxes MP4 if not already finalized, and returns the final verdict.

Output:

```json
{
  "runId": "pt-...",
  "artifactDir": "/...",
  "verdict": "pass | fail | inconclusive"
}
```

### `scope_lab`

Owns local lab self-knowledge only.

#### `inspect`

Reports host-local capabilities needed by `c64scope`.

Checks:

- artifact root writable
- UDP bind possible
- `ffmpeg` availability
- configured host/IP used for capture targets

#### `calibrate`

Captures a short baseline before strict assertions.

Outputs:

- detected video standard if inferable from frame cadence
- baseline audio noise floor
- recommended warm-up interval
- initial packet-loss rate

`scope_lab` does not check Android reachability or C64 REST reachability; those are owned by `droidmind` and `c64bridge` respectively.

### `scope_capture`

Owns receiver lifecycle and raw observation access.

#### `start`

Starts local video/audio receivers on the reserved ports.

Input:

```json
{
  "runId": "pt-...",
  "streams": ["video", "audio"],
  "warmupMs": 1500,
  "bufferDelayMs": 50
}
```

#### `status`

Returns per-stream capture state:

- packets received
- packets dropped
- stale-frame count
- last frame number
- last audio timestamp
- capture start time

#### `snapshot`

Returns an immediate inspection sample.

Input:

```json
{
  "runId": "pt-...",
  "includeFramePng": true,
  "audioWindowMs": 500
}
```

Output may include:

- current frame metadata
- current frame PNG path
- recent dominant colours
- recent dominant frequency
- RMS

#### `recent_video`

Returns recent per-frame features for a bounded window.

#### `recent_audio`

Returns recent per-window audio features for a bounded window.

#### `stop`

Stops receivers and flushes feature streams.

### `scope_assert`

Owns all physical assertions.

Each assertion returns:

```json
{
  "ok": true,
  "runId": "pt-20260307-101530Z",
  "timestamp": "2026-03-07T10:16:10.000Z",
  "passed": true,
  "confidence": 0.97,
  "observed": {},
  "expected": {},
  "evidenceRefs": [],
  "failureClass": null
}
```

Supported operations:

#### `frame_change_within`

Passes when the frame-diff threshold is crossed within `N` frames of a recorded step.

#### `colour_signature`

Checks border/background/dominant colours or a histogram signature.

#### `text_signature`

Checks a text hash or exact substring against video-derived or `c64bridge`-supplied screen evidence.

#### `tone_present`

Checks that a dominant frequency appears within tolerance for at least the required duration.

#### `silence_window`

Checks continuous silence below the calibrated threshold.

#### `envelope_pattern`

Checks a sequence of on/off audio durations.

#### `av_alignment`

Checks temporal alignment between a video event and an audio event.

#### `progression_detected`

Checks that playback advanced from one expected media signature to the next within a bounded interval.

This is mandatory for the first mixed-format autonomous regression.

#### `packet_health`

Fails when packet loss, stale frames, or capture corruption exceed a configured threshold.

#### `state_signal_consistency`

Checks that signal evidence matches a state sample collected separately through `c64bridge` and recorded into the timeline or state reference stream.

This never reads C64 state directly; it evaluates supplied state evidence.

### `scope_artifact`

Owns evidence materialization and packaging.

#### `pin_frame`

Writes a selected frame as PNG and returns the artifact path.

#### `pin_audio_excerpt`

Writes a selected audio excerpt and returns the artifact path.

#### `attach_state_ref`

Stores C64 state evidence supplied by the LLM after a `c64bridge` read.

Input:

```json
{
  "runId": "pt-...",
  "sourceTool": "c64_memory.read",
  "summary": "Read $0400-$07E7 after clip 3 start",
  "payload": {
    "address": "$0400",
    "bytes": "..."
  }
}
```

#### `mark_failure`

Creates a structured failure bundle with:

- recent timeline steps
- local feature excerpts
- pinned frame/audio artifacts
- optional references to Android screenshots or logs gathered via `droidmind`

#### `finalize`

Writes manifest files and muxes `recording.mp4` from C64 video/audio artifacts.

### `scope_catalog`

Owns repository-specific test knowledge that helps the LLM discover what to do without hard-coded prompt knowledge.

#### `list_cases`

Returns the named physical-test cases known to the repository.

#### `get_case`

Returns one test-case specification, including:

- purpose
- required peer-server tools
- media manifest path
- staging method per item
- expected signatures
- progression rules
- required assertions
- teardown rules
- explicit app-first control policy

This is the primary discovery bridge for autonomous runs.

## Resource Surface

`c64scope` should expose at least these MCP resources:

- `c64scope://playbooks/agentic-testing`
- `c64scope://playbooks/mixed-format-playback`
- `c64scope://catalog/assertions`
- `c64scope://catalog/test-cases`
- `c64scope://lab/profile`
- `c64scope://artifacts/schema`

## Prompt Surface

`c64scope` should expose prompts that help MCP-capable IDEs bootstrap correct behavior.

Required prompts:

- `mixed-format-playback-regression`
- `physical-failure-triage`

The prompt content must reinforce server boundaries and the app-first control policy.

## Feature Model

### Video Features

Per-frame features:

- `frameNumber`
- `timestampNs`
- `colourHistogram[16]`
- `borderColour`
- `backgroundColour`
- `dominantColour`
- `textHash`
- `frameDiffScore`
- `isAllWhite`
- `isAllBlack`

Derived features:

- `transitionFrame`
- `stabilityCount`
- `cadencePeriod`

### Audio Features

Per-window features:

- `timestampNs`
- `rms`
- `peakAmplitude`
- `dominantFrequency`
- `spectralCentroid`
- `isSilent`

Derived features:

- `toneOnsetNs`
- `toneOffsetNs`
- `envelopePattern`
- `frequencyStability`

## Artifact Contract

Each run writes:

```text
<run-id>/
  README.md
  session.json
  timeline.jsonl
  video_features.jsonl
  audio_features.jsonl
  state_refs.jsonl
  assertions.json
  recording.mp4
  frames/
  audio/
  failures/
```

Rules:

- `timeline.jsonl` is the authoritative cross-server action log.
- `recording.mp4` contains C64 signal output only, not Android screen recording.
- Android screenshots/logs remain external artifacts gathered through `droidmind` and referenced from the timeline or failure bundle.

## Timeline Contract

Each `timeline.jsonl` event must contain:

```json
{
  "stepId": "step-0007",
  "timestamp": "2026-03-07T10:15:35.000Z",
  "server": "droidmind",
  "tool": "android-ui.tap",
  "summary": "Tapped Play on queue item 1/7 in C64 Commander",
  "expectedOutcome": "blue border and 440 Hz tone within 2 seconds",
  "references": ["playlist-row-1", "c64commander-play-page"]
}
```

## Assertion Failure Classes

Every failed assertion should classify into one of these buckets:

- `capture_unavailable`
- `capture_degraded`
- `no_transition`
- `wrong_video_signature`
- `wrong_audio_signature`
- `progression_timeout`
- `state_signal_mismatch`
- `environment_error`

## Canonical Autonomous Flow

1. LLM asks `scope_catalog.get_case` for the target case.
2. LLM starts `scope_session` and records the test goal.
3. LLM uses `scope_lab.inspect` and `scope_lab.calibrate`.
4. LLM starts `scope_capture`.
5. LLM uses `c64bridge` only to start C64 video/audio streaming to the reserved targets.
6. LLM ensures media is available either on prepositioned C64U storage or in app-visible Android storage populated via `droidmind`.
7. LLM uses `droidmind` to drive C64 Commander for queue construction, media start, media stop, and normal C64 control.
8. After every meaningful peer-server action, the LLM calls `scope_session.record_step`.
9. LLM uses `scope_capture` and `scope_assert` to verify start, progression, and completion.
10. On anomalies, the LLM gathers Android evidence through `droidmind` and fast RAM evidence through `c64bridge`, then records references into `c64scope` artifacts.
11. LLM stops C64 streaming through `c64bridge`, stops capture through `c64scope`, finalizes artifacts, and stops the session.

## First Required Test Case

The first end-to-end case must validate autonomous progression across a short mixed playlist containing:

- `prg`
- `crt`
- `mod`
- `sid`
- `d64`
- `d71`
- `d81`

For each item the LLM must be able to prove:

- playback started
- expected video signature appeared
- expected audio signature appeared, when applicable
- progression to the next item happened automatically
- the final run order matched the case manifest

For this case, media start and stop must be performed through C64 Commander, not through direct `c64bridge` media-run tools.

## Acceptance Criteria For `c64scope`

`c64scope` is specification-complete only when:

1. every tool group has a single non-duplicated responsibility
2. the LLM can run a session without any hidden server-to-server integration
3. the mixed-format playback case is expressible using only `c64bridge`, `droidmind`, and `c64scope`
4. the session artifact set is sufficient to debug failures without rerunning immediately
5. the docs make it explicit that product-validation runs are app-first and that `c64bridge` is a narrow gap filler only
