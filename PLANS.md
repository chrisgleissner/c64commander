# PLANS.md

## 1. Scope and Constraints
- [ ] Confirm all changes are limited to Home page UI/tests and no backend feature work.
- [ ] Keep interaction touch-first (no hover behavior) and reuse existing Home design primitives (`Button`, `Select`, `Input`, inline card rows).
- [ ] Preserve accessibility and light/dark readability for compact rows.

## 2. Home Page Header Fix (Home Only)
- [ ] Change Home subtitle text to exactly `C64 Commander`.
- [ ] Verify only Home subtitle changed.
- [ ] Verify subtitle render remains stable on small screens and both themes (manual inspection).

## 3. Streams Section: Compact Dashboard Rows + Inline Edit
- [ ] Refactor Streams default layout to three compact single-line rows (VIC, AUDIO, DEBUG) with aligned columns for label/ip/port/state.
- [ ] Ensure IP and port are always side by side in collapsed rows.
- [ ] Add inline per-row editor (single active row at a time) with IP + PORT fields and explicit `OK` confirm.
- [ ] Add cancel/revert behavior for inline editing.
- [ ] Keep stream state toggle behavior and wire editor confirm to existing config update path.
- [ ] Validate IP (IPv4) and port (1..65535) on confirm with lightweight error feedback.
- [ ] Add/update accessibility labels for row summary and editor fields.
- [ ] Add/adjust unit tests for collapsed rows and inline edit confirm/persist flow.

## 4. Drives Section: Single-Line Rows + Dropdown Editing
- [ ] Refactor drives rows to compact single-line layout with drive name, bus ID, type, and ON/OFF state.
- [ ] Keep dropdown editing for bus ID and type using existing `Select` pattern.
- [ ] Ensure editing does not introduce large vertical whitespace.
- [ ] Keep existing drive state/config wiring and add/update tests for single-line row + dropdown presence/interaction.

## 5. Implementation Guidelines
- [ ] Keep changes small and contained in Home page and corresponding tests only.
- [ ] Preserve existing stable selectors where possible; add minimal new test IDs only where required.
- [ ] Check dark-mode contrast and compact spacing manually against references.

## 6. Verification Requirements
- [ ] Update tests for: Home subtitle text, Streams collapsed layout, Streams inline edit flow, Drives compact rows/dropdowns.
- [ ] If golden/snapshot tests are affected, update only necessary artifacts and record rationale here.
- [ ] Manually compare resulting Home UI behavior against reference screenshots:
  - [ ] `/mnt/data/00-overview-light.png`
  - [ ] `/mnt/data/01-overview-dark.png`
  - [ ] `/mnt/data/01-machine.png`
  - [ ] `/mnt/data/02-quick-config.png`
  - [ ] `/mnt/data/03-drives.png`
  - [ ] `/mnt/data/04-printers.png`
  - [ ] `/mnt/data/05-config.png`
- [ ] Run required local checks and confirm pass: unit tests, integration/UI tests, lint, type/build checks, CI-equivalent local build.

## 7. Required Workflow in PLANS.md
### Design mapping
- [ ] Finalized stream collapsed row columns documented.
- [ ] Finalized stream inline editor placement/controls documented.
- [ ] Finalized drive row columns and reused dropdown/state components documented.

### Verification
- [ ] Record exact commands run and outcomes after implementation.

### Golden/snapshot impact
- [ ] Document whether any golden/snapshot updates were needed.
