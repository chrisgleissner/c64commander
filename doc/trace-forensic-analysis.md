# C64 Ultimate REST/FTP Trace Forensic Analysis

## Executive Summary

- Corpus analyzed: 294 golden trace files in playwright/fixtures/traces/golden, totaling 6,083 REST requests.
- Traffic is dominated by /v1/info (3,290 requests, ~54% of all requests), followed by /v1/drives (572) and /v1/configs (195).
- Systemic patterns observed across most traces:
  - Dense /v1/info polling bursts and redundant retries.
  - Requests initiated during UNKNOWN/DISCOVERING device states.
  - Post-error immediate retries without backoff or state reassessment.
- Overall risk assessment: unsafe. The current interaction model exhibits overlapping and redundant traffic that can overwhelm a fragile device, especially when it is unresponsive or transitioning states.

## Detailed Findings

### 1) Info Endpoint Storm and Redundant Polling

**Description**: /v1/info is requested in rapid bursts, often multiple times within the same 200–500 ms window, even after failures. This is a high-risk pattern for a fragile device and a primary source of unnecessary traffic.

**Evidence**:
- Trace: audiomixer--audiomixerspects--audio-mixer-volumes--editing-while-solo-active-restores-other-volumes/android-phone/trace.json
  - EVT-0007 /v1/info at 2026-01-31T14:49:20.524Z (relativeMs 118)
  - EVT-0017 /v1/info at 2026-01-31T14:49:20.580Z (relativeMs 174)
  - EVT-0029 /v1/info at 2026-01-31T14:49:20.633Z (relativeMs 227)
  - EVT-0041 /v1/info at 2026-01-31T14:49:20.662Z (relativeMs 256)
  - EVT-0060 /v1/info at 2026-01-31T14:49:20.699Z (relativeMs 293)
- Trace: demomode--demomodespects--automatic-demo-mode--demo-mode-does-not-overwrite-stored-base-url/android-phone/trace.json
  - EVT-0009 /v1/info at 2026-01-31T14:49:49.085Z (relativeMs 663)
  - EVT-0016 /v1/info at 2026-01-31T14:49:49.085Z (relativeMs 663)

**Severity**: High

**Why this is dangerous**: /v1/info is a common gating endpoint; repeated polling during unstable states can amplify latency, increase error rates, and starve more critical calls.

---

### 2) Config Read Amplification with Full /v1/configs Fetches

**Description**: /v1/configs (full configuration tree) is fetched repeatedly within sub-second windows. This is a heavy endpoint and its amplification is disproportionate to the user intent.

**Evidence**:
- Trace: audiomixer--audiomixerspects--audio-mixer-volumes--editing-while-solo-active-restores-other-volumes/android-phone/trace.json
  - EVT-0002 /v1/configs at 2026-01-31T14:49:20.500Z (relativeMs 94)
  - EVT-0024 /v1/configs at 2026-01-31T14:49:20.582Z (relativeMs 176)

**Severity**: High

**Why this is dangerous**: /v1/configs is explicitly heavy. Repeated full-tree fetches are likely to contend with other operations and can block or destabilize the device.

---

### 3) Overlapping REST Requests Across Correlation IDs

**Description**: Concurrent REST calls overlap in time, including configuration access and /v1/info polling. This overlap is unsafe given the device’s non-concurrent guarantees.

**Evidence**:
- Trace: demomode--demomodespects--automatic-demo-mode--demo-interstitial-appears-once-per-session-and-manual-retry-uses-discovery/android-phone/trace.json
  - EVT-0023 /v1/configs/SID Sockets Configuration/SID Socket 1 at 2026-01-31T14:49:40.273Z (relativeMs 250)
  - EVT-0026 /v1/info at 2026-01-31T14:49:40.274Z (relativeMs 251)

**Severity**: High

**Why this is dangerous**: Concurrent config and info calls can collide with device locks or internal state transitions, leading to timeouts or undefined behavior.

---

### 4) Requests Issued During UNKNOWN/DISCOVERING States

**Description**: Requests are sent while the device is in UNKNOWN or DISCOVERING state, or immediately after “Host unreachable” errors.

**Evidence**:
- Trace: audiomixer--audiomixerspects--audio-mixer-volumes--editing-while-solo-active-restores-other-volumes/android-phone/trace.json
  - Action-start shows connectionState UNKNOWN immediately before EVT-0002 /v1/configs at 2026-01-31T14:49:20.500Z (relativeMs 94)
  - Action-start shows connectionState DISCOVERING immediately before EVT-0007 /v1/info at 2026-01-31T14:49:20.524Z (relativeMs 118)
- Trace: demomode--demomodespects--automatic-demo-mode--demo-interstitial-appears-once-per-session-and-manual-retry-uses-discovery/android-phone/trace.json
  - Action-start shows connectionState DISCOVERING immediately before EVT-0023 /v1/configs/SID Socket 1 at 2026-01-31T14:49:40.273Z (relativeMs 250)

**Severity**: High

**Why this is dangerous**: Sending device-heavy calls before connectivity is established increases failures and may push the device into unstable error loops.

---

### 5) Post-Error Blind Retry Cascades

**Description**: Failures (AbortError, Host unreachable, HTTP 503) are immediately followed by more requests without backoff or state reset.

**Evidence**:
- Trace: audiomixer--audiomixerspects--audio-mixer-volumes--editing-while-solo-active-restores-other-volumes/android-phone/trace.json
  - EVT-0018 rest-response error “signal is aborted without reason” at 2026-01-31T14:49:20.582Z (relativeMs 176)
  - EVT-0020 error “Host unreachable” at 2026-01-31T14:49:20.582Z (relativeMs 176)
  - EVT-0029 /v1/info retried at 2026-01-31T14:49:20.633Z (relativeMs 227)
