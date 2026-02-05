# PLANS.md - Authoritative Execution Plan

## Current Mission: Fixed Header + Diagnostics Trace Suppression

### Execution Plan (Do NOT merge or skip steps)

- [x] 1. Inspect current header layout, scroll containers, and footer positioning on all pages to identify the source of header movement.
- [x] 2. Identify diagnostics overlay activation state and tracing/logging/action creation entry points that need centralized suppression.
- [x] 3. Implement a centralized diagnostics-active mechanism and wire it into tracing/logging/action pipelines with explicit share/error exceptions.
- [x] 4. Update header layout/scroll container styles so only page content scrolls and header never moves while footer remains unchanged.
- [x] 5. Add or update unit tests for diagnostics suppression logic (no traces/logs/actions on interactions, share allowed, error allowed).
- [x] 6. Add Playwright tests for fixed header across Home/Play/Disks/Config/Settings/Docs and diagnostics overlay suppression/restore behavior.
- [ ] 7. Update docs if user-facing behavior changes require it.
- [ ] 8. Run tests: `npm run test`, `npm run lint`, `npm run build`, `npm run test:e2e`, `./build`.
- [ ] 9. Verify all tests are green and no regressions remain.
