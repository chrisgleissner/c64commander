# PLANS.md

## Demo Mode Regression Fixes (active)

### Regression Summary
Three regressions were identified in 0.5.2:

1. **Demo indicator shows disconnected (grey) semantics** – `ConnectivityIndicator` labelled
   DEMO_ACTIVE as "C64U Disconnected" and applied `text-muted-foreground` (grey) styling.
2. **Config page renders no groups/items in demo mode** – `ConfigBrowserPage` gated all
   content on `status.isConnected`, which is `false` in demo mode.
3. **CPU Speed slider surfaces failing `GET /v1/info`** – The `/v1/info` TanStack Query was
   enabled for both `REAL_CONNECTED` and `DEMO_ACTIVE`. In demo mode without a native mock
   server the API targets the unreachable real device host, causing failures. Additionally,
   the slider fired intermediate API writes on every 120 ms drag step instead of only on
   release.

### Mapping: Architectural Risks → Tasks

| Risk | Task |
|---|---|
| Demo logical state not bound to demo-specific UI semantics | Fix `ConnectivityIndicator` label + styling for DEMO_ACTIVE |
| Mixed consumer gating of connection state | Fix `ConfigBrowserPage` to use `isConnected \|\| isDemo` |
| `/v1/info` polling not gated behind readiness | Disable `/v1/info` query in demo mode |
| Slider writes not coalesced | Remove `onValueChangeAsync` → `onValueChange` path in `ConfigItemRow` slider |
| Playwright/unit tests do not detect these failures | Add/fix unit tests in `ConnectivityIndicator`, `ConfigBrowserPage`, `useC64Connection` |

### Implementation Phases

#### Phase 1 – Demo Indicator Semantics ✅
- **Entry**: DEMO_ACTIVE state shows grey/disconnected styling
- **Exit**: DEMO_ACTIVE shows FlaskConical icon + success (green) styling + "C64U Demo" label
- **Files**: `src/components/ConnectivityIndicator.tsx`

#### Phase 2 – Config Page Gating ✅
- **Entry**: Config page shows "Not connected" in demo mode
- **Exit**: Config page renders categories/items in demo mode
- **Files**: `src/pages/ConfigBrowserPage.tsx`

#### Phase 3 – `/v1/info` Gating ✅
- **Entry**: `/v1/info` polled in DEMO_ACTIVE, fails when no mock server
- **Exit**: `/v1/info` only polled in `REAL_CONNECTED`
- **Files**: `src/hooks/useC64Connection.ts`

#### Phase 4 – Slider Write Coalescing ✅
- **Entry**: CPU Speed slider fires API call on every 120 ms drag step
- **Exit**: Slider only fires API call on release (`onValueCommitAsync`)
- **Files**: `src/components/ConfigItemRow.tsx`

#### Phase 5 – Test Hardening ✅
- **Entry**: Tests pass despite the above regressions
- **Exit**: Tests fail if demo indicator shows grey, config page hides in demo, `/v1/info`
  fires in demo, or intermediate slider writes fire
- **Files**: `tests/unit/components/ConnectivityIndicator.test.tsx`,
  `tests/unit/pages/ConfigBrowserPage.test.tsx`,
  `tests/unit/hooks/useC64Connection.test.ts`

### Risk Controls
- Do not remove demo from `isActive` in `HomePage.tsx` (config items still loaded in demo).
- Do not revert to eager config loading.
- Slider commit-only change applies to all `ConfigItemRow` sliders; audio mixer real-time
  drag feedback is replaced by commit-on-release, which is acceptable.
- All 1838 tests pass; lint and build clean.

