# Connection Status Surface Plan

## Current model (observed)
- Top-right indicator: `/src/components/ConnectivityIndicator.tsx`
  - Uses icon + single `C64U` text.
  - Clicking triggers `discoverConnection('manual')` directly.
- Mode and state source: `/src/lib/connection/connectionManager.ts` snapshot fields
  - `state` (`UNKNOWN | DISCOVERING | REAL_CONNECTED | DEMO_ACTIVE | OFFLINE_NO_DEMO`)
  - `lastProbeAtMs`, `lastProbeSucceededAtMs`, `lastProbeFailedAtMs`
- Host source
  - Persisted host comes from `resolveDeviceHostFromStorage()` in `/src/lib/c64api.ts`.
- Existing host-edit interstitial
  - `/src/components/DemoModeInterstitial.tsx` with host input + Save & Retry path.

## Target model
Use explicit, stateless status inputs in the Connection Status Surface:
- `configuredHost: string`
- `lastAttemptAt: number | null`
- `lastAttemptSucceeded: boolean | null`
- `lastSuccessAt: number | null`
- `attemptInFlight: boolean`
- `isDemoMode: boolean` (derived from `lastAttemptSucceeded === false`)

Status derivation rules:
1. `attemptInFlight` -> `Checking…`
2. `lastAttemptSucceeded === true` -> `Online`
3. `lastAttemptSucceeded === false && lastSuccessAt != null` -> `Offline`
4. `lastSuccessAt == null && lastAttemptAt != null` -> `Not yet connected`
5. no attempts -> `Not yet connected`

## Execution checklist (follow-up diagnostics extension)
- [ ] Keep existing indicator, status logic, host section, retry logic, and overall layout unchanged outside the new diagnostics block.
- [ ] Add a `Diagnostics` section in the existing connection pop-up with exactly three rows: REST, FTP, Log issues.
- [ ] Implement ratio-based severity (failed/total) for REST and FTP, and issues/total logs for Log issues.
- [ ] Render exactly one subtle left circle per row (no bullets, no duplicate badges), color-coded by severity.
- [ ] Keep row text neutral; color only the failure/issue number and the left circle.
- [ ] Add deterministic click navigation from each row to the correct Diagnostics tab.
- [ ] Address prior reviewer comments: remove redundant configured-host reads and support Enter key save in host edit input.
- [ ] Add dedicated unit tests for `src/lib/connection/hostEdit.ts` and update connectivity-indicator tests for diagnostics rows.
- [ ] Add deterministic Playwright coverage for diagnostics rows and row-click tab navigation.
- [ ] Run targeted tests first, then full validation (`npm run lint`, `npm run test:e2e`, `npm run test:coverage`, `npm run build`).
