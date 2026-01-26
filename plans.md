# Play UI + Coverage Hardening Plan

## 1) Baseline: verify current failing/passing state
- [x] Capture current coverage % (note command output).
	- Coverage (vitest): 85.31% (from npm run test:coverage)
	- Coverage threshold check: 85.32% line coverage (node scripts/check-coverage-threshold.mjs)
- [x] Record current unit test command (Vitest) used by CI.
	- npm run test:coverage
- [x] Record current Playwright E2E command used by CI.
	- npm run test:e2e -- "$(cat shard-files.txt)" (CI shards via scripts/get-playwright-shard-files.mjs)
- [x] Record current “Web | Screenshots” command used by CI.
	- npm run screenshots
- [x] Record current coverage threshold command used by CI.
	- node scripts/check-coverage-threshold.mjs
- [x] Record current ./local-build.sh --screenshots result.
	- ./local-build.sh --screenshots (passed locally)
- [ ] Identify any currently failing CI jobs (if any), including “Web | Screenshots”.

## 2) Stepwise implementation (each step = code change → tests → commit)
- [x] Step: progress slider layout change (passed left, remaining right) + remove “Played: 0:00”.
- [x] Step: move type filters under “Filter files” + wire filtering logic.
- [x] Step: overflow hardening (global) + add/extend regression tests.
- [ ] Step: Audio Mixer “SOLO” spacing fix + validate screenshots.
- [ ] Step: add screenshot artifact doc/img/app-play-demo.png (from ./local-build.sh --screenshots) + update expectations if needed.
- [ ] Step: coverage improvements to reach >= 88%.

## 3) Final verification
- [ ] Run full local verification including unit tests, Playwright, coverage, and ./local-build.sh --screenshots.
- [ ] Confirm “Web | Screenshots” expectations pass locally.
- [ ] Confirm coverage >= 88%.
- [ ] Confirm no overflow regressions with long filenames/hostnames/errors.
- [ ] Mark all items complete only when verified green.