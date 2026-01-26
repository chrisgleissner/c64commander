# Vertical Label Layout + Coverage Plan

## 1) Baseline: reproduce + scope
- [ ] Reproduce vertical label rendering on Configuration → Audio Mixer.
- [ ] Identify affected components and categories beyond Audio Mixer.
- [ ] Record current coverage and threshold results.
- [ ] Capture current Playwright + screenshots commands used by CI.
- [ ] Identify any currently failing CI jobs (if any), including “Web | Screenshots”.

## 2) Tests first (red)
- [ ] Add component/unit tests that fail on vertical text rendering.
- [ ] Add Playwright checks for vertical labels + overflow at narrow widths.

## 3) Smart layout abstraction
- [ ] Introduce reusable label+widget layout logic with dynamic measurement.
- [ ] Cover layout decision logic with unit tests.

## 4) Apply fixes
- [ ] Apply layout logic to Audio Mixer sliders.
- [ ] Apply layout logic to at least one other configuration category.
- [ ] Ensure at least one non-slider widget uses the layout logic.

## 5) Test hardening
- [ ] Ensure layout tests fail on vertical/rotated labels.
- [ ] Verify overflow guards on narrow viewports.

## 6) Coverage improvements (>= 88.5%)
- [ ] Identify low-coverage files from latest report.
- [ ] Add meaningful tests to raise average coverage to >= 88.5%.
- [ ] Verify coverage threshold locally.

## 7) Final verification
- [ ] Run full local verification (unit, Playwright, screenshots, local-build).
- [ ] Confirm screenshots match expectations.
- [ ] Confirm coverage >= 88.5%.
- [ ] Confirm no overflow regressions.
- [ ] Mark all items complete only when verified green.