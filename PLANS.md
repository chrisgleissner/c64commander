# PLANS.md - Authoritative Execution Plan

## Current Mission: Fixed Header + Diagnostics Trace Suppression

### Execution Plan (Do NOT merge or skip steps)

- [x] 1. Inspect header layout/scroll containers to locate header positioning and scroll behavior on Home, Play, Disks, Config, Settings, Docs.
- [x] 2. Implement permanently fixed header (no vertical movement) while keeping footer behavior unchanged.
- [x] 3. Verify scrolling applies only to content area and header height remains unchanged across breakpoints.
- [x] 4. Identify diagnostics overlay entry points and current tracing/logging/action creation flow.
- [x] 5. Implement centralized diagnostics-overlay-active state and integrate it into tracing/logging/action creation suppression logic.
- [x] 6. Ensure Share actions bypass suppression and error-driven traces/actions/logs still record while overlay is open.
- [x] 7. Add/update unit tests for overlay-active suppression, Share exception, error recording, and restoration after close.
- [x] 8. Add/update Playwright tests for fixed header on all required pages and diagnostics suppression behaviors.
- [x] 9. Update documentation if behavior changes require it.
- [x] 10. Run tests: `npm run test`, `npm run lint`, `npm run build`, `npm run test:e2e`, `./build`.
- [x] 11. Verify all tests are green and no regressions remain.
