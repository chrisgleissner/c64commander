# Maestro Flakiness Suspects

| Suspect | Rationale | Evidence | Confidence |
| --- | --- | --- | --- |
| Text-only selectors in complex dialogs | `tapOn`/`assertVisible` on plain text can collide with repeated labels or localization drift | High density of text selectors in `.maestro/*.yaml`; many flows rely on label text only | Medium |
| Background execution smoke flow | Historically produced repeated failed screenshots in prior runs | `test-results/maestro/*/screenshot-❌-*(smoke-background-execution).png` | Medium |
| File picker cancel flow | Flow repeatedly observed with historical failure screenshots across runs | `test-results/maestro/*/screenshot-❌-*(smoke-file-picker-cancel).png` | Medium |
| Timing sensitivity in animation-heavy transitions | Frequent `waitForAnimationToEnd` + `extendedWaitUntil` patterns indicate state timing coupling | `.maestro/subflows/*.yaml`, `.maestro/smoke-*.yaml` | Medium |
| Device/perf variance in CI | Maestro docs define short/medium timeouts and selective CI tags to manage run-time variance | `doc/testing/maestro.md` (timeouts and tag filtering sections) | High |

## Current-run note
- Latest available report in `test-results/maestro/maestro-report.xml` shows a 2-test subset (`smoke-launch`, `smoke-file-picker-cancel`) passing.
- This review did not re-run a full Maestro matrix; flakiness assessment combines static pattern review + historical artifacts.
