# Testing extension research (C64 Commander)

## Context and goals

- Design a concrete, non-destructive test-extension plan based on the existing testing infrastructure review.
- Keep all proposals in research phase only, with no code changes.
- Strengthen web-executable and CI-friendly tests while defining a manual-but-automated real-device research mode for Android + real C64U.

## Inputs from prior testing review

- Playwright runs a web build via Vite preview and does not exercise Capacitor WebView or Android-native networking.
- Real-device discovery logic diverges between web (fetch) and native (CapacitorHttp) paths.
- Demo-mode fallback is enabled by default and often triggered quickly in tests.
- CI runs Playwright in web mode only; Android CI runs JVM unit tests with no emulator or instrumentation.

## Gaps that must be closed

- Explicit verification of “real device vs demo fallback” decisions in automated tests.
- Coverage of playback flows that assert correct API routing (logic-level, no audio output).
- Deterministic validation of discovery timing and slow-response boundaries.
- Observability for discovery-related failures in web E2E (without native logcat).
- A real-device research mode to validate Android-native discovery and hostname resolution for C64U.

## Extensions to existing automated tests

The following test extensions are **web-executable, deterministic, and CI-friendly**, and do not require platform-specific permissions or destructive actions.

1. **Startup discovery selection (real vs demo)**
   - Path: App load → discovery → connectivity indicator.
   - Assertions:
     - When a reachable mock is configured as “real device,” demo mode must not activate.
     - When discovery times out, demo mode activates exactly once per session.
   - Layers: UI (connectivity indicator), connection manager decision logic, API abstraction.
   - Explicit selection: Test must assert the final connection state rather than assume it.

2. **Manual rediscovery from settings**
   - Path: Settings → Save & Connect → connectivity indicator.
   - Assertions:
     - Changed credentials are used for the probe.
     - State transitions follow expected sequence: DISCOVERING → REAL_CONNECTED or DEMO_ACTIVE.
   - Layers: UI form, connection manager, request headers in API layer.

3. **Playback initiation routing (logic-level)**
   - Path: Play page → select track → play.
   - Assertions:
     - Playback request goes to the real-device base URL when in REAL_CONNECTED.
     - Playback request goes to mock/demo base URL when in DEMO_ACTIVE.
   - Layers: UI playlist controls, API abstraction, request routing summary.
   - Note: No audio output or file writes required.

4. **Local file selection (conceptual on web)**
   - Path: Play page → local file source → select file → play.
   - Assertions:
     - Selected file metadata is reflected in UI playlist state.
     - Playback request is issued with the expected metadata and source type.
   - Layers: UI, playlist state handling, API abstraction.

5. **Discovery timing boundaries**
   - Path: App load → discovery loop → timeout.
   - Assertions:
     - Demo fallback triggers only after configured window elapses.
     - A probe success before deadline prevents demo fallback.
   - Layers: connection manager state machine and timing.

6. **Slow-response probe handling**
   - Path: App load → probe responds slowly.
   - Assertions:
     - Timeouts are handled without breaking UI state.
     - Demo fallback behavior matches timing configuration.
   - Layers: connection manager, API client timeouts.

7. **Background rediscovery (web simulation)**
   - Path: Demo mode active → background rediscovery tick → probe success/failure.
   - Assertions:
     - Rediscovery does not erroneously switch to REAL_CONNECTED when in demo mode.
     - Probe failures do not mutate stored base URL/device host.
   - Layers: connection controller timers, connection manager.

## Proposed real-device research test mode

A **manual-but-automated** test mode designed for local execution only. It validates Android-native discovery behavior and real C64U reachability without modifying state.

- **Invocation concept**: a new build flag (research-only; not implemented here).
- **Runtime target**: real Android device via USB and a real C64U reachable on LAN at hostname C64U.
- **High-level flow**:
  1. Ensure the app is built and installed on the device.
  2. Launch the app and wait for startup discovery.
  3. Observe connectivity state and capture read-only API checks.
  4. Verify that demo mode does not activate if C64U is reachable.
  5. Confirm that no persistent settings or device configurations are altered.
- **Observation strategy**:
  - Screen-state inspection (UI connectivity indicator).
  - Read-only API reachability checks (e.g., /v1/info).
  - Network reachability validation via non-mutating requests.
- **Success criteria**:
  - Connectivity indicator shows REAL_CONNECTED when C64U is reachable.
  - No demo interstitial appears under normal conditions.
  - No writes or config changes are performed.
