# Status Surface Enhancement Spec

**Date**: 2026-03-19
**Scope**: Health Check with Config Roundtrip, Connection Management, Feature Extensions
**Classification**: `CODE_CHANGE` + `UI_CHANGE`

---

## 1. Current State

1. **Health model** (`healthModel.ts`): 5 states — Healthy, Degraded, Unhealthy, Idle, Unavailable. Derived from 3 contributors: App, REST, FTP. 5-minute sliding window over trace events.
2. **Connectivity model**: 5 states — Online, Demo, Offline, Not yet connected, Checking. Mapped from `ConnectionState` (REAL_CONNECTED, DEMO_ACTIVE, OFFLINE_NO_DEMO, DISCOVERING, UNKNOWN).
3. **Liveness check** (`c64Liveness.ts`): Reads Jiffy clock ($00A2, 3 bytes) and raster register ($D012, 1 byte). Produces `healthy | irq-stalled | wedged`. Used ad-hoc, not integrated into health badge.
4. **Badge** (`UnifiedHealthBadge.tsx`): Glyph-encoded health state + connectivity label. Tapping opens diagnostics overlay. Adapts to compact/medium/expanded display profiles.
5. **Diagnostics dialog** (`DiagnosticsDialog.tsx`): Collapsible health summary, contributor rows, problem spotlight, evidence stream (Problems/Actions/Logs/Traces), filter controls, share/clear actions.
6. **Connection management**: `connectionManager.ts` handles discovery (startup/manual/background/settings), demo mode, sticky real-device lock. `hostEdit.ts` provides `saveConfiguredHostAndRetry()`.
7. **Retry connection**: Exists in diagnostics dialog as a button when Offline/Not yet connected. Links to Settings page for host change.
8. **Config read**: `getCategory()`, `getConfigItem()`, `getConfigItems()` — all via `GET /v1/configs/{category}[/{item}]`.
9. **Config write**: `setConfigValue()` → `PUT /v1/configs/{cat}/{item}?value=V`. `updateConfigBatch()` → `POST /v1/configs`. Write throttling via `configWriteThrottle.ts`.
10. **LED Strip Settings**: Category exists. `Strip Intensity`: integer 0–31 (`min: 0, max: 31, format: "%d"`). Controls physical LED brightness.
11. **Keyboard Lighting**: Same schema. `Strip Intensity`: integer 0–31. Separate category, same item name.
12. **Audio Mixer**: `Vol UltiSid 1/2`, `Vol Socket 1/2`, etc. Option lists: OFF, -42 dB through +6 dB. Current selection via `selected` field.
13. **Interactive write hook** (`useInteractiveConfigWrite.ts`): Immediate writes, write lane coalescing, reconciliation. Used by `LightingSummaryCard.tsx` for slider-driven intensity changes.
14. **No active health check**: The app has no user-triggered deep health check. Liveness is code-available but unused in the status surface.
15. **No config roundtrip test**: No mechanism validates write-path integrity. Config mutations are trusted without verification.

---

## 2. Health Check Spec

### 2.1 Trigger

| Trigger          | Condition                                    |
|-----------------|----------------------------------------------|
| Manual          | User taps "Run Health Check" in diagnostics  |
| Auto-on-connect | After REAL_CONNECTED transition, once         |
| Periodic        | Optional: every 5 min while Online (configurable, default off) |

### 2.2 State Machine

```
IDLE → RUNNING → COMPLETE
                ↘ FAILED (timeout or unrecoverable error)
```

Substates during RUNNING: `rest` → `jiffy` → `raster` → `config-roundtrip`.
Sequential, no parallelism (each check depends on prior success context).

### 2.3 Four-Check Sequence

#### Check 1: REST
- Call `GET /v1/info` with 2s timeout.
- **PASS**: HTTP 200 + valid JSON with non-empty `product`.
- **FAIL**: Network error, timeout, non-200, or missing `product`.
- If FAIL → short-circuit. Overall = Unreachable. Skip remaining checks.

#### Check 2: JIFFY
- Read $00A2 (3 bytes) → `jiffyStart`.
- Wait 50 ms.
- Read $00A2 (3 bytes) → `jiffyEnd`.
- **PASS**: `jiffyEnd ≠ jiffyStart`.
- **FAIL**: `jiffyEnd === jiffyStart`.

