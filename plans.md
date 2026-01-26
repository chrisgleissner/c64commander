# Vertical Label Layout + Coverage Plan

## 1) Baseline: reproduce + scope
- [x] Verify vertical label rendering is absent on Configuration → Audio Mixer.
	- npm run test:e2e -- playwright/solo.spec.ts (config labels stay horizontal at narrow widths)
- [x] Identify affected components and categories beyond Audio Mixer.
	- ConfigItemRow (all config rows), Audio Mixer + Drive A Settings
- [x] Record current coverage and threshold results.
	- npm run test:coverage (89.01% lines)
	- node scripts/check-coverage-threshold.mjs (Line coverage: 89.01%)
- [x] Capture current Playwright + screenshots commands used by CI.
	- npm run test:e2e
	- npm run screenshots
- [ ] Identify any currently failing CI jobs (if any), including “Web | Screenshots”.

## 2) Tests first (red)
- [x] Add component/unit tests that fail on vertical text rendering.
	- tests/unit/components/ConfigItemRow.test.tsx
- [x] Add Playwright checks for vertical labels + overflow at narrow widths.
	- playwright/solo.spec.ts

## 3) Smart layout abstraction
- [x] Introduce reusable label+widget layout logic with dynamic measurement.
	- src/components/ConfigItemRow.tsx
- [x] Cover layout decision logic with unit tests.
	- tests/unit/components/ConfigItemRow.test.tsx

## 4) Apply fixes
- [x] Apply layout logic to Audio Mixer sliders.
- [x] Apply layout logic to at least one other configuration category.
- [x] Ensure at least one non-slider widget uses the layout logic.

## 5) Test hardening
- [x] Ensure layout tests fail on vertical/rotated labels.
- [x] Verify overflow guards on narrow viewports.
	- npm run test:e2e -- playwright/solo.spec.ts

## 6) Coverage improvements (>= 88.5%)
- [x] Identify low-coverage files from latest report.
	- ConfigItemRow.tsx
- [x] Add meaningful tests to raise average coverage to >= 88.5%.
	- tests/unit/components/ConfigItemRow.test.tsx
- [x] Verify coverage threshold locally.
	- npm run test:coverage (89.01% lines)
	- node scripts/check-coverage-threshold.mjs (Line coverage: 89.01%)

## 7) Final verification
- [ ] Run full local verification (unit, Playwright, screenshots, local-build).
- [ ] Confirm screenshots match expectations.
- [ ] Confirm coverage >= 88.5%.
- [ ] Confirm no overflow regressions.
- [ ] Mark all items complete only when verified green.