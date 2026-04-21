# Feature Model

## Purpose

This schema defines the canonical feature record the downstream review must use. Every discovered feature in the repository must normalize to this shape. `REVIEW_PROMPT.md` references this file as the authoritative schema.

## Deterministic ID Rule

Every feature ID must follow this rule:

`<scope>__<feature_slug>`

Rules:

- `scope` is the primary owning surface in lowercase snake case.
- Allowed `scope` values:
  - `app`
  - `home`
  - `play`
  - `disks`
  - `config`
  - `settings`
  - `docs`
  - `diagnostics`
  - `licenses`
  - `coverage_probe`
  - `not_found`
  - `android_native`
  - `ios_native`
  - `web_runtime`
  - `shared`
- `feature_slug` is a lowercase snake case capability name derived from the narrowest distinct user-visible or system-visible behavior.
- IDs must be stable. Do not use sequence numbers.
- If two candidate features would generate the same ID, split them at the next lower behavioral level and regenerate distinct slugs.

Examples:

- `home__machine_controls`
- `play__hvsc_lifecycle`
- `diagnostics__saved_device_switching`
- `settings__online_archive_overrides`

## Required Fields

| Field | Type | Required | Allowed Values / Shape | Constraints |
| --- | --- | --- | --- | --- |
| `feature_id` | string | yes | `scope__feature_slug` | Must follow the deterministic ID rule exactly. |
| `name` | string | yes | free text | Use a concise capability label, not a filename. |
| `description` | string | yes | free text | Must describe the user-visible or system-visible behavior in one to three sentences. |
| `feature_type` | enum | yes | `route`, `section`, `workflow`, `dialog`, `overlay`, `background`, `hidden_route`, `native_bridge`, `service`, `support_surface` | Choose the narrowest applicable type. |
| `parent_feature_id` | string or `null` | yes | existing `feature_id` or `null` | Use `null` only for top-level features. |
| `entry_points` | array | yes | array of `EntryPoint` | Must contain at least one entry point. |
| `implementation_refs` | array | yes | array of `ImplementationRef` | Must contain at least one code reference. |
| `documentation_refs` | array | yes | array of repo-relative paths | Use `[]` when no docs exist. |
| `screenshot_refs` | array | yes | array of repo-relative paths under `docs/img/app/` | Use `[]` when no screenshot exists. |
| `dependencies` | object | yes | `DependencyModel` | Must classify hardware, network, storage, native, and external-service dependencies explicitly. |
| `platform_scope` | object | yes | `PlatformScope` | Must include `android`, `ios`, and `web`. |
| `state_model` | object or `null` | yes | `StateModel` or `null` | Use `null` only when the feature is stateless. |
| `test_coverage` | object | yes | `CoverageModel` | Must include all test families, including separate HIL targets. |
| `risk_tags` | array | yes | array of `RiskTag` | Use `[]` only when the feature is demonstrably low risk and read-only. |
| `observability` | array | yes | array of `ObservabilitySignal` | Must list the signals that can prove the feature outcome. |
| `notes` | array | yes | array of strings | Use `[]` when no extra notes are needed. |

## Nested Types

### `EntryPoint`

| Field | Type | Required | Allowed Values / Shape | Constraints |
| --- | --- | --- | --- | --- |
| `kind` | enum | yes | `ui`, `route`, `deep_link`, `startup`, `background`, `setting`, `gesture`, `api`, `test_only` | Choose the actual trigger mode. |
| `path_or_selector` | string | yes | route, selector, control label, or trigger description | Must be specific enough for another reviewer to find it. |
| `preconditions` | array | yes | array of strings | Use `[]` only when no preconditions exist. |

### `ImplementationRef`

| Field | Type | Required | Allowed Values / Shape | Constraints |
| --- | --- | --- | --- | --- |
| `path` | string | yes | repo-relative file path | Must point to an existing file. |
| `symbol_or_region` | string | yes | exported symbol, component name, hook name, or descriptive region | Must identify the owning code location. |
| `role` | enum | yes | `entry`, `ui`, `state`, `transport`, `native`, `persistence`, `diagnostics`, `test_support` | Use the narrowest actual role. |

### `DependencyModel`

| Field | Type | Required | Allowed Values / Shape | Constraints |
| --- | --- | --- | --- | --- |
| `hardware` | array | yes | `android_device`, `ios_device`, `u64`, `c64u`, `none`, `optional` | Use concrete runtime targets where required. |
| `network` | array | yes | `rest`, `ftp`, `telnet`, `web_server`, `internet`, `none` | Include every transport the feature relies on. |
| `storage` | array | yes | `local_storage`, `session_storage`, `indexeddb`, `saf`, `native_fs`, `secure_storage`, `none` | Include all applicable persistence layers. |
| `native` | array | yes | `android_plugin`, `ios_plugin`, `capacitor_bridge`, `background_service`, `none` | Use `none` only if the feature is pure web TypeScript. |
| `external_services` | array | yes | free-text service identifiers | Use `[]` when none apply. |

### `PlatformScope`

Each platform field must use one of:

- `primary`
- `secondary`
- `supported`
- `limited`
- `unsupported`
- `not_applicable`

Fields:

- `android`
- `ios`
- `web`

Constraints:

- At least one platform must be `primary`, `secondary`, or `supported`.
- Android should usually be `primary` or `supported`.
- If runtime behavior differs materially by platform, the difference must be explained in `notes`.

### `StateModel`

| Field | Type | Required | Allowed Values / Shape | Constraints |
| --- | --- | --- | --- | --- |
| `stateful` | boolean | yes | `true` or `false` | If `false`, `states` and `transitions` must be empty arrays. |
| `states` | array | yes | array of strings | Use canonical state labels only. |
| `transitions` | array | yes | array of strings | Describe the allowed transition edges. |
| `failure_modes` | array | yes | array of strings | Include known negative states and transition failures. |

