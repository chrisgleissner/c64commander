# Review 13 Implementation Prompt

ROLE

You are a staff-level implementation engineer and convergence owner. Your task is to fix every issue identified in `doc/research/review-13/review-13.md` and bring Telnet support to the required end state across runtime, UI, diagnostics, tracing, tests, docs, and screenshots.

You MUST operate in a plan-driven, convergence-oriented manner using `PLANS.md` as the authoritative execution plan and `WORKLOG.md` for traceable progress.

After updating `PLANS.md`, you MUST immediately begin implementation and continue autonomously until all required fixes, tests, docs, and screenshots are complete.

Do not stop at partial fixes. This task is only complete when the repository matches the target state defined below and the gaps in Review 13 are closed.

---

OBJECTIVE

Implement the full Telnet convergence work identified by:

- `doc/research/review-13/review-13.md`
- `PLANS.md`
- `WORKLOG.md`

This is an implementation task, not another audit.

You MUST fix all issues in Review 13, including:

1. Full Telnet feature coverage
2. Full and correct UI integration
3. Full Diagnostics integration
4. Full tracing and action attribution
5. Full documentation consistency
6. Full screenshot consistency
7. Full testing coverage for the new Telnet behavior
8. Full consistency with the existing REST and FTP interaction models

---

AUTHORITATIVE INPUTS

Use these as the source of truth for both scope and target behavior:

- `doc/research/review-13/review-13.md`
- `PLANS.md`
- `WORKLOG.md`
- `doc/c64/telnet/c64u-telnet-integration-spec.md`
- `doc/c64/telnet/c64u-telnet-spec.md`
- `doc/c64/telnet/c64u-telnet-action-walkthrough.md`
- `doc/c64/telnet/c64u-telnet-integration-spec-addendum-1.md`
- `doc/features-by-page.md`
- `doc/diagnostics/*`
- `doc/ux/*`
- `README.md`
- `docs/*` where diagnostics or usage guidance is affected

Review 13 is the implementation gap list. Do not re-litigate it. Close it.

---

MANDATORY EXECUTION MODEL

## Phase 1 - Read and classify

Before editing:

1. Read the files listed above.
2. Re-read all code directly involved in Telnet execution, Home quick actions, Diagnostics, health checks, tracing, tests, and docs.
3. Update `PLANS.md` for this implementation task.
4. Update `WORKLOG.md` with the new implementation scope and progress trail.
5. Classify the task according to repository rules.

Expected classification:

- Treat this as `DOC_PLUS_CODE`.
- Also satisfy all visible-UI obligations, because Home, Diagnostics, docs, and screenshots will change.

## Phase 2 - Implement in convergent slices

Implement in this order unless code reality forces a narrower dependency order:

1. Canonical Telnet capability model
2. Telnet tracing and diagnostics integration
3. Home quick actions and overflow
4. Device-card Telnet controls
5. Health and capability detection convergence
6. Tests
7. Documentation
8. Screenshots

## Phase 3 - Validate honestly

Run the smallest honest validation set that satisfies repo policy for this scope.

At minimum, the final validation must include:

1. `npm run test:coverage`
2. `npm run lint`
3. `npm run build`
4. Any targeted Playwright runs needed to validate the changed UI and screenshot generation
5. Screenshot refresh only for the Telnet-affected surfaces
6. If files under `agents/` are touched, also run `npm run test:agents`

Coverage requirement:

- Global branch coverage must remain `>= 91%`

Do not claim validation you did not run.

---

REQUIRED END STATE

You MUST implement the following target state.

## A. Telnet action coverage

The runtime Telnet capability registry must cover all Telnet-only actions still in scope, including the Developer submenu documented in the spec and already present in the mock fixture:

- Power Cycle
- Save REU Memory
- IEC Turn On
- IEC Reset
- IEC Set Directory
- Printer Flush/Eject
- Printer Reset
- Printer Turn On
- Save Config to File
- Clear Flash Config
- Clear Debug Log
- Save Debug Log
- Save EDID to File

The runtime registry, executor, diagnostics, and tests must all agree on the same canonical action inventory.

## B. Home quick actions

Quick Actions on Home must contain EXACTLY these primary actions, in this order:

1. Reset
2. Reboot
3. Pause/Resume
4. Menu
5. Save RAM
6. Load RAM
7. Power Cycle
8. Power Off

Rules:

- Visible `Reboot` MUST map to Telnet `Reboot (Clr Mem)`.
- The raw label `Reboot (Clear RAM)` or equivalent MUST NOT be exposed in primary actions.
- No duplicate semantics in primary actions.
- Compact mode MUST render two rows of four buttons.

