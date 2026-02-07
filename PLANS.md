# PLANS.md

This file is the authoritative execution contract for Home page structural layout fixes.
Strict loop: plan -> execute -> verify. A task is checked only after implementation and verification.

## Non-Negotiable Process
- [x] Create and maintain `PLANS.md` as authoritative contract for this task.
- [ ] Execute all work through plan-execute-verify loop.
- [ ] Keep scope limited to Home page Drives and Streams rendering/editing.
- [ ] Complete verification gates: unit tests, UI/integration tests, narrow-width layout checks, CI green.

## Scope Guardrails
- [ ] Restrict code changes to Home page Drives/Streams behavior and directly affected tests/utilities.
- [ ] Do not add new product features.
- [ ] Do not change REST semantics.
- [ ] Do not refactor unrelated UI.

## Section A - Drives: Layout Correction
- [ ] Replace each drive entry with mandatory two-line layout.
- [ ] Ensure line 1 keeps drive name left and ON/OFF toggle right.
- [ ] Ensure drive name does not truncate.
- [ ] Ensure line 2 shows explicit `Bus ID` and `Type` labels.
- [ ] Ensure selectors avoid internal wrapping and keep values readable on narrow widths.
- [ ] Keep existing drive toggle/select interactions and request behavior unchanged.
- [ ] Add/update tests for new drives layout expectations.

## Section B - Streams: IP Address Visibility & Editing
- [ ] Replace split/truncated stream endpoint display with single full `IP:PORT` text.
- [ ] Remove stream endpoint ellipsis/truncation behavior.
- [ ] Keep stream ON/OFF toggle right-aligned.
- [ ] Keep default row read-only and open editor on tap.
- [ ] Treat endpoint as one editable field in editor.
- [ ] Validate on confirm with strict IPv4 + valid port range.
- [ ] Preserve request payload format as single `IP:PORT` value.
- [ ] Add/update tests for endpoint rendering and editing/validation.

## Section C - UX Principles Enforcement
- [ ] Favor vertical density over horizontal compression in Drives and Streams rows.
- [ ] Ensure no truncated technical value in target sections.
- [ ] Keep explicit, stable labels (`Bus ID`, `Type`, `IP:PORT`).
- [ ] Preserve scanable control-panel style hierarchy.

## Section D - Verification
- [ ] Verify drive names are never truncated in updated layout.
- [ ] Verify `Bus ID` and `Type` labels are fully visible.
- [ ] Verify stream rows always show full `IP:PORT`.
- [ ] Verify tap-to-edit and confirm/cancel flows work with validation.
- [ ] Verify layout behavior on narrow Android-like viewport widths.
- [ ] Verify no regressions in other Home page controls.

## Delivery
- [ ] Keep `PLANS.md` updated with completion status.
- [ ] Run unit tests and pass.
- [ ] Run UI/integration tests (Playwright) and pass.
- [ ] Run lint/build/full local build helper and pass.
- [ ] Confirm CI is green (or provide exact status if local-only).
