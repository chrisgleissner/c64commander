# Variant System Multi-Phase Plan

Date: 2026-04-22
Status: Ready for execution
Primary spec: [variant-spec.md](./variant-spec.md)
Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## 1. Objective

Implement the repository-grounded variant system defined in [variant-spec.md](./variant-spec.md) so one codebase can define multiple variants, one repository can publish one or many of them, and the current repository defaults to publishing only `c64commander`.

The shipped end state must include:

- one canonical variant definition under `variants/`
- one deterministic variant generator
- one generated runtime variant module
- variant-specific feature-flag defaults layered on top of the existing feature registry
- variant-driven web, Android, iOS, and release metadata
- explicit per-repo default publish sets
- stable internal Android/iOS/source identifiers
- user-visible outputs that consistently reflect the selected variant

## 2. Execution Rules

- [variant-spec.md](./variant-spec.md) is authoritative for behavior and scope.
- This plan is authoritative for sequencing.
- Do not widen scope into a full native-project rename.
- Do not rename Android source namespaces, iOS project structure, or internal source directories as part of this work.
- Do not make variant identity runtime-switchable after packaging.
- Do not use environment variables as the source of truth for variant metadata. Environment variables may select a declared variant only.
- Do not leave user-visible names, icons, exported filenames, or release artifact names hard-coded once a generated variant surface exists.
- Do not create a second independent feature-flag registry. Reuse `src/lib/config/feature-flags.yaml` as the canonical feature catalog.
- Every bug or regression found during implementation must get a targeted regression test.
- Final validation must include `npm run test:coverage` with global branch coverage `>= 91%`.
- The endpoint audit is pre-resolved: `device_host`, `hvsc_base_url`, and `commoserve_base_url` are confirmed variant-sensitive; their schema block is defined in VARIANT-SCHEMA-006. Do not add additional endpoint keys without a new targeted audit.
- Schema evolution validation is mandatory: generator must read and validate `schema_version` before any output is produced; CI must fail on an absent or unsupported version.
- Identifier uniqueness validation is a blocking CI check: `app_id`, `application_id`, `bundle_id`, and `custom_url_scheme` must be validated across all declared variants; CI must fail on any collision.

## 3. Impact Map

### Canonical variant data and generation

- new `variants/` tree
- `scripts/generate-variant.mjs`
- generated outputs under:
  - `src/generated/`
  - web/public/native resource destinations

### Feature-flag integration

- `src/lib/config/feature-flags.yaml`
- `scripts/compile-feature-flags.mjs`
- `src/lib/config/featureFlags.ts`
- generated feature-registry output

### Shared runtime and build surfaces

- `capacitor.config.ts`
- `package.json`
- `build`
- `src/lib/buildInfo.ts`
- `src/lib/versionLabel.ts`
- `src/lib/buildVersion.ts`

### Web surfaces

- `index.html`
- `public/manifest.webmanifest`
- `public/sw.js`
- variant-generated icon files under `public/`
- `web/server/src/staticAssets.ts`
- any runtime UI that still hard-codes branded assets or strings

### Android surfaces

- `android/app/build.gradle`
- `android/app/src/main/res/values/strings.xml`
- `android/app/src/main/res/mipmap-*`
- `android/app/src/main/res/drawable*`

### iOS surfaces

- `ios/App/App/Info.plist`
- `ios/App/App.xcodeproj/project.pbxproj`
- `ios/App/App/Assets.xcassets/**`

### Release and workflow surfaces

- `.github/workflows/android.yaml`
- `.github/workflows/ios.yaml`
- `.github/workflows/web.yaml`
- helper scripts that currently assume one app id, one image name, or one artifact basename

### Validation surfaces

- unit tests for variant schema and generator
- unit tests for variant-aware feature-flag compilation
- tests that currently hard-code `uk.gleissner.c64commander`, `c64commander-*`, or single-brand expectations
- screenshot surfaces only if visible UI branding changes in documented screenshots

## 4. Phase Summary

| Phase | Goal | Blocking output |
| --- | --- | --- |
| 0 | Confirm exact impact map and invariants | touched surfaces and migration boundaries are explicit |
| 1 | Land canonical variant data model | `variants/` becomes the single source of truth |
| 2 | Land deterministic generator and runtime module | one selected variant can drive generated outputs |
| 3 | Integrate variant-specific feature-flag defaults | feature defaults resolve per variant without a second registry |
| 4 | Integrate web branding and runtime isolation | web shell, login, icons, and cache/storage prefixes are variant-driven |
| 5 | Integrate Android and iOS metadata/assets | install identity and native-visible branding become variant-driven |
| 6 | Integrate release workflows and publish-set control | repo defaults to `c64commander`, multi-variant publishing works explicitly |
| 7 | Converge tests and helper tooling | tests and smoke/CI tooling stop assuming one single hard-coded brand |
| 8 | Validate, refresh docs if needed, and close | repo is green and variant docs remain accurate |