## C. Home overflow

Add a machine-actions overflow immediately to the right of Quick Actions.

Rules:

- Triggered by `...`
- Must contain at minimum:
  - Reboot (Keep RAM)
  - Save REU
- Must NOT duplicate the primary quick actions
- Must be implemented in a way that can absorb future Telnet actions without re-breaking the main 2x4 layout

## D. Device cards

Printer card must expose:

- Reset
- Flush/Eject

Drive cards must expose:

- Reset at minimum where appropriate
- Other relevant Telnet actions where appropriate

The device-card action model must be intentional and consistent, not ad hoc.

## E. Telnet tracing

Every Telnet action MUST:

- emit trace entries
- be attributable to a user action
- aggregate under the corresponding action summary
- appear in Diagnostics → Traces and Actions

Trace data must include enough detail for debugging:

- action id
- user-facing label
- menu path
- duration
- result
- normalized failure details

## F. Diagnostics

Diagnostics must treat Telnet as a first-class subsystem consistent with REST and FTP.

Required:

- dedicated Telnet filter
- Telnet contributor support
- Telnet effect support in action summaries
- Telnet problem detection
- Telnet activity counters
- Telnet trace and action visibility in expanded/collapsed evidence rows

Do not bolt Telnet on as a probe-only special case.

## G. Health and capability modeling

Required:

- Telnet health must participate in the steady-state contributor model
- Telnet failures must not be collapsed into generic `App` failures
- Telnet availability must not be gated only by `isNativePlatform()`
- Device-family/protocol differences such as menu-key selection must be handled correctly

## H. Documentation

Bring the documentation set into sync with the implemented Telnet behavior, including:

- `README.md`
- `src/pages/DocsPage.tsx`
- `doc/features-by-page.md`
- `doc/ux-interactions.md`
- relevant `doc/diagnostics/*`
- relevant `docs/*`

Remove contradictions. The docs must describe the implementation that ships after this task.

## I. Screenshots

Refresh only the screenshot corpus required by the visible UI changes.

Required screenshot coverage:

- updated Quick Actions
- compact 2x4 layout
- overflow closed
- overflow open
- device cards with Telnet controls
- Diagnostics with Telnet filter / Telnet evidence if applicable

Do not refresh unrelated screenshot folders.

## J. Tests

Add or update regression coverage for:

- full Telnet action registry and action mapping
- visible `Reboot` mapping to Telnet clear-memory semantics
- Home quick-action ordering
- compact 2x4 layout
- overflow population and non-duplication
- Telnet trace emission
- Diagnostics contributor/filter/action-summary behavior for Telnet
- device-card Telnet controls
- relevant Playwright coverage for Home and Diagnostics
- Maestro and/or real-device flows where native behavior matters

Every bug or gap closed here must be locked by meaningful regression tests.

---

IMPLEMENTATION RULES

1. Do not weaken Review 13 findings by narrowing scope.
2. Do not hide missing behavior behind comments, TODOs, or dead code.
3. Do not remove Telnet support from existing surfaces to make the task smaller.
4. Do not weaken diagnostics assertions to avoid implementing Telnet support properly.
5. Do not refresh the full screenshot corpus unless the task genuinely changes all of it.
6. Preserve Addendum 1 behavior: CommoServe search/browse remains direct HTTP plus device REST, not a new Telnet dependency.
7. Keep REST and FTP diagnostics behavior intact while extending the model to include Telnet.

---

EXPECTED DELIVERABLES

You must produce actual repository changes, including:

- production code updates
- test updates/additions
- doc updates
- screenshot updates for the changed Telnet surfaces
- updated `PLANS.md`
- updated `WORKLOG.md`

Do not create another research review. Implement.

---

TERMINATION CRITERIA

Stop only when all of the following are true:

1. Every gap in `review-13.md` is closed in code, tests, docs, and screenshots.
2. Home quick actions match the exact required canonical state.
3. Overflow exists and is correctly populated.
4. Device cards expose the required Telnet actions.
5. Telnet actions emit traces and aggregate into Diagnostics actions.
6. Diagnostics exposes Telnet as a first-class contributor/filter/evidence type.
7. Health and capability detection are converged.
8. Docs no longer contradict the implementation.
9. Required screenshots are refreshed and limited to the impacted surfaces.
10. Required validation passes, including `npm run test:coverage` with global branch coverage `>= 91%`.

The final result must be strong enough that `doc/research/review-13/review-13.md` would no longer identify meaningful remaining Telnet gaps.
