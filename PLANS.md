# PLANS.md

## 1. Non-Negotiable Process
- [ ] Keep this file as the authoritative execution contract for the Disks page redesign.
- [ ] Track every meaningful implementation and verification step here as checkbox tasks.
- [ ] Execute a strict plan -> implement -> verify loop and only mark tasks complete after verification.
- [ ] Finish only when unit, integration/E2E, lint, and build checks pass locally and CI-parity checks are green.

## 2. Design Goal
- [ ] Redesign drive cards into compact, touch-safe hardware-like control strips.
- [ ] Ensure at-a-glance readability for drive identity, power state, bus/type/path metadata, and mounted disk state.
- [ ] Reduce vertical/horizontal footprint while preserving stability across common Android form factors.

## A. Drive Card Structure (All Drive Types)
- [ ] Refactor Drive A, Drive B, and Soft IEC Drive cards to one shared three-row structure implementation.
- [ ] Implement Row 1 as a single non-wrapping line with dominant drive name on the left.
- [ ] Implement Row 1 right-side controls as status control followed by disk-mount icon with fixed-size equal touch targets.
- [ ] Ensure Row 1 never reflows or changes height due to other card content.
- [ ] Implement Row 2 as compact inline metadata (standard: Bus ID • Drive Type; Soft IEC: Bus ID • Default Path).
- [ ] Keep Row 2 left-aligned with no stacked dropdowns and no mid-word wrapping.
- [ ] Keep Row 2 values tappable/selectable and visually secondary to Row 1 controls.
- [ ] Implement Row 3 with mounted disk state on the left and Reset + power action on the right on one line.
- [ ] Ensure Row 3 disk-state text truncates with ellipsis and action buttons never stack vertically.

## B. Drive Status and Disk Mount Controls
- [ ] Make Drive Status control and Disk Mount icon identical in size, weight, and corner radius.
- [ ] Keep Drive Status and Disk Mount icon as distinct touch targets with intentional spacing to avoid mis-taps.
- [ ] Ensure increased touch target size does not create extra rows or increase card height unnecessarily.
- [ ] Enforce overflow behavior so metadata spacing compresses before any wrapping is introduced.

## C. Bus ID and Drive Type Rules
- [ ] Keep standard drive Bus ID selectors inline in Row 2 with range 8-11.
- [ ] Keep Soft IEC Bus ID selector inline in Row 2 with range 8-30 and default/fallback 11.
- [ ] Keep standard drive Drive Type selector inline in Row 2 with options 1541, 1571, 1581.
- [ ] Apply consistent selector sizing and spacing across all drive cards.

## D. Soft IEC Drive Specialization (No Layout Exceptions)
- [ ] Keep Soft IEC Drive on the exact same structural layout as other drives (same rows and alignment).
- [ ] Replace Row 2 second value with Default Path for Soft IEC semantics.
- [ ] Implement Default Path selection through the existing C64U/FTP source browser UI.
- [ ] Label the Soft IEC path action explicitly as `Select directory`.
- [ ] Prevent file selection in the Soft IEC directory selector flow and enforce folder-only selection.
- [ ] Persist selected directory into Soft IEC `Default Path` config and refresh displayed value.

## E. Reset Button Changes
- [ ] Remove the global Disks-page `Reset Drives` control.
- [ ] Add per-drive `Reset` action in each drive card Row 3, immediately left of power control.
- [ ] Keep per-drive Reset button visually subordinate and compact without increasing card height.

## F. Density and Readability Constraints
- [ ] Reduce drive card spacing and padding to materially increase information density.
- [ ] Enforce no mid-word wrapping in drive card labels/values.
- [ ] Enforce visual grouping where status indicators remain attached to drive identity.
- [ ] Implement overflow priority: compress spacing first, truncate secondary text second, never wrap labels/values.

## G. Success Criteria + Verification
- [ ] Validate all three drive cards share the same structural layout.
- [ ] Validate stable single-line header per card: Drive Name + Status + Disk Mount.
- [ ] Validate metadata row is clearly secondary and left-aligned.
- [ ] Validate screen real-estate usage is reduced from current implementation.
- [ ] Validate touch targets remain finger-safe without bloating layout.
- [ ] Update affected unit tests for control relocation/removal and new Soft IEC directory behavior.
- [ ] Update affected Playwright tests for drive card control changes.
- [ ] Run `npm run test` and pass.
- [ ] Run `npm run lint` and pass.
- [ ] Run `npm run build` and pass.
- [ ] Run `npm run test:e2e` and pass.
- [ ] Run `./build` (CI-parity helper) and pass.
