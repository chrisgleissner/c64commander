# Agentic Infrastructure Reuse

## Purpose

This file maps existing repo test assets to reusable evidence and expectation patterns. Future implementation work must read this before adding new infrastructure.

## Reuse Rules

1. Reuse an existing suite's oracle or evidence shape before inventing a new one.
2. If trace semantics change, update golden traces instead of weakening assertions.
3. Treat Playwright as web-flow prior art, Maestro as native-flow prior art, and Android JVM tests as native contract prior art.

## Playwright Reuse

| Suites | Reuse value | Limits |
| --- | --- | --- |
| `playwright/connectionSimulation.spec.ts`, `playwright/demoMode.spec.ts`, `playwright/settingsConnection.spec.ts` | Discovery, demo-mode, connection indicator, and persistence expectations | Web-only runtime |
| `playwright/playback.spec.ts`, `playwright/playback.part2.spec.ts`, `playwright/playlistControls.spec.ts` | Playlist semantics, transport behavior, songlengths, multi-source flows, progression expectations | Web mocks, not physical A/V |
| `playwright/hvsc.spec.ts` | HVSC status transitions, progress expectations, error surfaces, browse-to-play flow | Web-only runtime and mocked download path |
| `playwright/diskManagement.spec.ts` | Mount/eject UX, drive-state expectations, delete wording, import hierarchy, mounted-state preservation | Web-only runtime |
| `playwright/audioMixer.spec.ts`, `playwright/configEditingBehavior.spec.ts`, `playwright/configVisibility.spec.ts` | Config edit invariants, Audio Mixer solo/reset behavior, demo/real visibility expectations | Does not prove hardware-visible effects |
| `playwright/homeConfigManagement.spec.ts`, `playwright/homeRamDumpFolder.spec.ts` | App config snapshot expectations and RAM-dump folder display behavior | Web-only persistence path |
| `playwright/settingsDiagnostics.spec.ts`, `playwright/diagnosticsActions.spec.ts`, `playwright/verifyUserTracing.spec.ts` | Diagnostics tabs, trace/action evidence, log-density expectations | Needs Android export/runtime corroboration |
| `playwright/coverageProbes.spec.ts` and golden traces under `playwright/fixtures/traces/golden` | Probe-health patterns and regression trace stewardship | Not product evidence by itself |

## Maestro Reuse

| Flows | Reuse value | Limits |
| --- | --- | --- |
| `.maestro/smoke-launch.yaml`, `.maestro/ios-smoke-launch.yaml` | Navigation shell and launch smoke path | Thin smoke only |
| `.maestro/smoke-playback.yaml`, `.maestro/ios-playback-basics.yaml` | Native playback affordances and baseline transport UI | Limited oracle depth |
| `.maestro/smoke-hvsc.yaml`, `.maestro/edge-hvsc-ingest-lifecycle.yaml`, `.maestro/ios-hvsc-browse.yaml` | HVSC native flow sequence, progress checkpoints, cancel/retry path seeds | Not full artifact correlation |
| `.maestro/smoke-background-execution.yaml`, `.maestro/edge-auto-advance-lock.yaml` | Android background and lock-screen flow knowledge | Needs richer logs and verdict rules |
| `.maestro/edge-playlist-manipulation.yaml` | Native add-items and playlist edit flow shape | No physical A/V proof |
| `.maestro/edge-config-persistence.yaml`, `.maestro/ios-config-persistence.yaml` | Settings/config persistence expectations across relaunch | Platform-specific selectors may differ |
| `.maestro/probe-health.yaml` | Lab bring-up and deterministic probe-health steps | Probe-only, not product coverage |
| iOS flows under `.maestro/ios-*.yaml` | Future controller-neutral parity targets for route and affordance coverage | iOS execution is out of scope now |

## Android JVM Reuse

| Tests | Reuse value |
| --- | --- |
| `BackgroundExecutionPluginTest.kt`, `BackgroundExecutionServiceTest.kt` | Background service lifecycle, due-at behavior, event payload assumptions |
| `DiagnosticsBridgePluginTest.kt` | Diagnostics broadcast payload and receiver behavior |
| `FolderPickerPluginTest.kt` | SAF read and error-path expectations |
| `FtpClientPluginTest.kt` | FTP listing, read, timeout, and trace-context behavior |
| `HvscIngestionPluginTest.kt` | Ingestion payloads, cancel behavior, and failure classification |
| `MockC64UPluginTest.kt`, `MockC64UServerTest.kt` | Native mock-server behavior and API assumptions |
| `SecureStoragePluginTest.kt` | Password persistence contract |

## What New Agentic Work Must Reuse

- Existing UI route expectations from Playwright.
- Existing native flow order from Maestro.
- Existing plugin failure semantics from Android JVM tests.
- Existing diagnostics and trace evidence formats already exported by the app.

## When New Infrastructure Is Justified

Add new infrastructure only when all of the following are true:

- no existing Playwright, Maestro, or JVM artifact already covers the same invariant
- the new infrastructure proves something impossible with the current evidence stack
- the new artifact shape is documented back into this file and `agentic-observability-model.md`
