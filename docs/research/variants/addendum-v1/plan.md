# Variant Addendum V1 Plan

Date: 2026-04-23
Status: Ready for execution
Primary inputs:

- [../variant-spec.md](../variant-spec.md)
- [variant-spec-addendum-v1.md](./variant-spec-addendum-v1.md)

Expected change classification: `DOC_PLUS_CODE`

## 1. Objective

Converge the current variant branch onto the Android-first scope defined in [variant-spec-addendum-v1.md](./variant-spec-addendum-v1.md).

The implementation goal is not to remove the variant system.
The goal is to keep the justified parts and delete the web/iOS decoupling work that V1 does not need.

Centralized variant-driven branding is one of the justified parts.
It is not a secondary convenience.

Variant-specific feature-flag defaults are also one of the justified parts.
They are not optional in V1.

The supported local web test route is two containers served from distinct origins, typically different `localhost` ports.
That route must not be used to justify keeping browser-storage or service-worker partitioning in application code.

## 2. Branch Review Findings To Act On

The reviewed branch against `main` showed:

- 162 changed files overall
- 91 files coupled to `buildLocalStorageKey` / `buildSessionStorageKey`
- Android identity and packaging changes are a minority of the branch, but they are the product-critical part
- centralized user-visible branding remains a product-critical part of the retained design
- per-variant feature-flag defaults remain a product-critical part of the retained design
- the supported local side-by-side web test route already gets client-side isolation from distinct origins

Execution must preserve the Android work and collapse the unnecessary storage and cross-platform publication work.

## 3. Required End State

At the end of this plan:

- one variant registry still exists
- Android supports both `c64commander` and `c64u-controller`
- iOS and web default to `c64commander`
- shared runtime branding remains centralized, consistent, and user-visible across the retained surfaces that motivate the variant system
- variant-specific feature-flag defaults remain intact and generated from one readable source of truth
- storage keys remain on the existing stable `c64u_*` scheme
- the codebase no longer depends on `buildLocalStorageKey` or `buildSessionStorageKey`
- iOS and web workflows no longer pretend to be full multi-variant release targets
- local side-by-side web testing still works by running the two variants on distinct origins, such as different `localhost` ports

## 4. Phase Plan

### Phase 0. Reconfirm minimal variant surface

Read:

- `README.md`
- `.github/copilot-instructions.md`
- [../variant-spec.md](../variant-spec.md)
- [variant-spec-addendum-v1.md](./variant-spec-addendum-v1.md)

Confirm:

- `main` is the comparison branch
- Android is the only true multi-variant shipping target
- default iOS/web shipping target is `c64commander`
- the supported local web test route is distinct-origin, same-machine testing rather than same-origin browser-profile coexistence

Exit criteria:

- all later changes can be judged against the addendum rather than the original broader spec

### Phase 1. Preserve the canonical generator and Android metadata path

Keep and tighten:

- `variants/variants.yaml`
- `scripts/generate-variant.mjs`
- `src/generated/variant.ts`
- `src/generated/variant.json`
- Android resource generation
- Android install identity selection
- Android artifact basename selection

Adjust the schema and generator so they express only what V1 needs.

Likely simplifications:

- make web cache/storage partition fields optional or remove them
- make runtime endpoint parameterization optional or remove it from required validation
- keep and simplify feature-flag defaults so the real variant differences remain explicit and generated

Exit criteria:

- the generator still selects variants cleanly
- the generator still materializes the intended per-variant feature defaults cleanly
- Android still has a deterministic metadata source

### Phase 2. Remove storage helper propagation

Rollback the helper-driven browser storage changes.

Targets include:

- `buildLocalStorageKey`
- `buildSessionStorageKey`
- all runtime modules changed only to swap `c64u_*` keys for helper-generated prefixes
- tests changed only to follow those helper-generated prefixes

Restore:

- existing stable `c64u_*` local storage keys
- existing stable `c64u_*` session storage keys

Remove:

- migration code added only for helper-prefixed keys
- storage clearing logic added only to support variant-prefixed web isolation

Do not replace this with test-only product complexity.
If local side-by-side testing needs stronger isolation than distinct origins already provide, that belongs in the test harness, such as separate browser profiles, not in runtime storage design.

Exit criteria:

- no app module depends on helper-generated storage prefixes
- no regression tests remain that exist only to protect helper-prefixed storage behavior

### Phase 3. Keep core shared branding and feature surfaces

Retain variant-driven behavior where it provides the centralized user-visible branding and feature-default differences that motivate the variant system.

Keep if still useful:

- selected logo asset path in shared UI
- selected display name in shared UI and shell text
- selected export basename for user-visible files
- selected feature-flag defaults per variant

Do not widen this into extra install-isolation work.

Exit criteria:

- shared branding remains centralized as a primary retained outcome rather than a nice-to-have
- per-variant feature defaults remain centralized as a primary retained outcome rather than a nice-to-have
- no storage or release complexity is reintroduced under the banner of consistency

### Phase 4. Collapse iOS and web release scope

Simplify workflows and platform metadata so iOS and web are treated as single-variant default targets.

Required outcome:

- Android workflows can fan out by variant
- iOS workflows build/package only `c64commander`
- web workflows build/publish only `c64commander`
- local variant testing guidance remains distinct-origin and does not imply same-origin coexistence support

Remove or simplify:

- iOS variant-selection matrix behavior
- web variant-selection matrix behavior
- per-variant web image repository fan-out
- controller-specific iOS release packaging obligations

Shared branding reads from generated metadata may remain if harmless.

Exit criteria:

- Android is the only platform with multi-variant release machinery
- iOS and web workflows are simpler than the current branch state

### Phase 5. Converge docs and tests

Update:

- `README.md` if it currently implies multi-variant iOS or web publication
- any variant docs that still state equal platform scope

Trim tests so they prove only the retained behavior:

- generator selection
- Android identity outputs
- shared branding outputs
- variant-specific feature-flag outputs
- absence of required storage-prefixing behavior

Exit criteria:

- docs match the Android-first scope
- tests protect the kept design rather than the removed overreach

## 5. Validation

Because this plan produces code changes, final validation must include:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

Add the smallest honest targeted checks needed to prove:

- default generation still selects `c64commander`
- Android generation can select `c64u-controller`
- Android packaging metadata changes with the selected variant
- iOS and web remain defaulted to `c64commander`
- variant-specific feature-flag defaults differ as intended between retained variants
- no retained code path depends on helper-prefixed storage keys
- the retained web assumptions are documented around distinct-origin local testing rather than code-side browser decoupling

## 6. Guardrails

- do not remove the generator entirely
- do not revert Android variant identity support
- do not keep `buildLocalStorageKey` merely because it already landed
- do not keep multi-variant iOS/web workflows merely because the branch already contains them
- do not preserve browser-side web decoupling to solve a local testing problem that distinct origins already solve out of the box
- do not remove real per-variant feature-flag differences under the banner of simplification
- do not introduce speculative endpoint complexity without a confirmed product need

## 7. Completion Report

The final implementation report must state:

- what was kept from the current branch
- what was removed or simplified
- which validations ran
- whether any visible screenshots needed updates
- any remaining deferred work for a future cross-platform multi-variant phase