## 5. Detailed Phases

### Phase 0. Discovery, endpoint audit, and final impact map

Goal:

- confirm every currently hard-coded variant seam before editing
- review the pre-resolved endpoint audit in VARIANT-SCHEMA-006 as part of discovery

Read first:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [variant-spec.md](./variant-spec.md)
- the files listed in section 3 of this plan

Endpoint audit (pre-resolved):

The following endpoints have been audited and confirmed variant-sensitive:

- `device_host` — `DEFAULT_DEVICE_HOST = "c64u"` in `src/lib/c64api/hostConfig.ts`
- `hvsc_base_url` — `DEFAULT_BASE_URL = "https://hvsc.brona.dk/HVSC/"` in `src/lib/hvsc/hvscReleaseService.ts`
- `commoserve_base_url` — `baseUrl: "http://commoserve.files.commodore.net"` in `src/lib/archive/config.ts`

These three keys are the only permitted keys in `runtime.endpoints`. Any additional key requires a new targeted audit before being added to the schema.

Deliverables:

- explicit note that this implementation is `DOC_PLUS_CODE` and likely `UI_CHANGE`
- explicit list of files where user-visible identity must change
- explicit list of files where internal identifiers must remain stable
- explicit list of tests and helper scripts that currently assume one app id or one artifact basename
Exit criteria:

- the implementation path is narrow enough to avoid speculative refactors
- the endpoint audit is recorded; all three endpoints are confirmed variant-sensitive and covered by VARIANT-SCHEMA-006

### Phase 1. Canonical variant data model

Goal:

- make `variants/` the only authored variant-definition root

Implementation targets:

- add `variants/variants.yaml` with `schema_version: 1`
- add `variants/feature-flags/<variant>.yaml` for the initial variants
- add asset directory conventions under `variants/assets/<variant>/...`
- define and validate:
  - variant ids
  - app ids
  - install identifiers
  - repo default publish sets
  - required asset references
  - `schema_version` (REQUIRED field)

Required tests:

- schema validation tests
- duplicate-id failure tests (covering `app_id`, `application_id`, `bundle_id`, `custom_url_scheme`)
- invalid publish-default reference tests
- missing-asset failure tests
- absent or unsupported `schema_version` failure tests
- schema evolution: tests that verify the generator fails on a future unsupported `schema_version`

Exit criteria:

- the repository has one authored variant model and no competing authored source of truth for the same data
- `schema_version` is declared and validated

### Phase 2. Generator and generated runtime module

Goal:

- generate deterministic outputs from one selected variant

Implementation targets:

- add `scripts/generate-variant.mjs`
- add `--variant <id>` support
- add `--check` mode
- the generator MUST, as its first step, read and validate `schema_version` and fail with an explicit error if it is absent or exceeds the supported maximum
- the generator MUST validate uniqueness of `app_id`, `application_id`, `bundle_id`, and `custom_url_scheme` across all declared variants before producing any output
- generate:
  - `src/generated/variant.ts` — must include all declared `runtime.endpoints` values (`device_host`, `hvsc_base_url`, `commoserve_base_url`)
  - generated web metadata inputs
  - generated Android resource inputs
  - generated iOS metadata/resource inputs
  - generated release/publish metadata if needed
- wire the generator to run before:
  - feature-flag compilation when applicable
  - `cap sync`
  - build steps

Required tests:

- generator happy-path tests
- check-mode drift detection tests
- deterministic output tests
- schema version validation: absent, current, and unsupported-future version cases
- identifier uniqueness: collision detection for each of `app_id`, `application_id`, `bundle_id`, `custom_url_scheme`

Exit criteria:

- one command can select a declared variant and fully materialize its generated surfaces
- the generator fails fast and explicitly on schema version or uniqueness violations

### Phase 3. Variant-specific feature-flag defaults

Goal:

- layer variant defaults onto the existing feature-flag registry without creating a second registry

Implementation targets:

- extend `scripts/compile-feature-flags.mjs` or compose it with the variant generator
- merge base registry data from `src/lib/config/feature-flags.yaml` with variant overlays from `variants/feature-flags/<variant>.yaml`
- allow only supported overrides:
  - `enabled`
  - `visible_to_user`
  - `developer_only`
- ensure generated runtime feature data is variant-resolved

Required tests:

- overlay validation tests
- unknown-feature failure tests
- disallowed-field override tests
- variant-specific default resolution tests

Exit criteria:

- switching the selected variant changes feature defaults through generated outputs, not through ad hoc code paths

### Phase 4. Web branding and runtime isolation

Goal:

- make the web shell and browser-visible metadata variant-driven

Implementation targets:

- generate or template:
  - `index.html`
  - `public/manifest.webmanifest`
  - `public/sw.js`
  - web icon outputs under `public/`