### `CoverageModel`

Each family must include:

- `status`
- `evidence`
- `gaps`

Allowed `status` values:

- `present`
- `weak`
- `absent`
- `not_applicable`

Families:

- `unit`
- `integration`
- `playwright`
- `maestro`
- `hil_pixel4`
- `hil_u64`
- `hil_c64u`

Constraints:

- `evidence` is an array of repo-relative file paths, test IDs, or evidence artifact paths.
- `gaps` is an array of explicit missing scenarios. Do not use generic placeholders.
- If a family is `not_applicable`, explain why in `gaps` or `notes`.

### `RiskTag`

Allowed values:

- `correctness`
- `performance`
- `reliability`
- `state_consistency`
- `concurrency`
- `device_interaction`
- `cross_platform`
- `security`
- `observability`
- `persistence`

### `ObservabilitySignal`

Allowed values:

- `ui`
- `toast`
- `screenshot`
- `video`
- `log`
- `trace`
- `diagnostics_overlay`
- `rest_response`
- `ftp_result`
- `telnet_result`
- `storage_state`
- `filesystem_state`
- `audio_signal`
- `device_state`

## Feature Splitting Rules

Split into separate features when any of the following is true:

- The entry point differs.
- The state model differs.
- The platform behavior differs materially.
- The dependency set differs materially.
- The test evidence differs materially.
- The failure modes differ materially.

Merge only when all of the following are true:

- The user goal is the same.
- The entry point is the same.
- The implementation owner is the same.
- The state transitions are the same.
- The test evidence set is the same.

## Example Feature Instance

```yaml
feature_id: play__hvsc_lifecycle
name: HVSC download and ingest lifecycle
description: >
  Enables HVSC download, extraction, ingestion, cancellation, reset, and
  subsequent browse availability from the Play surface.
feature_type: workflow
parent_feature_id: play__source_browsing
entry_points:
  - kind: ui
    path_or_selector: "Play > HVSC card"
    preconditions:
      - "HVSC is enabled in Settings"
  - kind: setting
    path_or_selector: "Settings > HVSC > Enable HVSC downloads"
    preconditions: []
implementation_refs:
  - path: src/pages/PlayFilesPage.tsx
    symbol_or_region: HvscPreparationSheet and HVSC controls wiring
    role: ui
  - path: src/pages/playFiles/hooks/useHvscLibrary.ts
    symbol_or_region: useHvscLibrary
    role: state
  - path: src/lib/hvsc/hvscIngestionRuntime.ts
    symbol_or_region: resolveHvscIngestionMode
    role: transport
  - path: android/app/src/main/java/uk/gleissner/c64commander/HvscIngestionPlugin.kt
    symbol_or_region: HvscIngestionPlugin
    role: native
documentation_refs:
  - README.md
  - docs/features-by-page.md
  - docs/testing/physical-device-matrix.md
screenshot_refs:
  - docs/img/app/play/import/06-hvsc-preparing.png
  - docs/img/app/play/import/07-hvsc-ready.png
  - docs/img/app/play/import/08-hvsc-browser.png
dependencies:
  hardware:
    - none
  network:
    - internet
  storage:
    - indexeddb
    - native_fs
  native:
    - capacitor_bridge
    - android_plugin
  external_services:
    - hvsc_mirror
platform_scope:
  android: primary
  ios: limited
  web: limited
state_model:
  stateful: true
  states:
    - disabled
    - ready_to_download
    - downloading
    - extracted
    - ingesting
    - ready_to_browse
    - cancelled
    - failed
  transitions:
    - disabled -> ready_to_download
    - ready_to_download -> downloading
    - downloading -> extracted
    - extracted -> ingesting
    - ingesting -> ready_to_browse
    - downloading -> cancelled
    - downloading -> failed
    - ingesting -> failed
  failure_modes:
    - low_memory_abort
    - archive_download_failure
    - extraction_failure
    - index_build_failure
test_coverage:
  unit:
    status: present
    evidence:
      - tests/unit/hvscProgress.test.ts
    gaps:
      - reset-path edge cases are not fully demonstrated here
  integration:
    status: present
    evidence:
      - android/app/src/test/java/uk/gleissner/c64commander/HvscArchiveExtractorTest.kt
      - android/app/src/test/java/uk/gleissner/c64commander/HvscRealArchiveExtractionTest.kt
    gaps: []
  playwright:
    status: present
    evidence:
      - playwright/hvsc.spec.ts
      - playwright/hvscPerf.spec.ts
    gaps: []
  maestro:
    status: present
    evidence:
      - .maestro/smoke-hvsc.yaml
      - .maestro/edge-hvsc-ingest-lifecycle.yaml
    gaps: []
  hil_pixel4:
    status: weak
    evidence:
      - docs/testing/physical-device-matrix.md
    gaps:
      - direct Pixel 4 evidence artifact path must be confirmed
  hil_u64:
    status: absent
    evidence: []
    gaps:
      - no explicit U64-backed HVSC lifecycle evidence found
  hil_c64u:
    status: weak
    evidence:
      - docs/testing/physical-device-matrix.md
    gaps:
      - artifact-level proof must be confirmed per run
risk_tags:
  - correctness
  - performance
  - reliability
  - state_consistency
  - device_interaction
  - cross_platform
observability:
  - ui
  - screenshot
  - log
  - trace
  - filesystem_state
notes:
  - Android may use a native HVSC ingestion plugin; iOS and web may fall back to TypeScript paths.
```
