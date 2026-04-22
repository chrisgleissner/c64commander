# Variant System Implementation Prompt

Date: 2026-04-22
Type: Strict execution prompt
Primary inputs:

- [variant-spec.md](./variant-spec.md)
- [plan.md](./plan.md)

Expected change classification: `DOC_PLUS_CODE`, `UI_CHANGE`

## Role

You are the implementation engineer responsible for landing the variant system end to end in the current repository.

This is not a research pass.
This is not a brainstorming pass.
This is not a partial scaffolding pass.

You must implement the repository-grounded variant system described in [variant-spec.md](./variant-spec.md) by following the sequence in [plan.md](./plan.md), then validate the result honestly.

## Objective

Implement a maintainable variant system for C64 Commander so:

- one codebase can define multiple variants
- one repository can publish one or many of them
- this repository defaults to publishing only `c64commander`
- internal Android/iOS/source identifiers remain stable
- user-visible outputs consistently reflect the selected variant
- feature-flag defaults can differ by variant

The implementation must optimize for maintainability and determinism, not for maximal native-project renaming.

## Authoritative Inputs

Read these before editing:

- `README.md`
- `.github/copilot-instructions.md`
- `docs/ux-guidelines.md`
- [variant-spec.md](./variant-spec.md)
- [plan.md](./plan.md)

Then read the smallest relevant set of implementation files in:

- `src/lib/config/`
- `src/generated/` if created during the work
- `scripts/`
- `public/`
- `web/server/src/`
- `android/app/`
- `ios/App/App/`
- `.github/workflows/`
- helper scripts that currently assume one app id, one image name, or one artifact basename

## Non-Negotiable Rules

1. The behavior in [variant-spec.md](./variant-spec.md) is the source of truth.
2. The sequence in [plan.md](./plan.md) is the source of truth for implementation order.
3. Do not rename Android source namespaces, iOS project structure, or internal source directories as part of this work.
4. Do not make variant identity runtime-switchable after packaging.
5. Do not use environment variables as the source of truth for variant metadata.
6. Do not create a second independent feature-flag registry.
7. Do not leave user-visible names, exported filenames, manifest fields, login branding, or release artifact names hard-coded once generated variant data exists.
8. Do not silently swallow exceptions.
9. Every bug fix or regression discovered during implementation must get a dedicated regression test.
10. Do not claim tests, builds, or screenshot updates you did not actually run.
11. Keep this repository’s default publish behavior as `c64commander` only unless explicit multi-variant publication is requested.
12. The generator must be schema-version-aware: read `schema_version` from `variants/variants.yaml` before processing and fail explicitly if the version is unsupported or absent.
13. Three endpoints are confirmed variant-sensitive (`device_host`, `hvsc_base_url`, `commoserve_base_url`); expose their values from `src/generated/variant.ts` and consume them from there, not from scattered source constants. Do not add additional endpoint keys without a new targeted audit confirming variant sensitivity.
14. Validate uniqueness of `app_id`, `application_id`, `bundle_id`, and `custom_url_scheme` across all declared variants in the generator and in CI; treat any collision as a hard failure.
15. `localStorage`, `sessionStorage`, and service worker cache names must use variant-derived prefixes in all web surfaces; do not leave these as single-brand constants once variant data exists.
16. The generator must enforce all invariants from VARIANT-SCHEMA-004 and VARIANT-SCHEMA-005 during both generation and check mode; CI must fail on any violation.

## Required End State

Your implementation is only complete when all of the following are true:

- variant data is authored once under `variants/`
- the repository can select one declared variant at build time
- the generator can materialize deterministic generated outputs for that variant
- a generated runtime module exposes the selected variant to shared runtime code
- the existing feature-flag registry is resolved through variant-specific defaults
- web-visible metadata and branding follow the selected variant
- Android install identity and user-visible branding follow the selected variant
- iOS install identity and user-visible branding follow the selected variant
- this repository still defaults to publishing only `c64commander`
- release workflows can intentionally publish multiple variants when explicitly configured
- internal source/native layout remains stable
- tests and helper tooling no longer assume one single hard-coded user-visible brand where that assumption is no longer valid
- `variants/variants.yaml` declares `schema_version` and the generator validates it
- the generator fails on unsupported `schema_version` values
- uniqueness of `app_id`, `application_id`, `bundle_id`, and `custom_url_scheme` is validated by the generator and enforced in CI
- `localStorage`, `sessionStorage`, and service worker cache names use variant-derived prefixes
- `runtime.endpoints` values (`device_host`, `hvsc_base_url`, `commoserve_base_url`) are exposed by `src/generated/variant.ts` and runtime code consumes them from there
- no additional endpoint keys are added to `runtime.endpoints` without a new targeted audit confirming variant sensitivity

## Required Architecture Outcome

The shipped design must preserve these architectural constraints:

- Android source namespace may remain `uk.gleissner.c64commander`
- iOS project and source structure may remain unchanged
- internal implementation names may continue using `c64commander`
- feature flags continue using `src/lib/config/feature-flags.yaml` as the canonical feature catalog
- variant overlays may change defaults and supported visibility policy only for existing feature ids
- repo publish defaults are declared in canonical variant data, not scattered across workflows

## Required Generated Surfaces

The implementation must introduce a deterministic generation path that covers at least:

- `src/generated/variant.ts`
- variant-resolved feature-flag data
- web metadata and icon outputs
- Android resource and install metadata inputs
- iOS metadata and asset inputs
- release/publish metadata required by scripts or workflows

The generator must support:

- selecting a declared variant
- validation failure on invalid schema or missing assets
- check mode that detects generated-output drift

## Execution Model

Implement in the phases defined in [plan.md](./plan.md).

Minimum expected order:

1. canonical variant data model
2. deterministic generator and runtime module
3. variant-specific feature-flag defaults
4. web branding and runtime isolation
5. Android and iOS integration
6. release workflows and publish-set control
7. test and helper-tool convergence
8. validation and documentation closure

Do not start workflow and release rewiring before the canonical data model and generator are stable.

## Required Validation

Because this task changes executable behavior, the final validation must include:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Also run the smallest honest targeted validation needed to prove:

- selecting `c64commander` generates the expected default surfaces
- selecting `c64u-controller` generates distinct user-visible surfaces
- the feature-flag defaults differ per variant where configured
- this repo still defaults to publishing only `c64commander`
- explicit multi-variant publish selection works through the chosen implementation path

If visible documented UI changes, refresh only the affected screenshots under `docs/img/`.

## Output Requirements

At completion, report:

- what changed
- which phases from [plan.md](./plan.md) were completed
- which tests and builds were run
- whether screenshots were updated
- any remaining known risk or follow-up item

## Failure Rules

Stop and report a blocker instead of guessing if:

- the current repo structure prevents deterministic generation without a deeper architectural decision
- iOS or Android metadata generation cannot be integrated without contradicting the “keep internal structure stable” rule
- publish-set control cannot be expressed cleanly in the current workflow model without a product or release-policy decision
- variant-specific feature defaults require changes to the feature registry semantics beyond what [variant-spec.md](./variant-spec.md) allows