- update `web/server/src/staticAssets.ts` to use generated login branding
- replace remaining hard-coded branded asset references in runtime UI with generated variant data
- `localStorage` and `sessionStorage` keys MUST use variant-derived prefixes; these MUST come from the generated runtime module (`src/generated/variant.ts`), not from scattered ad hoc constants
- service worker cache names MUST be variant-derived

Required tests:

- generator tests for web metadata outputs
- tests covering variant-driven login branding if practical
- tests proving `localStorage` and `sessionStorage` prefixes are sourced from the generated variant module
- tests proving the service worker cache name is variant-derived
- tests that would detect a hard-coded single-brand storage prefix regression

Exit criteria:

- browser-visible shell identity follows the selected variant consistently
- `localStorage`, `sessionStorage`, and service worker cache names are unconditionally variant-derived, not contingent on origin collision

### Phase 5. Android and iOS integration

Goal:

- make install identity and native-visible branding variant-driven while keeping internal native structure stable

Implementation targets:

- Android:
  - generate or update `strings.xml`
  - drive `applicationId`
  - drive launcher and splash resources
  - drive output APK/AAB basenames
- iOS:
  - drive `CFBundleDisplayName`
  - drive `PRODUCT_BUNDLE_IDENTIFIER`
  - drive AppIcon and splash assets
- preserve:
  - Android source namespace
  - iOS project and source structure

Required tests:

- generator tests for native metadata outputs
- targeted assertions that internal namespace/project layout remains stable

Exit criteria:

- installable Android and iOS outputs present the selected variant without requiring full native-project renames

### Phase 6. Release workflows and publish-set control

Goal:

- make release generation aware of repo defaults and explicit multi-variant publication

Implementation targets:

- define repo default publish sets in canonical variant data
- update workflows and helper scripts so:
  - this repo defaults to publishing only `c64commander`
  - explicit multi-variant publication can be requested
  - artifact names and image names are variant-driven
- update build helpers that currently hard-code:
  - image names
  - container names
  - app ids
  - artifact basenames

Required tests:

- workflow/helper-script unit coverage where present
- targeted tests for publish-set validation logic if implemented in Node or shell-testable code

Exit criteria:

- the repository can intentionally publish one variant by default and multiple variants when explicitly configured

### Phase 7. Test and helper-tool convergence

Goal:

- stop the test suite and helper tooling from assuming one hard-coded brand

Implementation targets:

- update tests to source expectations from generated variant outputs where appropriate
- parameterize smoke/emulator/helper scripts that currently assume one app id or activity target
- keep tests specific when they intentionally validate `c64commander` as the default published variant
- ensure exported filename expectations are variant-driven where user-visible

Required tests:

- regression coverage for variant-aware helpers
- updated unit tests for any parameterized scripts or helpers

Exit criteria:

- test and tool expectations align with the selected variant model instead of fighting it

### Phase 8. Validation and documentation closure

Goal:

- close the implementation with honest validation and aligned docs

Implementation targets:

- update docs that describe release artifact names, Docker image names, or app identity if they changed
- refresh screenshots only if visible documented UI branding changed
- verify generated outputs are checked in or reproducible according to the chosen repository policy

Blocking CI checks that MUST pass before declaring completion:

- generator `--check` mode passes for `c64commander` variant (no drift)
- generator fails as expected on absent `schema_version`
- generator fails as expected on unsupported `schema_version`
- generator fails as expected on `app_id` collision
- generator fails as expected on `application_id` collision
- generator fails as expected on `bundle_id` collision
- generator fails as expected on `custom_url_scheme` collision
- `localStorage`, `sessionStorage`, and service worker cache names are variant-derived and sourced from the generated module

Required validation:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- targeted native validation as needed for touched layers

Exit criteria:

- code, tests, workflows, and docs all reflect the same variant model
- all blocking CI checks pass

## 6. Minimal Delivery Sequence

If the work must be split into smaller implementation passes, prefer this order:

1. Phase 0
2. Phase 1
3. Phase 2
4. Phase 3
5. Phase 4
6. Phase 5
7. Phase 6
8. Phase 7
9. Phase 8

Do not start release-workflow wiring before the canonical variant data, generator, and feature-flag overlay model are stable.

## 7. Completion Standard

This implementation is complete only when:

- variant data is authored once under `variants/`
- one selected variant drives generated outputs deterministically
- `c64commander` remains the default publish target for this repo
- multi-variant publication is explicitly possible
- feature defaults can differ by variant
- user-visible names and artifacts follow the selected variant
- internal source/native layout remains stable
- the repo passes the required validation set
- `schema_version` is declared and validated by the generator
- the generator fails explicitly on absent or unsupported `schema_version`
- uniqueness of `app_id`, `application_id`, `bundle_id`, and `custom_url_scheme` is validated by the generator and enforced in CI
- `localStorage`, `sessionStorage`, and service worker cache names are variant-derived and sourced from the generated module
- declared `runtime.endpoints` values are exposed by the generated module and runtime code consumes them from there
