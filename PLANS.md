# PLANS.md - Authoritative Execution Plan

## Current Mission: Home Header + Diagnostics Overlay + E2E Coverage

### Execution Plan (Do NOT merge or skip steps)

- [x] 1. Capture current Home header layout + AppBar structure to confirm logo sizing constraints and header height behavior.
- [x] 2. Define Home-only header layout (logo + HOME + subtitle) and verify other pages remain unchanged.
- [x] 3. Implement Home header markup updates with strict aspect-ratio preservation and no header height growth.
- [x] 4. Inspect Diagnostics overlay structure and identify current Clear/Share placement, tab labels, and data sources.
- [x] 5. Implement global Clear All placement above tabs and remove global Share control.
- [x] 6. Add Diagnostics filter input below Clear All and above tabs with per-tab state isolation.
- [x] 7. Implement case-insensitive filtering across all rendered fields (timestamps + expanded data) without mutating data.
- [x] 8. Add per-tab Share controls and scope ZIP export strictly to active tab.
- [x] 9. Update Diagnostics tab labels to Errors/Logs/Traces/Actions and ensure Actions is default on open.
- [x] 10. Add/adjust unit tests for header exclusivity, diagnostics filtering, and per-tab share/clear behaviors.
- [x] 11. Add Playwright E2E flows for Home header layout, diagnostics open via indicators, global Clear All, and per-tab Share ZIP contents.
- [x] 12. Update docs if user-facing behavior changes require it.
- [x] 13. Run tests: `npm run test`, `npm run lint`, `npm run build`, `npm run test:e2e`, `./build`.
- [x] 14. Verify all tests are green and no regressions remain.