- **Failure criteria**:
  - Demo mode activates despite reachable C64U.
  - Discovery fails due to DNS/hostname resolution of C64U on Android.
  - Any evidence of settings or state mutation is detected.

## Safety and non-destructiveness guarantees

The real-device research mode must enforce strict read-only behavior.

**Forbidden operations**

- No configuration writes to C64U.
- No disk mounts/unmounts.
- No reset, power, pause, or reboot commands.
- No playlist writes or updates.
- No filesystem writes on Android or C64U.

**Guardrails**

- Only allow read-only endpoints (e.g., /v1/info, /v1/version, /v1/drives if read-only).
- Block or fail any request that matches known mutating endpoints.
- Require explicit confirmation that no permission prompts or filesystem access is needed.
- Validate that stored app settings remain unchanged before and after the session.

**Mutation detection**

- Capture pre/post snapshots of local app settings (read-only comparison).
- Track and reject any outgoing requests to write endpoints.
- Report any unexpected UI flows that imply persistence (e.g., “Saved” confirmations).

## Emulator versus real device analysis

- **What cannot be reliably validated without a real Android device**
  - Hostname resolution for C64U on actual device network.
  - Real Wi-Fi and LAN routing constraints.
  - OEM-specific network policies and background execution behavior.

- **What can be validated with an emulator**
  - Basic WebView runtime behavior.
  - CapacitorHttp request flow to a reachable endpoint on a mapped host.
  - Some lifecycle transitions (background/foreground) in a controlled setting.

- **Why emulator success does not imply real-device success**
  - Emulator networking is often NAT’d and may bypass DNS or mDNS constraints.
  - Real devices can apply DNS search domains or captive portal behaviors that emulators do not replicate.

- **When emulator tests are still valuable**
  - For regression coverage of native WebView integration.
  - For verifying that the native networking stack integrates correctly with the app’s discovery logic.

## Candidate test scenarios

1. **Real C64U present at startup, demo mode must not activate**
   - Platform relevance: Android real device, web simulation.
   - Automation feasibility: Web E2E + manual real-device mode.
   - Value: Directly addresses missed bug class.

2. **Discovery timeout reached, demo mode activates**
   - Platform relevance: Web E2E, emulator optional.
   - Automation feasibility: High (web).
   - Value: Confirms fallback behavior is deterministic.

3. **C64U reachable but slow response**
   - Platform relevance: Web + emulator; real-device for confidence.
   - Automation feasibility: High (web), moderate (emulator).
   - Value: Validates timing thresholds and reduces false demo fallbacks.

4. **Android hostname resolution of C64U**
   - Platform relevance: Real Android device only.
   - Automation feasibility: Manual-but-automated mode.
   - Value: Confirms LAN hostname resolution is viable in production.

5. **Manual rediscovery after settings change**
   - Platform relevance: Web E2E and emulator.
   - Automation feasibility: High.
   - Value: Ensures updated credentials are used for probe.

6. **Playback routed to correct target (real vs demo)**
   - Platform relevance: Web E2E and emulator.
   - Automation feasibility: High.
   - Value: Ensures playback commands follow connection state.

7. **Background rediscovery while in demo mode**
   - Platform relevance: Web simulation + emulator; real device optional.
   - Automation feasibility: Medium.
   - Value: Validates state stability across lifecycle events.

## Execution model

- **Automated (web, CI-friendly)**
  - Playwright E2E + contract/unit tests.
  - Deterministic configuration via test harness and mock servers.
  - Evidence collection via existing Playwright artifacts.

- **Manual-but-automated (local only)**
  - New build flag (research proposal only).
  - Runs on real Android device and real C64U on LAN.
  - Read-only validation only; no permissions that require manual acceptance.
  - Output: structured report and minimal evidence (screens, logs, request list).

## Open questions and feasibility checks

- Can Android resolve hostname C64U without custom DNS or mDNS? If not, what is the minimal safe configuration to test without modifying device settings?
- Is it feasible to run UI automation on a real device without granting new permissions or manual taps?
- Which read-only endpoints can be safely exercised without risk of persistent changes?
- Is the existing logging sufficient to detect accidental writes, or is additional read-only telemetry required?

## Next-step conversion into implementation tasks

- Translate each automated test extension into a scoped test ticket with explicit assertions and expected artifacts.
- Define a minimal “real-device research mode” specification including preflight checks, read-only endpoint allowlist, and evidence capture.
- Validate feasibility of non-interactive device control and document any unavoidable manual steps as blockers.
- Establish a review checklist that confirms non-destructiveness before running real-device tests.
