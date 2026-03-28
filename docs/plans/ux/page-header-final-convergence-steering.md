Add the following items as NEW TODOs to the existing PLANS.md (do not modify or reorder existing tasks). Then continue execution immediately.

All items below are mandatory and must meet the same evidence, testing, and screenshot standards as the rest of the plan.

---

TODO: FIX SAFE AREA / STATUS BAR OVERLAP (REAL DEVICE REGRESSION)

Problem:
On a physical Pixel 4 device, the Android system status bar overlaps the app header. This does NOT happen in emulator screenshots. The footer behaves correctly.

Reference:
docs/img/devices/pixel4/home_v0.7.0.png

Constraints:

- DO NOT reintroduce header padding workaround previously removed.
- Fix must be systemic and platform-correct.
- Must work across Android, iOS, and Web.

Required actions:

1. Analyze Capacitor safe-area handling and viewport configuration.
2. Identify why top inset is ignored while bottom inset works.
3. Implement correct safe-area handling using platform-native insets.
4. Ensure header is always fully below system status bar.

Validation:

- Compare real device vs emulator screenshots.
- Produce BEFORE/AFTER evidence.

Acceptance criteria:

- Zero overlap on all platforms.
- No hack-based padding.
- Consistent across compact, standard, expanded profiles.

---

TODO: FIX HEALTH CHECK INCOMPLETE EXECUTION (TELNET + CONFIG)

Observed diagnostics (from screenshot):

TELNET:

- Status: Timeout
- Message: "TELNET timed out after 2000ms"
- Duration: 2000ms

CONFIG:

- Status: Cancelled
- Message: "No suitable config roundtrip target available"

Summary:

- Result: Degraded
- Total duration: 2631ms
- Latency: p50 68ms, p90 88ms, p99 2076ms

Problem:

- TELNET check executes but fails systematically.
- CONFIG check is skipped entirely.

Required actions:

1. Trace health check execution path end-to-end.
2. Ensure TELNET:
   - Uses correct host (c64u)
   - Uses correct protocol and timeout handling
   - Produces actionable result (not silent timeout)
3. Ensure CONFIG:
   - Is not skipped
   - Has a valid roundtrip target
   - Executes real validation

Validation:

- Run against real device (c64u), not mocks only.
- Capture traces showing request + response.

Acceptance criteria:

- No skipped checks.
- No silent failures.
- Diagnostics reflect real system state.

---

TODO: FIX POWER CYCLE FAILURE (REAL TELNET RESPONSE PARSING)

Observed error (OCR extracted):

"Power cycle failed

Item 'Power & Reset' not found. Available:
[SD SD Card No media,
Flash Internal Memory Ready,
Temp RAM Disk Ready,
USB1 Verbaltqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqk Ready,
xPower & Reset x,
xBuilt-in Drive A x,
xBuilt-in Drive B x,
xSoftware IEC x,
xPrinter x,
xConfiguration x,
xStreams x,
xDeveloper x,
xReturn to Main Menu x,
mqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqj]"

Key observations:

- Menu items are present but wrapped in "x ... x" markers.
- Output contains noise:
  - repeated "q" characters
  - malformed borders (mqqq..., Verbaltqqq...)
- Parser fails to detect "Power & Reset" despite it being present.

Problem:

- Telnet parsing logic assumes clean/mock format.
- Real device output contains:
  - control characters or PETSCII artifacts
  - border drawing characters
  - noisy repetition
- Matching is too strict and fails.

Required actions:

1. Capture raw Telnet output from real device (c64u).
2. Compare with mock responses used in tests.
3. Identify parsing assumptions that break:
   - exact string matching
   - formatting dependencies
4. Rewrite parser to:
   - ignore border/noise characters
   - normalize text before matching
   - detect menu entries semantically (not exact match)
   - tolerate repeated or malformed characters

5. Ensure correct navigation:
   - detect "Power & Reset"
   - select it reliably

Validation:

- Execute Power Cycle successfully on real device.
- Capture full trace:
  - raw Telnet output
  - normalized representation
  - selection steps

Testing:

- Add cases for:
  - real device output (noisy)
  - clean mock output
  - corrupted / partial output

Acceptance criteria:

- Power Cycle works on real hardware.
- Parser is robust against noise.
- Error messages are clean and bounded.

---

GLOBAL EXECUTION RULES (apply to all above tasks):

- Do NOT assume completion based on existing code or files.
- Every fix must include:
  - traces
  - logs
  - screenshots if visually relevant
- Prefer real device validation over mocks.
- Maintain minimal invasive changes.
- Do not regress existing functionality.

After adding these TODOs, continue execution immediately from the highest-priority pending task.
