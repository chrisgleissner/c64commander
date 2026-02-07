# PLANS.md

This file is the authoritative execution contract for the Home page SID compact redesign.
Strict loop: plan -> execute -> verify. A task is checked only after implementation and verification.

## 1. Objective
- [ ] Confirm current Home SID layout and drive toggle styling references.
- [ ] Define compact two-row SID layout targets and verify space reduction goal.
- [ ] Enumerate data sources needed for SID enablement, address display, volume, and pan.

## 2. Core Design Decision (Mandatory)
- [ ] Implement two-row compact SID layout for all SID sockets (no single-row, no collapsible sections).
- [ ] Ensure layout is static (no dynamic height changes).

## 3. Per-SID Layout (Authoritative Spec)
- [ ] Row 1: render label, base address (hex-only, monospaced), right-aligned ON/OFF toggle matching drive styling.
- [ ] Row 2: render labeled volume and pan sliders with center detent and touch-safe sizes.
- [ ] Ensure sliders are disabled (visible) when SID is OFF.
- [ ] Provide live value feedback during drag only (tooltip/value bubble).

## 4. Strict Exclusions From Home Page
- [ ] Remove editable base address controls from Home SID section.
- [ ] Remove model/filter/register/persistent numeric or dropdown SID controls from Home.

## 5. Base Address Handling (Critical Safety Rule)
- [ ] Always display base address as hex-only text and keep it read-only.
- [ ] Confirm Home SID rows do not add long-press navigation (optional behavior not implemented).

## 6. Error and Diagnostic Behavior
- [ ] Detect enabled-but-silent SID condition and apply non-destructive visual indicator on base address.

## 7. Accessibility and Ergonomics (Non-Negotiable)
- [ ] Enforce >= 48 dp touch targets and sufficient contrast.
- [ ] Ensure disabled state uses opacity + desaturation, not color alone.
- [ ] Avoid relying on color-only state indicators.

## 8. Technical Constraints
- [ ] Use CSS Grid/Flexbox only; no expand/collapse behavior.
- [ ] Keep layout static in Capacitor and avoid dynamic height on interaction.

## 9. Verification Requirements
- [ ] Verify phone-sized viewport layout and one-hand slider usability.
- [ ] Verify center detent is soft and does not block any supported values.
- [ ] Verify live value feedback appears only during slider interaction.
- [ ] Verify SID ON/OFF toggle matches Drive A/B behavior and base address remains visible.
- [ ] Ensure no regressions to Drive, Play, or Config pages.

## 10. Completion Criteria
- [ ] All PLANS.md tasks checked off.
- [ ] Home SID section matches the two-row layout and space reduction goals.
- [ ] All tests pass locally (unit + integration/E2E) and CI is green.