- Trace: connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--currently-using-indicator-updates-between-demo-and-real/android-phone/trace.json
  - EVT-0003 /v1/info returns HTTP 503 at 2026-01-31T14:50:01.408Z (relativeMs 193)
  - EVT-0008 /v1/info retried at 2026-01-31T14:50:01.409Z (relativeMs 194)

**Severity**: High

**Why this is dangerous**: Immediate retries amplify load exactly when the device is failing, increasing the chance of hangs or crashes.

---

### 6) Drive Status Polling Bursts

**Description**: /v1/drives is polled repeatedly within tens of milliseconds, even in demo or transitional contexts.

**Evidence**:
- Trace: connectionsimulation--connectionsimulationspects--deterministic-connectivity-simulation--demo-enabled-real-device-reachable-informational-only/android-phone/trace.json
  - EVT-0237 /v1/drives at 2026-01-31T15:19:05.321Z (relativeMs 2151)
  - EVT-0267 /v1/drives at 2026-01-31T15:19:05.343Z (relativeMs 2173)

**Severity**: Medium

**Why this is dangerous**: Drive polling can be expensive, and repeated polling can collide with mount or drive operations.

---

### 7) FTP Listing Fan-Out

**Description**: Multiple /v1/ftp/list calls are issued nearly simultaneously, indicating fan-out without serialization.

**Evidence**:
- Trace: itemselection--itemselectionspects--item-selection-dialog-ux--disks-page-c64-ultimate-full-flow-adds-disks/android-phone/trace.json
  - EVT-0132 /v1/ftp/list at 2026-01-31T14:50:33.414Z (relativeMs 2302)
  - EVT-0135 /v1/ftp/list at 2026-01-31T14:50:33.415Z (relativeMs 2303)

**Severity**: Medium

**Why this is dangerous**: FTP operations can be slow and blocking; concurrent listings can overwhelm the device’s FTP handler.

---

### 8) Read-After-Write Refresh on Heavy Config Operations

**Description**: Full configuration reset is followed quickly by /v1/info polling without a stabilization window.

**Evidence**:
- Trace: coverageprobes--coverageprobesspects--coverage-probes--exercises-internal-helpers-for-coverage/android-phone/trace.json
  - EVT-0333 PUT /v1/configs:reset_to_default at 2026-01-31T14:49:24.409Z (relativeMs 7325)
  - EVT-0428 GET /v1/info at 2026-01-31T14:49:24.576Z (relativeMs 7492)

**Severity**: Medium

**Why this is dangerous**: Reset operations are heavy; immediate info polling increases contention during device reconfiguration.

## Cross-Trace Pattern Catalog

1) Info Endpoint Storm
- Detection rule: ≥5 /v1/info requests within 500 ms.
- Frequency: 272/294 traces.
- Risk profile: High. Dominant traffic source and frequent during unstable device states.

2) Config Read Amplification
- Detection rule: ≥2 /v1/configs full-tree requests within 1,000 ms.
- Frequency: 26/294 traces.
- Risk profile: High. Heavy endpoint repeatedly used without clear need.

3) Post-Error Blind Retry
- Detection rule: A failed request (AbortError or HTTP 5xx) followed by another request within 1,000 ms.
- Frequency: 280/294 traces.
- Risk profile: High. Likely to produce cascaded failures on a fragile device.

4) Discovery-State Overlap
- Detection rule: REST request issued while connectionState is UNKNOWN or DISCOVERING.
- Frequency: 281/294 traces.
- Risk profile: High. Requests are not gated by device availability.

5) Concurrent Request Overlap
- Detection rule: A REST request starts before the prior request completes.
- Frequency: 10/294 traces.
- Risk profile: High. Concurrency violations on a device that is not concurrency-safe.

6) Drive Status Burst
- Detection rule: ≥2 /v1/drives requests within 500 ms.
- Frequency: 88/294 traces.
- Risk profile: Medium. Repeated drive polling can block other operations.

7) FTP List Fan-Out
- Detection rule: ≥2 /v1/ftp/list requests within 50 ms.
- Frequency: 2/294 traces.
- Risk profile: Medium. FTP handler overload or contention.

## Improvement Opportunities (Conceptual Only)

- Intent-based serialization of REST calls to prevent concurrent requests against critical endpoints.
- Device-busy gating based on connectionState and recent error signals before issuing heavy reads/writes.
- Redundant read suppression for /v1/info and /v1/configs, with state-aware coalescing.
- Backoff/circuit-breaker behavior after AbortError, Host unreachable, or HTTP 5xx responses.
- Heavy endpoint prioritization with cooldown windows for /v1/configs, /v1/drives, and /v1/ftp/list.

## Suggested Next Steps

1) Establish a formal device state model and ensure REST access is gated on stable states only.
2) Reduce /v1/info and /v1/drives polling rates, especially during discovery and failure windows.
3) Enforce serialization of REST calls that target configuration, drive, and FTP endpoints.
4) Introduce error-driven cooldown windows to suppress rapid retries after failures.
5) Re-run golden traces after implementing architectural throttling to validate reductions in bursts and overlaps.

## Methodology

- Parsed every trace.json in playwright/fixtures/traces/golden.
- Reconstructed timelines using relativeMs, correlated rest-request and rest-response events, and cross-checked connectionState from action-start contexts.
- Aggregated request frequencies and identified burst, overlap, and retry patterns across all traces.
