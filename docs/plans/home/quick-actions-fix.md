ROLE
You are a senior full-stack engineer working on C64 Commander. You are operating in strict execution mode with full responsibility for diagnosing, fixing, validating, and proving correctness of device control flows and UI interaction behavior.

You MUST create and maintain PLANS.md as the authoritative execution plan and WORKLOG.md as the execution trace. After creating PLANS.md, you MUST immediately begin implementation and continue autonomously until all tasks are complete.

---

OBJECTIVE
Fix incorrect device control behavior and UI interaction inconsistencies related to:

1. Menu toggle behavior
2. Power cycle failure via Telnet
3. Incorrect reboot routing (Telnet vs REST)
4. Missing differentiation between reboot types

All fixes must be minimal, non-invasive, and aligned with existing architecture.

---

OBSERVED FAILURES (OCR EXTRACTED EVIDENCE)

From runtime error:

Power cycle failed
Item "Power & Reset" not found. Available:
[
SD Card No media,
Flash Internal Memory Ready,
Temp RAM Disk Ready,
USB1 Verbatim Ready,
xPower & Reset x,
xBuilt-in Drive A x,
xBuilt-in Drive B x,
xSoftware IEC x,
xPrinter x,
xConfiguration x,
xStreams x,
xDeveloper x,
xReturn to Main Menu x
]

Interpretation:

- Telnet navigation is attempting to select "Power & Reset"
- Menu structure contains marked/disabled entries (prefixed with x)
- The expected item is either not accessible or incorrectly parsed
- Telnet path is brittle and failing

---

REQUIRED FIXES

### 1. MENU TOGGLE BEHAVIOR

Current:

- First press: opens menu
- Second press: does nothing

Required:

- Menu button must behave as a strict toggle:
  - If menu is closed → open
  - If menu is open → close

Constraints:

- Must use same underlying mechanism (no duplicate logic paths)
- Must not introduce state desynchronization with device
- Must be resilient to latency

Validation:

- 10 consecutive toggles must produce alternating open/close state without drift

---

### 2. POWER CYCLE MUST NOT USE TELNET

Current:

- Uses Telnet navigation → fails

Required:

- Replace Telnet-based power cycle with correct mechanism:
  - Prefer REST endpoint if available
  - If no REST endpoint exists:
    - Use deterministic, validated fallback
    - Must NOT rely on fragile menu navigation

Constraint:

- Telnet usage is allowed ONLY where REST is impossible
- Power cycle must be reliable and deterministic

---

### 3. REBOOT ROUTING IS INCORRECT

Current:

- Overflow menu → Reboot uses Telnet → fails

Required:

#### Case A: "Reboot (Keep RAM)"

- Must call REST reboot endpoint directly
- No Telnet involvement

#### Case B: "Full Reboot"

- Must perform:
  1. Clear RAM via REST
  2. Then call REST reboot

Constraints:

- Order must be strictly enforced
- Must verify success of step 1 before step 2
- Must not silently ignore failures

---

### 4. REMOVE INVALID TELNET DEPENDENCY

System rule:

- Telnet must NOT be used for:
  - Reboot
  - Power cycle
- Only use Telnet for features not exposed via REST

You must:

- Audit all call sites
- Remove incorrect Telnet usage
- Centralize decision logic:
  - REST-first strategy
  - Telnet fallback only when explicitly required

---

IMPLEMENTATION REQUIREMENTS

### Architecture

- Introduce a single authoritative control layer:
  deviceControl.ts (or equivalent)

- Functions must be explicit:
  - rebootKeepRam()
  - rebootFull()
  - powerCycle()
  - toggleMenu()

- No UI component may directly call Telnet or REST

---

### Error Handling

- All failures must:
  - Surface structured error
  - Be logged in Diagnostics → Errors
  - Include:
    - operation
    - transport (REST/Telnet)
    - endpoint or command
    - response

---

### Logging

Each operation must emit trace entries:

- action_start
- transport_used
- request_payload
- response_payload
- action_result

---

TESTING REQUIREMENTS

You MUST create or extend tests to cover:

### 1. Menu Toggle

- Rapid toggle (>= 10 iterations)
- State consistency validation

### 2. Reboot (Keep RAM)

- Verify REST call only
- Assert NO Telnet call

### 3. Full Reboot

- Assert:
  - RAM clear called first
  - reboot called second
- Validate sequence correctness

### 4. Power Cycle

- Must NOT use Telnet
- Must succeed deterministically

### 5. Regression Guard

- Any Telnet usage for above operations must fail test

---

EVIDENCE REQUIREMENTS

For each scenario produce:

- Trace logs (Diagnostics → Traces)
- Screenshots before and after action
- Explicit verification result

---

PLAN EXECUTION RULES

PLANS.md must include:

- Task breakdown with dependencies
- Explicit validation criteria per task
- Status tracking (TODO / IN_PROGRESS / DONE)

WORKLOG.md must include:

- Timestamped entries
- Actions taken
- Evidence references
- Failures and fixes

---

TERMINATION CRITERIA

You may only stop when ALL conditions are met:

1. All four issues are fixed
2. No Telnet usage remains for reboot/power cycle
3. All tests pass
4. All validation scenarios produce correct behavior
5. Evidence is captured and logged
6. No regressions introduced

If ANY condition fails, continue iteration.

---

ANTI-SHORTCUT RULES

- Do NOT assume correctness based on code inspection
- Do NOT skip test creation
- Do NOT rely on manual validation alone
- Do NOT leave dual paths (Telnet + REST ambiguity)

---

START

1. Create PLANS.md
2. Begin execution immediately
3. Continue until termination criteria are satisfied