#### Check 3: RASTER
- Only executed if Check 2 FAILED (Jiffy stalled).
- Read $D012 (1 byte) → `rasterStart`.
- Up to 3 attempts, 2 ms apart: read $D012.
- **CHANGED**: Any read ≠ `rasterStart` → IRQ-stalled.
- **STALLED**: All reads === `rasterStart` → Wedged.
- If Check 2 PASSED → Raster check is skipped, reported as `n/a`.

#### Check 4: CONFIG ROUNDTRIP
- Only executed if Check 1 PASSED (REST reachable).
- Selection strategy (§3). Mutation algorithm (§3.4).
- **SUCCESS**: Full cycle (write V' → verify → restore V → verify).
- **PARTIAL**: Mutation succeeded but restore verification failed.
- **FAIL**: Mutation or its verification failed.

### 2.4 Decision Logic

| REST | JIFFY | RASTER | CONFIG | Result |
|------|-------|--------|--------|--------|
| FAIL | —     | —      | —      | Unreachable |
| PASS | PASS  | n/a    | SUCCESS | Healthy |
| PASS | PASS  | n/a    | PARTIAL | Degraded (config-unstable) |
| PASS | PASS  | n/a    | FAIL   | Degraded (config-broken) |
| PASS | FAIL  | CHANGED| SUCCESS | IRQ-stalled |
| PASS | FAIL  | CHANGED| FAIL   | IRQ-stalled + Degraded |
| PASS | FAIL  | STALLED| *      | Wedged |

**Rule**: CONFIG ✗ or ! always degrades overall health. Cannot be Healthy with config issues.

### 2.5 Timing Budget

| Phase           | Max ms |
|-----------------|--------|
| REST check      | 2000   |
| Jiffy (wait)    | 50     |
| Jiffy (reads)   | 200    |
| Raster (reads)  | 100    |
| Config roundtrip| 1500   |
| **Total max**   | **≤ 2000** (sequential with early exit) |

REST timeout is hard. Jiffy + Raster overlap with config roundtrip under the 2s budget because REST early-exit recovers time. Worst case (all 4 checks run): ~1850 ms.

### 2.6 UI

#### Compact (badge-inline)
```
C64U ● ✓ 312ms
```
Glyph stays standard health indicator. Duration shown briefly after check completes.

#### Expanded (diagnostics dialog)
New section above contributor rows:

```
┌─────────────────────────────────────────────┐
│ HEALTH CHECK                     Run Check  │
│ ────────────────────────────────────────     │
│ REST   ✓  200 OK          52ms              │
│ JIFFY  ✓  advanced         78ms             │
│ RASTER n/a (jiffy ok)                       │
│ CONFIG ✓  Strip Intensity  roundtrip 180ms  │
│ ────────────────────────────────────────     │
│ Result: Healthy                    312ms     │
└─────────────────────────────────────────────┘
```

Each row: status glyph + detail + duration.
"Run Check" button triggers manual check. Disabled during RUNNING. Spinner while active.

---

## 3. Config Roundtrip Spec

### 3.1 Selection Strategy

**Priority order**:

| Priority | Category             | Item             | Type    | Range/Options |
|----------|---------------------|------------------|---------|---------------|
| 1        | LED Strip Settings  | Strip Intensity  | integer | 0–31          |
| 2        | Keyboard Lighting   | Strip Intensity  | integer | 0–31          |
| 3        | Audio Mixer         | Vol UltiSid 1    | option  | OFF…+6 dB     |
| 4        | Audio Mixer         | Vol UltiSid 2    | option  | OFF…+6 dB     |

### 3.2 Detection Logic

```
1. GET /v1/configs/LED%20Strip%20Settings/Strip%20Intensity
   → 200 + item has min/max → use Priority 1
   → fail or missing →

2. GET /v1/configs/Keyboard%20Lighting/Strip%20Intensity
   → 200 + item has min/max → use Priority 2
   → fail or missing →

3. GET /v1/configs/Audio%20Mixer/Vol%20UltiSid%201
   → 200 + item has options array → use Priority 3
   → fail or missing →

4. GET /v1/configs/Audio%20Mixer/Vol%20UltiSid%202
   → 200 + item has options array → use Priority 4
   → fail → CONFIG = FAIL (no suitable target found)
```

Each detection step: single REST call, reuse existing `getConfigItem()`. Bail on first success.

### 3.3 Detection Caching

Cache the selected target for the session (category + item). Re-detect only on:
- Connection change (new host)
- Manual re-run after failure

### 3.4 Mutation Algorithm

#### For Strip Intensity (integer range)

```typescript
async function roundtripStripIntensity(api, category, item): ConfigRoundtripResult {
  const current = await readConfigValue(api, category, item);  // V
  const V = parseIntStrict(current);
  const V_prime = V < 31 ? V + 1 : V - 1;                    // V'

  await writeConfigValue(api, category, item, V_prime);        // Write V'
  const readback1 = await readConfigValue(api, category, item);// Verify
  if (parseIntStrict(readback1) !== V_prime) return FAIL;

  await writeConfigValue(api, category, item, V);              // Restore V
  const readback2 = await readConfigValue(api, category, item);// Verify restore
  if (parseIntStrict(readback2) !== V) return PARTIAL;         // Restore failed

  return SUCCESS;
}
```

#### For SID Volume (option list)

```typescript
async function roundtripSidVolume(api, category, item): ConfigRoundtripResult {
  const response = await api.getConfigItem(category, item);
  const { value: V, options } = normalizeConfigItem(response[category]?.items?.[item]);
  const steps = buildSidVolumeSteps(options);

  // Find current index
  const currentIdx = steps.findIndex(s => s.option.trim() === String(V).trim());
  if (currentIdx < 0) return FAIL;

  // Select V': move ±1 step, never to OFF from audible
  let targetIdx;
  if (currentIdx < steps.length - 1 && !steps[currentIdx + 1].isOff) {
    targetIdx = currentIdx + 1;  // +1 dB
  } else if (currentIdx > 0 && !steps[currentIdx - 1].isOff) {
    targetIdx = currentIdx - 1;  // -1 dB
  } else {
    return FAIL;  // No safe adjacent step
  }
  const V_prime = steps[targetIdx].option;

  await writeConfigValue(api, category, item, V_prime);
  const readback1 = await readConfigValue(api, category, item);
  if (normalize(readback1) !== normalize(V_prime)) return FAIL;

  await writeConfigValue(api, category, item, V);              // Restore
  const readback2 = await readConfigValue(api, category, item);
  if (normalize(readback2) !== normalize(V)) return PARTIAL;

  return SUCCESS;
}
```

### 3.5 Safety Guarantees

| Guarantee | Implementation |
|-----------|---------------|
| Restore attempt always runs | `try/finally` around mutation; restore in `finally` block |
| Restore failure reported | PARTIAL result; surfaced in UI as `!` with explanation |
| No destructive states | Strip Intensity: ±1 step (imperceptible); SID Volume: never selects OFF from audible state |
| Bounded time | AbortController with 1500 ms timeout wraps entire roundtrip |
| Retry-safe | Idempotent: read-current → mutate → restore. No accumulated drift. |
| No flash persistence | Config roundtrip operates on runtime config only; does not call `save_to_flash` |

### 3.6 Rollback Guarantee

```
try {
  V = read()
  write(V')
  verify(V')
} finally {
  write(V)       // always attempted
  verifyRestore = read()
  if (verifyRestore !== V) → emit PARTIAL warning
}
```

If the initial write fails, `V` is never changed, so restore is a no-op (safe).
If restore write fails (network error mid-roundtrip), the device retains V' until next user interaction or reboot. This is logged and surfaced.

### 3.7 UX Visibility

#### Strip Intensity (primary)

- Before check: optional inline hint — *"LED brightness will briefly change"*
- During check: physical LED strip flickers ±1 brightness step (~100–200 ms visible)
- After check: restored to original. User sees brief visual confirmation that the device responded.

#### SID Volume (fallback)

- Before check: no user hint (change is inaudible at ±1 dB)
- During check: volume moves 1 dB for ~100 ms. Imperceptible.
- After check: restored. No audible artifact.

---

## 4. Connection Management Spec

### 4.1 Reconnect

**Location**: Diagnostics dialog health summary section (already has "Retry connection" button).

**Enhanced flow**:
1. User taps "Retry connection".
2. Button shows spinner + "Connecting…"
3. Calls `discoverConnection("manual")`.
4. On REAL_CONNECTED → show inline success "Connected to [device label]" for 3s.
5. On failure → show inline "Connection failed" + current host.
6. Health check auto-triggers on successful reconnect (§2.1 auto-on-connect).

**Already exists**: Button and basic flow in `DiagnosticsDialog.tsx` line 396–408. Enhancement: inline result feedback + auto health check.

### 4.2 Change Device

**Location**: New inline section in diagnostics dialog, below reconnect button. Replaces current "Change host in Settings" link.

**Flow**:
1. User taps "Change device" (collapsed by default).
2. Expands to show: text input (host), text input (port, optional, default 80).
3. Pre-populated with current host/port from `getConfiguredHost()`.
4. User edits and taps "Connect".
5. Pre-validation: `probeOnce()` against new host.
6. On success → `saveConfiguredHostAndRetry()` → commit. Show "Switched to [new host]".
7. On failure → show error inline. Do not commit. Original connection unchanged.
8. "Cancel" collapses the section.

**API surface used**: `probeOnce()`, `saveConfiguredHostAndRetry()`, `normalizeDeviceHost()`.

### 4.3 Integration

- Change-device section visible only when connectivity is Offline, Demo, or Not yet connected.
- When Online, show read-only host display (already exists at line 364–368).
- Reconnect button visible in all non-Online states.
- Both reconnect and change-device disabled during DISCOVERING state.

---

## 5. Feature Extensions (20)

| ID | Name | Description | Category |
|----|------|-------------|----------|
| F01 | Deep Health Check | 4-part deterministic check (REST + Jiffy + Raster + Config Roundtrip) as specified in §2 | Health |
| F02 | Config Roundtrip Test | Write-path integrity verification using Strip Intensity or SID Volume as specified in §3 | Health |
| F03 | Inline Reconnect Feedback | Show connection result inline in diagnostics instead of silent retry | Connection |
| F04 | Inline Device Switcher | Edit host/port directly in diagnostics dialog with pre-validation | Connection |
| F05 | Health Check History | Persist last N health check results with timestamps; show trend line (improving/stable/degrading) | Health |
| F06 | Firmware Version Display | Show firmware version, FPGA version, core version from `/v1/info` in health summary | Info |
| F07 | Latency Indicator | Measure and display REST round-trip latency (p50/p95) from trace events in the health summary | Performance |
| F08 | FTP Health Probe | Active FTP connection test (list root directory) as an optional 5th health check | Health |
| F09 | Config Drift Detection | Compare current runtime config against last-saved flash state; surface unsaved changes count | Config |
| F10 | Network Quality Badge | Classify connection quality (Excellent/Good/Fair/Poor) based on latency + error rate over 5-min window | Performance |
| F11 | Auto-Recovery on Degradation | When health degrades from Healthy, auto-trigger reconnect after configurable delay (default 30s) | Resilience |
| F12 | Export Health Report | One-tap export of structured health check results + system info as JSON/text for support sharing | Diagnostics |
| F13 | Memory Watchpoint Display | Show current Jiffy + Raster values live-updating in expanded diagnostics (read every 2s) | Debug |
| F14 | Notification on State Change | Push notification (via Capacitor local notifications) when health transitions to Degraded/Unhealthy/Offline | Alerting |
| F15 | Device Uptime Display | Derive approximate device uptime from Jiffy clock value (wraps every ~18.2 hours on PAL) | Info |
| F16 | Config Category Health Map | Show per-category config read success/failure as a grid in diagnostics (green/red per category) | Config |
| F17 | Connection Timeline | Visual timeline of connection state transitions (Online→Offline→Demo→Online) with timestamps | Diagnostics |
| F18 | REST Endpoint Heatmap | Color-coded breakdown of REST call frequency and failure rate per endpoint path | Performance |
| F19 | Quick Actions Toolbar | Contextual action buttons in diagnostics: Reset C64, Reboot Ultimate, Save Config, based on current state | Control |
| F20 | Diagnostics Sharing QR Code | Generate QR code from diagnostics export for quick transfer to another device for support | Diagnostics |

---

## 6. Scoring Matrix

**Criteria** (each 1–5):
- **UV** = User Value (direct benefit to user)
- **IE** = Implementation Effort (5 = trivial, 1 = major effort) — inverse scale
- **RK** = Risk (5 = no risk, 1 = high risk) — inverse scale
- **SY** = Synergy (how well it integrates with other features and existing code)
- **Composite** = UV×2 + IE + RK + SY (max 25)

| ID  | Name                        | UV | IE | RK | SY | Composite | Rank |
|-----|-----------------------------|----|----|----|----|-----------|----- |
| F01 | Deep Health Check           | 5  | 3  | 4  | 5  | 22        | 1    |
| F02 | Config Roundtrip Test       | 5  | 3  | 3  | 5  | 21        | 2    |
| F04 | Inline Device Switcher      | 5  | 4  | 4  | 4  | 22        | 1    |
| F03 | Inline Reconnect Feedback   | 4  | 5  | 5  | 5  | 23        | —    |
| F06 | Firmware Version Display    | 4  | 5  | 5  | 4  | 22        | 1    |
| F07 | Latency Indicator           | 4  | 4  | 5  | 4  | 21        | 2    |
| F12 | Export Health Report         | 4  | 4  | 5  | 4  | 21        | 2    |
| F19 | Quick Actions Toolbar       | 4  | 3  | 3  | 5  | 19        | 6    |
| F09 | Config Drift Detection      | 4  | 2  | 4  | 4  | 18        | 7    |
| F05 | Health Check History        | 3  | 3  | 5  | 4  | 18        | 7    |
| F10 | Network Quality Badge       | 3  | 3  | 5  | 4  | 18        | 7    |
| F15 | Device Uptime Display       | 3  | 5  | 5  | 3  | 19        | 6    |
| F17 | Connection Timeline         | 3  | 3  | 5  | 4  | 18        | 7    |
| F08 | FTP Health Probe            | 3  | 3  | 4  | 4  | 17        | 11   |
| F13 | Memory Watchpoint Display   | 3  | 4  | 4  | 3  | 17        | 11   |
| F11 | Auto-Recovery on Degradation| 3  | 3  | 3  | 4  | 16        | 13   |
| F14 | Notification on State Change| 3  | 2  | 3  | 3  | 14        | 14   |
| F16 | Config Category Health Map  | 2  | 2  | 4  | 3  | 13        | 15   |
| F18 | REST Endpoint Heatmap       | 2  | 2  | 5  | 3  | 14        | 14   |
| F20 | Diagnostics Sharing QR Code | 2  | 3  | 5  | 2  | 14        | 14   |

**Sorted by composite (descending), then by UV (descending)**:

1. **F03** (23) — Inline Reconnect Feedback
2. **F01** (22) — Deep Health Check
3. **F04** (22) — Inline Device Switcher
4. **F06** (22) — Firmware Version Display
5. **F02** (21) — Config Roundtrip Test
6. **F07** (21) — Latency Indicator
7. **F12** (21) — Export Health Report

---

## 7. Top 5 Extensions

### 1. Deep Health Check (F01) — Score: 22

**Justification**: Core differentiator. No existing mechanism validates C64 machine liveness from the status surface. Leverages existing `checkC64Liveness()` code and REST probe infrastructure. Gives users deterministic, trustworthy health state instead of passive trace-based inference.

### 2. Config Roundtrip Test (F02) — Score: 21

**Justification**: Validates the write path — the only way to confirm the device actually accepts and persists configuration changes. Strip Intensity provides visible user confirmation. Essential complement to F01; without it, "Healthy" only means "reachable," not "controllable."

### 3. Inline Device Switcher (F04) — Score: 22

**Justification**: Eliminates the friction of navigating to Settings to change host. All connection management collapses into the status surface. Pre-validation prevents committing a bad host. Existing `saveConfiguredHostAndRetry()` + `probeOnce()` make implementation straightforward.

### 4. Firmware Version Display (F06) — Score: 22

**Justification**: Zero-cost information gain. `/v1/info` already returns `firmware_version`, `fpga_version`, `core_version`. Surfacing these in the health summary provides context for debugging and support without any additional API calls.

### 5. Inline Reconnect Feedback (F03) — Score: 23

**Justification**: Highest composite score. The current retry button gives no inline feedback — user must infer success from badge state change. Adding a transient result message ("Connected" / "Failed") with duration takes minutes to implement and immediately improves trust and usability.

---

## 8. Status Surface Model

### 8.1 Unified Status Surface Architecture

```
┌─ AppBar ──────────────────────────────────────┐
│  [UnifiedHealthBadge]                         │
│   → tap opens DiagnosticsDialog               │
└───────────────────────────────────────────────┘

┌─ DiagnosticsDialog ───────────────────────────┐
│ HEADER: "Diagnostics"                         │
│                                               │
│ § HEALTH SUMMARY (collapsible)                │
│   Overall health · Connectivity · Host        │
│   Firmware: v3.14 · FPGA: v2.1 · Core: v1.5  │  ← F06
│   Last REST / FTP activity                    │
│   Contributor rows (App, REST, FTP)           │
│   Primary problem spotlight                   │
│                                               │
│ § HEALTH CHECK (new section)                  │  ← F01 + F02
│   [Run Check]  Result: Healthy  312ms         │
│   REST ✓ · JIFFY ✓ · RASTER n/a · CONFIG ✓   │
│                                               │
│ § CONNECTION (new section)                    │  ← F03 + F04
│   [Retry] "Connected to U64 Elite"            │
│   [Change device ▸]                           │
│     Host: [c64u       ] Port: [80  ]          │
│     [Connect] [Cancel]                        │
│                                               │
│ § QUICK FOCUS CONTROLS                        │
│   [Problems] [Actions] [Logs] [Traces]        │
│                                               │
│ § EVENT STREAM                                │
│   ...                                         │
│                                               │
│ § TOOLBAR                                     │
│   [Share all] [Share filtered] [Clear all]     │
└───────────────────────────────────────────────┘
```

### 8.2 Health Check Result Display Format

**Compact** (single line in badge tooltip or inline):
```
Health: Healthy  REST ✓ · JIFFY ✓ · RASTER n/a · CONFIG ✓ · 312ms
```

**Expanded** (diagnostics dialog section):
```
REST    ✓  200 OK                         52ms
JIFFY   ✓  $00A2 advanced (120→135)       78ms
RASTER  —  skipped (jiffy ok)
CONFIG  ✓  LED Strip Intensity 25→26→25   180ms
────────────────────────────────────────────────
Result: Healthy                           312ms
```

**Degraded/Failed variants**:
```
CONFIG  !  Strip Intensity: mutated but restore unverified
CONFIG  ✗  Audio Mixer: write rejected (HTTP 500)
```

### 8.3 Data Flow

```
User taps "Run Check"
  → runHealthCheck(api)
    → checkRest(api)         → RestCheckResult
    → checkC64Liveness(api)  → C64LivenessSample (existing)
    → selectConfigTarget(api)→ ConfigTarget
    → roundtripConfig(api, target) → ConfigRoundtripResult
  → HealthCheckResult {
      rest: RestCheckResult,
      liveness: C64LivenessSample | null,
      configRoundtrip: ConfigRoundtripResult | null,
      overall: HealthCheckDecision,
      durationMs: number
    }
  → Update UI
  → Optionally influence OverallHealthState via new "HealthCheck" contributor
```

---

## 9. Edge Cases

### EC-1: Config mutation succeeds but restore fails
- **Scenario**: `write(V')` succeeds, `write(V)` throws (network drop mid-roundtrip).
- **Result**: PARTIAL. Device retains V' (±1 intensity step or ±1 dB).
- **User impact**: Strip Intensity differs by 1 from user's setting. Negligible visually.
- **Recovery**: Next user interaction (slider move) or device reboot restores normal state.
- **UI**: CONFIG row shows `!` with message "Restored value unverified — brightness may differ by 1 step."

### EC-2: Config mutation not supported
- **Scenario**: Firmware does not expose config write endpoint, or returns 404/405.
- **Result**: CONFIG = FAIL with `unsupported` qualifier.
- **Health impact**: Overall cannot be Healthy. Shown as Degraded (config-unsupported).
- **UI**: CONFIG row shows `✗ Not supported by firmware`.

### EC-3: Strip Intensity not available
- **Scenario**: Device has no LED strip (e.g., 1541 Ultimate II without LED strip module).
- **Detection**: `GET /v1/configs/LED%20Strip%20Settings/Strip%20Intensity` returns 404 or category not in category list.
- **Fallback**: Try Keyboard Lighting → then Audio Mixer (§3.1 priority chain).
- **If all unavailable**: CONFIG = FAIL (no-target). Log: "No suitable config target for roundtrip test."

### EC-4: Audio fallback — current value is OFF
- **Scenario**: `Vol UltiSid 1` is currently OFF. Adjacent step is -42 dB.
- **Algorithm**: Move from OFF to -42 dB (inaudible). Restore to OFF.
- **Safety**: -42 dB is effectively silent. No audio spike risk.

### EC-5: Audio fallback — current value is at max (+6 dB)
- **Scenario**: `Vol UltiSid 1` is at +6 dB (top of range).
- **Algorithm**: Move to +5 dB (one step down). Restore to +6 dB.
- **Safety**: -1 dB change is imperceptible.

### EC-6: Audio fallback — only one non-OFF option exists
- **Scenario**: Options list has only OFF and one other value.
- **Algorithm**: If current is OFF, move to the one value, restore. If current is the one value, move to OFF, restore.
- **Risk**: Moving from audible to OFF might cause brief silence. Acceptable for health check context. Duration < 200 ms.

### EC-7: REST OK + Config fail
- **Scenario**: Device is reachable (REST ✓) but config write returns error.
- **Result**: REST ✓, JIFFY result, RASTER result, CONFIG ✗.
- **Health**: Cannot be Healthy. Overall = Degraded (minimum). Liveness result still honored for IRQ-stalled/Wedged.
- **Possible cause**: Write-protected firmware, permission issue, or transient device error.

### EC-8: Health check during demo mode
- **Scenario**: App is in DEMO_ACTIVE state. Config writes go to mock server.
- **Behavior**: Health check is disabled when `connectivity !== "Online"`. Button shows "Only available when connected to a real device."
- **Rationale**: Mock server roundtrip is meaningless for real health assessment.

### EC-9: Concurrent config write during roundtrip
- **Scenario**: User adjusts Strip Intensity slider while health check roundtrip is in progress on the same item.
- **Mitigation**: Health check acquires a lightweight mutex (boolean flag). `useInteractiveConfigWrite` checks the flag and delays writes by up to 2s. Roundtrip completes in < 1.5s, so user experiences at most a brief delay.
- **Alternative**: Select a different category than what the user is actively editing. Detection can check if `LightingSummaryCard` is mounted; if so, prefer Audio Mixer.

---

## 10. Terminology

| Term | Definition |
|------|-----------|
| Status Surface | The unified UI area comprising the health badge, diagnostics dialog, health check panel, and connection controls. |
| Health Check | A deterministic, user-triggered or auto-triggered 4-part probe of device reachability, CPU liveness, and config write integrity. |
| Config Roundtrip | A write-verify-restore-verify cycle on a safe, reversible configuration value. |
| Strip Intensity | LED brightness control (0–31 integer). Primary config roundtrip target. |
| Jiffy Clock | CIA Timer A counter at $00A2 (3 bytes, 24-bit). Advances ~60 times/sec on PAL. Stall indicates IRQ failure. |
| Raster Register | VIC-II current raster line at $D012 (1 byte). Changes every ~63 cycles. Stall with Jiffy stall indicates CPU wedge. |
| Contributor | A health signal source: App (error events), REST (HTTP responses), FTP (file operations). |
| PARTIAL | Config roundtrip status: mutation succeeded and was verified, but restore could not be verified. Device may retain the mutated value. |
| Display Profile | Responsive layout tier: compact (phone portrait), medium (phone landscape/small tablet), expanded (tablet/desktop). |
| Liveness Sample | Output of `checkC64Liveness()`: Jiffy start/end, Raster start/end, and decision. |
