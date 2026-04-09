# Device Switcher V2 Worklog

## [2026-04-09 23:14 +01:00] EXEC-INIT: Execution initialized from authoritative V2 plan

What changed:

- Replaced `PLANS.md` with the Device Switcher V2 execution plan derived from `docs/research/device-switcher/v2/plan.md`.
- Preserved the authoritative phase ordering from Phase 0 through Phase 8.
- Added execution tasks, validation checkpoints, and completion gates inside each authoritative phase.
- Reset `WORKLOG.md` to track this feature execution from plan initialization forward.

Execution classification:

- `DOC_PLUS_CODE`
- `UI_CHANGE`

Next step:

- Begin Phase 0 impact mapping against the minimal implementation surfaces required by the plan.

## [2026-04-09 23:17 +01:00] PHASE-0: Impact map aligned to the existing V2-capable architecture

What I verified:

- Saved-device persistence, selection, migration, verification summaries, label helpers, mismatch handling, and bounded summary retention already exist in `src/lib/savedDevices/store.ts`.
- Picker-side switching orchestration already exists in `src/hooks/useSavedDeviceSwitching.ts` and uses `/v1/info` verification plus active-route invalidation.
- Active-route switch invalidation already excludes `c64-all-config` in `src/lib/query/c64QueryInvalidation.ts`.
- Origin-device continuity for `ultimate` playlist and disk items already exists in `src/lib/savedDevices/deviceBoundOrigin.ts`, `src/lib/playback/playbackRouter.ts`, and `src/lib/disks/diskMount.ts`.
- Settings already acts as the CRUD surface for saved devices in `src/pages/SettingsPage.tsx`.

Current V2 blockers:

- `src/components/UnifiedHealthBadge.tsx` still supports tap-only Diagnostics open; no badge long press exists.
- `src/components/diagnostics/DiagnosticsDialog.tsx` still owns a persistent `Devices` section and routes switching from there, which violates the V2 plan.
- Diagnostics currently uses long press on the device line for connection editing; that gesture pattern is local to Diagnostics and not the badge.
- `useHealthState` already resolves the badge label from the selected saved device short label, so the badge is a valid device-context anchor.

Touched runtime surfaces for implementation:

- Badge interaction and label surface: `src/components/UnifiedHealthBadge.tsx`, `src/hooks/useHealthState.ts`
- Switch state and orchestration: `src/lib/savedDevices/store.ts`, `src/hooks/useSavedDevices.ts`, `src/hooks/useSavedDeviceSwitching.ts`, `src/lib/connection/connectionManager.ts`, `src/lib/query/c64QueryInvalidation.ts`
- Diagnostics ownership cleanup: `src/components/diagnostics/DiagnosticsDialog.tsx`, `src/lib/diagnostics/diagnosticsOverlay.ts`, `src/pages/SettingsPage.tsx`
- Decision-interstitial primitives to reuse: `src/components/ui/app-surface.tsx`
- Device-bound continuity surfaces to preserve: `src/lib/savedDevices/deviceBoundOrigin.ts`, `src/lib/playback/playbackRouter.ts`, `src/lib/disks/diskMount.ts`
- Mock layers to extend in Phase 6: `tests/mocks/mockC64Server.ts`, `tests/android-emulator/helpers/mockC64Server.mjs`, `src/lib/native/mockC64u.ts`, `src/lib/native/mockC64u.web.ts`, `android/app/src/main/java/uk/gleissner/c64commander/MockC64UPlugin.kt`

Gesture and test contract:

- Supported interaction path: pointer-driven long press on the header badge using `pointerdown`/`pointerup`/`pointerleave`/`pointercancel` with a deterministic timeout and explicit click suppression after long press.
- One-device case must suppress switching affordance entirely and preserve current tap behavior.
- Unit/UI regressions can exercise long press deterministically with fake timers and pointer events; end-to-end harness coverage will be extended in Phase 6.

Phase result:

- Phase 0 exit criteria met. The implementation can proceed without speculative architecture changes.

Next step:

- Start Phase 1 and Phase 2 on the already-existing saved-device foundation by moving the switch entry point from Diagnostics to the header badge.
