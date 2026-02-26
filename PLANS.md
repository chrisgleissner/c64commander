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

## Execution checklist
- [ ] Add shared host-edit action helper and reuse it from demo interstitial and connection status surface.
- [ ] Refactor indicator to text-only (`C64U` real / `C64U` + `Demo` demo), add `.indicator-real` and `.indicator-demo`, remove icon rendering.
- [ ] Make indicator click open a pop-up only (no direct retry).
- [ ] Implement minimal pop-up with:
  - Status line
  - Host line + Change control
  - Minimal communication line
  - Context-sensitive actions (`Retry Now` only offline / not yet connected)
- [ ] Update unit tests for indicator and pop-up semantics.
- [ ] Add deterministic Playwright coverage for pop-up states and actions.
- [ ] Run targeted tests, then required full checks (`npm run test:coverage`, `npm run lint`, `npm run build`).
