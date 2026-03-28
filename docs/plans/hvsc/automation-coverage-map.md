# HVSC Automation Coverage Map

## Required Analysis

The repo already contains a contradiction that must be made explicit before any new PASS claim:

- `F015` proves download/install/ingest/cancel/reset lifecycle only. It does not prove add-to-playlist, persistence, playback routing, or streamed audio.
- `F016` proves cache detection, cached ingest, and cached-content browsing only. It does not prove playlist import, playback routing, or streamed audio.
- `playwright/hvsc.spec.ts` proves the full download -> ingest -> browse -> add -> playback-request shape in a mocked web/runtime path. It is strong CI-safe flow coverage, but not native ingest proof and not hardware playback proof.
- `.maestro/smoke-hvsc.yaml`, `.maestro/edge-hvsc-ingest-lifecycle.yaml`, and `.maestro/edge-hvsc-repeat-cancel-resume.yaml` prove native sequence shape, progress checkpoints, and cancel/restart behavior. They do not correlate selected HVSC tracks to real C64U audio.
- `HvscIngestionPluginTest.kt` and `HvscSevenZipRuntimeTest.kt` prove Android-native ingest contracts and real `.7z` runtime support. They do not prove the app UI browse/import/play chain.
- The JS/TS unit and hook tests already prove the metadata-sensitive parts of the app path: paged HVSC browsing, HVSC add-to-playlist, duration/subsong preservation, and playlist persistence.
- `c64scope/src/validation/cases/playback.ts` proves the authoritative audio oracle for playback: packet count greater than zero and RMS at least `0.005`.

The executor bug behind the optimistic PASS story was that `F015` and `F016` were mapped to `AF-PLAY-SURFACE-001`, which is only a Play-surface marker check. The executor now maps them to dedicated HVSC workflow case IDs:

- `F015` -> `AF-HVSC-DOWNLOAD-PLAY-001`
- `F016` -> `AF-HVSC-CACHE-PLAY-001`

## Automation Matrix

| Stage                                               | Exact test file(s)                                                                                                                                                                                                                                                          | CI-safe                                        | Local     | Oracle class used                                                         | What it still does not prove                                                           |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | --------- | ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1. HVSC remote download request                     | `playwright/hvsc.spec.ts`                                                                                                                                                                                                                                                   | Yes                                            | Yes       | UI + mock request/asserted runtime state                                  | Real Android bridge download and real remote archive transfer                          |
| 2. Archive download completion                      | `playwright/hvsc.spec.ts`                                                                                                                                                                                                                                                   | Yes                                            | Yes       | UI summary + filesystem marker in mocked runtime                          | Real device-side archive bytes and real cache persistence on Android                   |
| 3. Ingest start and progress                        | `playwright/hvsc.spec.ts`, `.maestro/edge-hvsc-ingest-lifecycle.yaml`, `.maestro/edge-hvsc-repeat-cancel-resume.yaml`, `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`                                                                     | Playwright/JVM: Yes; Maestro: device lane only | Yes       | UI progress, native progress payload shape, cancel classification         | App-first correlation from progress to later playlist/playback outcome                 |
| 4. Ingest completion into the real queryable source | `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`, `android/app/src/test/java/uk/gleissner/c64commander/HvscSevenZipRuntimeTest.kt`, `tests/unit/hvsc/hvscBrowseIndexStore.test.ts`, `tests/unit/sourceNavigation/hvscSourceAdapter.test.ts` | Yes                                            | Yes       | Native contract + query-backed browse index + source adapter              | Real UI browse after a real Android ingest run                                         |
| 5. HVSC browse in the add-items UI                  | `playwright/hvsc.spec.ts`, `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`, `tests/unit/sourceNavigation/hvscSourceAdapter.test.ts`, `tests/unit/hvsc/hvscBrowseIndexStore.test.ts`                                                                      | Yes                                            | Yes       | UI dialog behavior + paged listing + source adapter metadata              | Real native UI browse against a real ingested HVSC store                               |
| 6. Song selection and add-to-playlist               | `playwright/hvsc.spec.ts`, `tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts`                                                                                                                                                                           | Yes                                            | Yes       | UI flow + handler-level playlist item construction                        | Real device execution of the same source-picker path                                   |
| 7. Playlist persistence and reload                  | `playwright/hvsc.spec.ts`, `tests/unit/playFiles/usePlaybackPersistence.test.tsx`                                                                                                                                                                                           | Yes                                            | Yes       | UI persistence/reload + repository/session hydration                      | Real-device persistence after a native HVSC browse/import session                      |
| 8. Playback request routing                         | `playwright/hvsc.spec.ts`, `tests/unit/playFiles/usePlaybackController.test.tsx`                                                                                                                                                                                            | Yes                                            | Yes       | Request payload generation + mocked C64U request observation              | Real C64U response and hardware-visible playback success                               |
| 9. Duration and subsong preservation                | `tests/unit/sourceNavigation/hvscSourceAdapter.test.ts`, `tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts`, `tests/unit/playFiles/usePlaybackController.test.tsx`, `tests/unit/playFiles/usePlaybackPersistence.test.tsx`                              | Yes                                            | Yes       | Metadata-preservation assertions across browse/import/play/persist layers | Real end-to-end confirmation that the same preserved metadata drives hardware playback |
| 10. Observable playback success                     | `playwright/hvsc.spec.ts` for mocked request shape only; `c64scope/src/validation/cases/playback.ts` for oracle definition only                                                                                                                                             | Partially                                      | Partially | Mocked UI/request shape; authoritative A/V threshold definition           | Real app-first HVSC playback on a real Pixel 4 and a real C64U remains HIL-only        |

## Coverage Summary

The combined automated suite now honestly covers these workflow stages:

- download request and mocked completion
- ingest progress and native ingest contract
- query-backed browse
- add-to-playlist
- playlist persistence and reload
- playback request generation
- duration and subsong preservation

The automated suite still does not prove these on its own:

- real Android archive download and ingest completion through the app UI
- real app-first HVSC playback on a C64U
- streamed-audio success from the C64U during that playback window

## HIL Status

Dedicated c64scope product-track cases now exist for the missing app-first HVSC path:

- `AF-HVSC-DOWNLOAD-PLAY-001`
- `AF-HVSC-CACHE-PLAY-001`

These cases are bounded by explicit time budgets and use:

- UI progression and current-track confirmation
- case timeline metadata plus logcat capture
- C64U audio capture with `packetCount > 0` and `RMS >= 0.005`

They are still unexecuted in this document until a real Pixel 4 plus real C64U run is performed.

## Still Lacking Honest Proof

- The real HIL runs must still be executed and archived under `docs/plans/hvsc/artifacts/`.
- The physical-device matrix previously accepted ingest-only evidence; that is now corrected below, but the corrected gate still needs a passing run.
- The repo does not yet contain a 60,000-entry HVSC-specific end-to-end proof. The closest current automated scalability evidence is `tests/unit/lib/playlistRepository/localStorageRepository.test.ts`, which proves deterministic paging on a 2,000-item playlist and deterministic shuffle session persistence, not a 60,000-entry HVSC playlist.
