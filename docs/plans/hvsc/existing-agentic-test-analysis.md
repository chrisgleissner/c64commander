# Existing HVSC Agentic Test Analysis

## Purpose

This note captures what the current repo already proves about the HVSC workflow and what remains unproven. It is intentionally scoped to the remaining work after the main HVSC convergence pass.

## Executive Summary

- The current agentic stack proves HVSC install and ingest lifecycle behavior and cache-reuse behavior, but it does not yet prove the full app-first chain from HVSC download to ingest to add-to-playlist to playback with streamed-audio correlation.
- Existing PASS markers for agentic HVSC coverage are too optimistic for the remaining acceptance gate. The deeper gap analysis still marks playlist generation from downloaded HVSC content and end-to-end downloaded-HVSC playback as blocked.
- The current physical-device validation matrix only requires ingest completion. It does not require app-driven HVSC playlist import or C64U streamed-audio proof.
- The current prompts and flows do not contain a strict enough non-hanging execution policy for slow terminal commands, log capture, or long-running HIL waits.

## Existing Agentic Assets

### F015 and F016 Prompt Coverage

- `docs/testing/agentic-tests/full-app-coverage/prompts/F015-hvsc-download-ingest.md`
  - Proves: app-first HVSC download/install/ingest/cancel/reset lifecycle with screenshots and step metadata.
  - Does not prove: add-to-playlist, playlist persistence, metadata preservation, playback routing, or C64U streamed-audio output.
- `docs/testing/agentic-tests/full-app-coverage/prompts/F016-hvsc-cache-reuse.md`
  - Proves: cache detection, re-ingest from cache, and cached-content browsing.
  - Does not prove: explicit no-redownload evidence, playlist import, playback correlation, or audio-stream verification.

### Agentic Planning and Oracle Docs

- `docs/testing/agentic-tests/agentic-coverage-matrix.md`
  - Marks Play HVSC lifecycle as `Guarded`, long-running, and dependent on UI plus filesystem plus diagnostics.
- `docs/testing/agentic-tests/agentic-infrastructure-reuse.md`
  - Correctly classifies Playwright as web-only prior art, Maestro as native-flow prior art, and Android JVM tests as native contract prior art.
  - Explicitly says `.maestro/smoke-hvsc.yaml` and `.maestro/edge-hvsc-ingest-lifecycle.yaml` are only flow seeds, not full artifact correlation.
- `docs/testing/agentic-tests/agentic-oracle-catalog.md`
  - Correctly requires UI plus incremental progress plus filesystem or ingestion-stat evidence for HVSC lifecycle.
  - Also states that A/V is mandatory when the user-visible requirement is actually audiovisual.

### Gap Analysis Already in the Repo

- `docs/testing/agentic-tests/gap-analysis/research1/coverage-matrix.md`
  - `HVSC download/install/ingest`: `Partial`
  - `HVSC cache reuse after download`: `Partial`
  - `Playlist generation from downloaded HVSC songs`: `Blocked`
  - `End-to-end playback for downloaded/cached HVSC content`: `Blocked`
- This file is the clearest evidence that the current agentic PASS stories stop too early.

### Web and Native Prior Art

- `playwright/hvsc.spec.ts`
  - Strong prior art for status transitions, progress UI, browse-to-play flow shape, and mock-server request assertions.
  - Limit: still web-only and mock-driven. It does not prove the Android plugin or real archive path.
- `.maestro/smoke-hvsc.yaml`
  - Thin smoke for HVSC controls and basic browsing.
- `.maestro/edge-hvsc-ingest-lifecycle.yaml`
  - Useful stage-sequence prior art for install and ingest.
- `.maestro/edge-hvsc-repeat-cancel-resume.yaml`
  - Useful cancel and restart prior art.
- None of the Maestro flows currently prove download -> ingest -> add to playlist -> playback -> streamed audio.

### Android-Native Contract Evidence

