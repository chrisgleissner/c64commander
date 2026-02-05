# PLANS.md - Authoritative Execution Plan

## Current Mission: Diagnostics UI + Global Status Refactor

**Objective:** Conclusively refactor Diagnostics UI, shared Traces/Actions rendering, global action bar, top-bar indicators, and canonical color system with full test coverage and clean build.

### Design Assumptions (Update if revised)
- Diagnostics overlay is owned by Settings page and uses the existing Diagnostics panel.
- Share / Export produces a ZIP archive using existing export utilities, scoped by active tab.
- Global top bar is the app header defined in existing layout components.
- Canonical color palette will be centralized and reused by Diagnostics and global status UI.

### Execution Plan (Do NOT merge or skip steps)

- [x] 1. Inspect current Diagnostics overlay, tabs, and actions UI to identify renderers, labels, and per-tab buttons.
- [x] 2. Locate global top bar implementation and current device/demo indicator placement.
- [x] 3. Define canonical color tokens and map semantic meanings to a single source of truth.
- [x] 4. Implement tab label ordering and eliminate "Errors" label usage across UI and tests.
- [x] 5. Create shared Traces/Actions list-item renderer with mode flag/adapter (documented below).
- [x] 6. Implement collapsed two-line layout with wrapping and aligned timestamp/duration.
- [x] 7. Ensure expanded view remains intact for Traces and Actions without regression.
- [x] 8. Add global Diagnostics action bar (Clear All + Share / Export) and remove per-tab actions.
- [x] 9. Implement confirmation dialog for Clear All and global clearing behavior.
- [x] 10. Implement Share / Export behavior scoped to active tab.
- [x] 11. Implement global top-bar activity indicator cluster (REST/FTP/Errors) with animation + counts.
- [x] 12. Wire indicator tap to open Diagnostics overlay on Actions tab.
- [x] 13. Update/extend tests for all requirements listed in the prompt.
- [x] 14. Update docs (README.md or doc/) if user-facing behavior changes require it.
- [x] 15. Run tests: `npm run test`, `npm run lint`, `npm run build`, `npm run test:e2e` (if required), `./build`.
- [x] 16. Verify clean build and all tests passing.

### Shared Renderer Requirement (Explicit)
- Traces and Actions MUST use the same underlying list-item renderer with a mode flag/adapter.
- Separate renderers are forbidden.
- This requirement will be verified in code review and tests.

### Test Coverage Mapping (to be completed during implementation)
- Tab labels/order: TBD
- Shared renderer usage: TBD
- Wrapping + alignment: TBD
- Line 2 presence/absence rules: TBD
- Color usage per semantic role: TBD
- Global action bar uniqueness: TBD
- Clear All confirmation + full reset: TBD
- Share / Export per active tab: TBD
- Top-bar indicators visibility/animation/counts/navigation: TBD
- Removal of forbidden buttons: TBD

### Final Verification Checklist (tick when done)
- [x] All plan steps completed.
- [x] Diagnostics UI matches specification exactly.
- [x] All required tests added/updated and passing.
- [x] `npm run test` passes.
- [x] `npm run lint` passes.
- [x] `npm run build` passes.
- [x] `./build` passes.
