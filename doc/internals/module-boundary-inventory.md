# Module boundary inventory

## HVSC-related (TypeScript)

- src/lib/hvsc/index.ts — public API surface (Domain logic)
- src/lib/hvsc/hvscService.ts — orchestration + lifecycle + bridge wrapper (Domain logic)
- src/lib/hvsc/hvscTypes.ts — shared HVSC types (Domain logic)
- src/lib/hvsc/hvscSource.ts — HVSC SongSource implementation (Data source abstraction)
- src/lib/hvsc/native/hvscIngestion.ts — Capacitor bridge registration (Native bridge)
- src/lib/hvsc/native/hvscIngestion.web.ts — web/mock adapter (Platform-specific implementation)
- src/types/hvsc-mock.d.ts — global mock typing for tests (Test-only code)

## SID-related (TypeScript)

- src/lib/sid/sidUtils.ts — SID hashing + SSL payload helpers (Domain logic)
- src/hooks/useSidPlayer.tsx — playback queue + device upload orchestration (Domain logic)
- src/lib/sid/songSources.ts — deprecated shim re-exporting new sources (Domain logic, legacy shim)

## Song source abstraction

- src/lib/sources/SongSource.ts — source contracts and shared types (Data source abstraction)
- src/lib/sources/LocalFsSongSource.ts — local filesystem source (Data source abstraction)
- src/lib/sources/localFsPicker.ts — local file picking adapter (Platform-specific implementation)
- src/lib/sources/HvscSongSource.ts — HVSC source re-export (Data source abstraction)

## Native bridge modules

- src/lib/native/folderPicker.ts — Android folder picker bridge (Native bridge)
- src/lib/native/hvscIngestion.ts — deprecated shim to HVSC bridge (Native bridge, legacy shim)
- src/lib/native/hvscIngestion.web.ts — deprecated shim to HVSC web adapter (Platform-specific implementation, legacy shim)

## Playwright mocks + servers

- playwright/mockHvscServer.ts — HVSC mock server driven by fixtures (Test-only code)
- playwright/hvsc.spec.ts — HVSC UI coverage (Test-only code)
- playwright/ui.spec.ts — full UI widget coverage (Test-only code)
- tests/mocks/mockC64Server.ts — C64U HTTP mock used by UI tests (Test-only code)