- `android/app/src/test/java/uk/gleissner/c64commander/HvscIngestionPluginTest.kt`
  - Native contract prior art for ingestion payloads, cancel behavior, and failure classification.
- `android/app/src/test/java/uk/gleissner/c64commander/HvscSevenZipRuntimeTest.kt`
  - Native runtime prior art for the actual archive path.
- These are necessary to prove the plugin path, but they do not prove the app UI browse/import/play chain.

### JS/TS Regression Coverage Relevant to the Remaining Gap

- `tests/unit/sourceNavigation/hvscSourceAdapter.test.ts`
  - Source-navigation contract and metadata preservation.
- `tests/unit/components/itemSelection/ItemSelectionDialog.test.tsx`
  - Dialog behavior and query-backed browsing expectations.
- `tests/unit/pages/playFiles/handlers/addFileSelectionsArchive.test.ts`
  - HVSC import into playlist item construction.
- `tests/unit/playFiles/usePlaybackController.test.tsx`
  - Playback routing and duration/subsong behavior.
- `tests/unit/playFiles/usePlaybackPersistence.test.tsx`
  - Persistence and reload of playlist metadata.
- `tests/unit/hvsc/hvscBrowseIndexStore.test.ts`
  - Paged/scoped HVSC folder listing behavior.

### HIL Evidence Stack

- `c64scope/src/hilEvidenceRun.ts`
  - Provides artifact gating, stream-control helpers, and bounded retry helpers.
- `c64scope/src/validation/cases/playback.ts`
  - Already contains UDP audio/video capture and the current non-silent audio threshold: packet count greater than zero and RMS at least `0.005`.
- This is the correct evidence stack for playback, but the existing agentic HVSC prompts do not require it for downloaded-HVSC playback.

### Physical-Device Release Evidence

- `docs/testing/physical-device-matrix.md`
  - Requires HVSC ingest evidence, but not playlist import or audio-stream playback proof.

## Main Contradictions to Resolve

1. `F015` and `F016` are recorded as PASS, but the gap-analysis matrix still marks playlist-generation and downloaded-HVSC playback as blocked.
2. Playwright claims a browse-to-play flow, but it is still mock/web-only and cannot stand in for native Android or real HIL proof.
3. Maestro proves native sequence shape, but not full artifact correlation and not C64U streamed-audio success.
4. The physical-device matrix still under-specifies the actual HVSC playback acceptance gate.

## Remaining Proof Gaps

1. A single prompt that explicitly spans cold download, cache reuse, playlist import, playlist persistence, playback request, and streamed-audio verification.
2. A local and CI-safe workflow coverage map that shows exactly which automated tests cover each stage of the HVSC chain.
3. An app-first HIL case that proves the selected HVSC track is the one whose streamed audio was analyzed.
4. A bounded-execution policy that prevents the next LLM from hanging on slow commands, long waits, or open-ended log capture.
5. A large-playlist proof path for at least 60,000 entries, including shuffle and playback from that playlist.

## What the Next Prompt Must Reuse

- Reuse `playwright/hvsc.spec.ts` as web prior art, not as native proof.
- Reuse `.maestro/edge-hvsc-ingest-lifecycle.yaml` and `.maestro/edge-hvsc-repeat-cancel-resume.yaml` as deterministic flow seeds, not as complete verdicts.
- Reuse `HvscIngestionPluginTest.kt` and `HvscSevenZipRuntimeTest.kt` for native archive and ingestion contract evidence.
- Reuse the existing JS/TS regression suites for source-adapter, add-items, playback, persistence, and browse-index coverage.
- Reuse `c64scope/src/validation/cases/playback.ts` for the authoritative audio-stream threshold and artifact shape.

## Bottom Line

The remaining work is no longer "make HVSC exist." The remaining work is "prove, with bounded automation and HIL evidence, that the entire HVSC workflow is covered end to end and that the proof cannot hang indefinitely when commands or devices are slow."
