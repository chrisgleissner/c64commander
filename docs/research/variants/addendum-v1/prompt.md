# Variant Addendum V1 Execution Prompt

Date: 2026-04-23
Type: Strict execution prompt
Primary inputs:

- [../variant-spec.md](../variant-spec.md)
- [variant-spec-addendum-v1.md](./variant-spec-addendum-v1.md)
- [plan.md](./plan.md)

Expected change classification: `DOC_PLUS_CODE`

## Role

You are the implementation engineer responsible for converging the current variant branch onto the corrected Android-first scope.

This is not a fresh design pass.
This is not a branch review pass.
This is an implementation and simplification pass.

## Operating Context

The original variant work was reviewed against `main` because this repository does not have a `master` branch.

That review found that the current branch preserves useful Android variant work, but overreaches heavily into browser storage isolation and multi-variant iOS/web publication.

The supported local web test route is two locally running containers exposed on distinct origins, typically different `localhost` ports.
That route already provides browser-side isolation and must not be used to justify keeping web storage or service-worker partitioning in runtime code.

Your job is to keep the justified variant architecture and remove the overengineered parts.

Centralized user-visible variant branding is one of the justified parts.
Do not treat it as optional or merely cosmetic.

Variant-specific feature-flag defaults are also one of the justified parts.
Do not treat them as optional or speculative.

## Authoritative Inputs

Read these before editing:

- `README.md`
- `.github/copilot-instructions.md`
- [../variant-spec.md](../variant-spec.md)
- [variant-spec-addendum-v1.md](./variant-spec-addendum-v1.md)
- [plan.md](./plan.md)

## Mission

Implement the corrected V1 variant system so that:

- Android supports `C64 Commander` and `C64U Controller`
- iOS and web remain defaulted to `C64 Commander`
- shared runtime branding remains centralized because it is one of the main reasons to keep the variant system
- variant-specific feature-flag defaults remain intact because they are one of the main reasons to keep the variant system
- helper-driven storage namespacing is removed
- Android remains the only platform with true multi-variant release obligations
- local side-by-side web testing remains a distinct-origin concern, not a runtime storage-partitioning concern

## Non-Negotiable Rules

1. Follow [variant-spec-addendum-v1.md](./variant-spec-addendum-v1.md) when it conflicts with the original spec.
2. Do not delete the canonical variant registry or generator.
3. Do not delete Android variant identity support.
4. Do not preserve `buildLocalStorageKey` or `buildSessionStorageKey` just because they already exist.
5. Do not preserve storage-prefix migrations, browser storage partitioning, or service-worker cache partitioning as required behavior.
   5a. Do not preserve browser-side decoupling code merely to support two local web containers on different `localhost` ports.
6. Do not preserve multi-variant iOS or web release matrices unless the addendum explicitly requires them.
7. Keep shared branding surfaces variant-driven where they deliver the centralized user-visible branding the variant system exists to provide.
   7a. Keep variant-specific feature-flag defaults variant-driven where they deliver the intended product differences between variants.
8. Do not silently swallow exceptions.
9. Every bug fix or simplification that needs regression protection must get a targeted regression test.
10. Do not claim builds or tests you did not run.

## Required End State

The work is complete only when all of the following are true:

- a canonical variant registry still exists
- generated runtime metadata still exists
- Android install identity, launcher branding, and artifact naming are variant-driven
- Android workflows can intentionally build and publish both variants
- iOS and web still build cleanly for the default `c64commander` variant
- the application no longer depends on helper-generated local/session storage prefixes
- iOS and web workflows no longer carry unnecessary multi-variant publish fan-out
- shared user-visible branding such as display name, logo selection, and export basenames remains centralized as a primary retained outcome
- variant-specific feature-flag defaults remain generated and distinct where intended as a primary retained outcome
- the retained web assumptions continue to rely on distinct origins for local side-by-side testing

## Implementation Priorities

Follow this order:

1. preserve the generator and Android metadata path
2. remove helper-based storage namespacing from runtime code and tests
3. keep the core shared branding and feature-default surfaces
4. simplify iOS and web workflows back to the default variant
5. update docs and tests to match the corrected scope

## Concrete Things To Remove Or Simplify

Treat these as removal candidates unless you can justify them directly from the addendum:

- `buildLocalStorageKey`
- `buildSessionStorageKey`
- schema fields used only for browser coexistence between multiple web variants
- runtime migrations added only to support new prefixed storage keys
- iOS variant-selection packaging matrices
- web variant-selection publishing matrices
- per-variant web image repository switching
- runtime complexity kept only to support same-origin coexistence of multiple web variants in one browser profile

## Concrete Things To Keep

Treat these as protected unless you uncover a concrete defect:

- `variants/variants.yaml`
- `scripts/generate-variant.mjs`
- generated variant runtime outputs
- Android `applicationId` selection
- Android app name/icon/splash generation
- Android artifact basename generation
- shared runtime display-name and logo selection where already centralized
- variant-driven feature-flag defaults where already modeled centrally
- variant-driven user-visible export basenames

## Validation

Final validation must include:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Also run the smallest honest targeted checks that prove:

- default variant generation still resolves to `c64commander`
- Android variant generation resolves `c64u-controller`
- retained Android metadata changes with the selected variant
- retained feature-flag defaults differ as intended between retained variants
- no retained runtime module depends on helper-prefixed storage keys
- the docs and implementation assumptions consistently treat distinct-origin local testing as sufficient for web-side isolation

## Reporting Requirements

At completion, report:

- what was kept
- what was removed or simplified
- what validations ran
- whether screenshots were updated
- any follow-up work deferred to a future broader cross-platform variant phase
