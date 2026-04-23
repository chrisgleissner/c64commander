# Variant Spec Addendum V1

Date: 2026-04-23
Status: Proposed correction set
Extends: [../variant-spec.md](../variant-spec.md)

## 1. Purpose

This addendum corrects the original variant spec after reviewing the full `feat/variants` branch against `main`.

Repository note:

- the repo has no `master` branch
- the reviewed comparison target was `main`

The core correction is simple:

- variant support is primarily an Android packaging and install-identity requirement
- centralized variant-driven user-visible branding remains a primary reason for the variant system
- iOS and web only need consistent code structure and readable branding surfaces
- iOS and web do not need full multi-variant decoupling in this repository

Web clarification:

- local side-by-side testing of two web variants on one machine remains acceptable when each variant is served from a distinct origin, including different `localhost` ports
- same-origin coexistence inside one browser profile remains explicitly unsupported for V1

## 2. Branch Review Summary

The reviewed branch currently changes 162 files.

The largest overreach is storage and browser-isolation work:

- `buildLocalStorageKey` / `buildSessionStorageKey` were propagated into 46 `src/` files
- the same helper-driven churn reached 45 test files
- 91 files in total now depend on those helpers

That scope is not justified by the actual product need.

Under native platforms:

- Android app storage is already isolated by application id
- iOS app storage is already isolated by bundle id

Under web:

- this repository intends to ship only one variant
- the main local test route for web variant support is two locally running containers exposed on different `localhost` ports
- that route already gets browser isolation from origin boundaries, without code-side storage partitioning
- browser-side storage and service-worker collision avoidance between multiple web variants is therefore not a v1 requirement

## 3. Corrected Product Scope

V1 must support these concrete product outcomes:

- Android build and publish `C64 Commander`
- Android build and publish `C64U Controller`
- iOS build and publish `C64 Commander`
- web build and publish `C64 Commander`

V1 does not need these outcomes:

- shipping `C64U Controller` for iOS
- shipping `C64U Controller` for web
- allowing multiple branded web variants to coexist safely in one browser profile
- allowing same-origin web coexistence between multiple variants in one browser profile
- allowing multiple branded iOS variants to coexist on one device

## 4. Corrected Decisions

### ADDENDUM-DECISION-001

The variant system remains repository-wide, but the primary driver is Android.

The design must optimize for:

- Android install identity
- Android launcher branding
- Android artifact naming
- Android release workflow selection

It must not optimize for hypothetical full isolation of all platforms.

### ADDENDUM-DECISION-002

One canonical variant registry and one generator remain required.

Keep:

- `variants/variants.yaml`
- generated runtime metadata such as `src/generated/variant.ts` and `src/generated/variant.json`
- generated Android resources and metadata

This keeps the codebase readable and avoids scattering branding constants.

### ADDENDUM-DECISION-003

Distinct per-variant identity is a primary retained requirement of the variant system.

The word shared in this addendum refers to the implementation approach, not to the visible identity.
The variants must not share one brand identity.
They must share one centralized mechanism for defining and consuming their identity values.

In practice, each variant must be able to supply its own user-visible identity for surfaces such as:

- display name
- logo path
- exported file basename for user-visible downloads
- selected feature defaults per variant

The point of the variant system is to keep those identities distinct while avoiding duplicated branding constants and duplicated branching logic across the codebase.

The simplification in this addendum is only about removing unnecessary browser-isolation and cross-platform release complexity.
It is not about collapsing variant identity into a shared brand.

### ADDENDUM-DECISION-004

`localStorage` and `sessionStorage` namespacing is not required for V1.

Therefore:

- `buildLocalStorageKey` is not part of the required architecture
- `buildSessionStorageKey` is not part of the required architecture
- existing storage keys such as `c64u_*` should remain stable
- migration logic added only to support helper-prefixed keys should be removed

Reason:

- native platforms already isolate storage per app
- only one web variant is intended to ship
- the helper adds broad churn without solving a real repository requirement

### ADDENDUM-DECISION-005

Service-worker cache isolation between web variants is not required for V1.

Therefore:

- variant-specific `cachePrefix` is not required
- cache naming may remain single-application

If the generator already emits web shell metadata, that is fine, but cache partitioning must not be treated as a required invariant.

### ADDENDUM-DECISION-005A

Distinct-origin web isolation is sufficient for the supported local test route.

In particular:

- running two local web variants on the same machine under different `localhost` ports is an acceptable test setup
- that setup does not require helper-prefixed browser storage keys
- that setup does not require variant-specific service-worker cache partitioning
- separate Chrome profiles may be used as extra test isolation, but they are not the architectural reason to keep web-side decoupling code

This addendum therefore optimizes for simple application code and relies on origin boundaries for the supported local side-by-side web test route.

### ADDENDUM-DECISION-006

Multi-variant publish matrices are required only for Android.

Required:

- Android CI/package/release flows must support `c64commander` and `c64u-controller`

Not required for V1:

- iOS release matrix across variants
- web publish matrix across variants
- per-variant web container repositories

iOS and web should default to `c64commander` without extra publish-selection machinery unless a later product decision requires more.

### ADDENDUM-DECISION-007

iOS and web should consume variant metadata consistently, but only where that improves readability and does not imply unsupported deployment promises.

Acceptable:

- shared code reading `variant.displayName`
- shared code reading `variant.assets.*`
- web login/title metadata reading generated branding

Not required:

- iOS bundle-id switching for `c64u-controller`
- iOS packaging and release validation for `c64u-controller`
- web image-repository switching for `c64u-controller`

### ADDENDUM-DECISION-008

Variant-specific feature-flag defaults are required in V1.

The architecture must support per-variant defaults cleanly from the canonical variant system.

V1 acceptance therefore requires:

- distinct feature-flag defaults for the supported variants where the product intends them to differ
- one readable source of truth for those defaults

The implementation should still avoid unnecessary schema complexity, but it must not collapse real variant flag differences into a shared default.

### ADDENDUM-DECISION-009

Variant-specific runtime endpoint defaults are not required for V1 unless a concrete variant needs different values.

The reviewed branch currently carries identical endpoint values for both variants, so endpoint parameterization is not part of the distilled minimum scope.

## 5. Distilled Required Changes

These are the changes that remain justified after the branch review.

### 5.1 Keep

- a canonical variant registry describing at least `c64commander` and `c64u-controller`
- a generator that selects one declared variant and materializes generated metadata
- Android `applicationId` selection from generated metadata
- Android app name, launcher icons, splash assets, URL scheme, and artifact basenames from generated metadata
- Android release workflow support for publishing both variants intentionally
- shared runtime branding for display name, selected logo asset, and user-visible export filenames as a primary retained outcome of the variant system
- variant-specific feature-flag defaults as a primary retained outcome of the variant system

### 5.2 Revert Or Remove

- `buildLocalStorageKey`
- `buildSessionStorageKey`
- storage-key rewrites across the app
- session-storage rewrites across the app
- storage migration code introduced only because of helper-prefixed keys
- service-worker cache partitioning framed as a variant requirement
- web image-repo switching as a required release feature
- iOS multi-variant packaging, artifact naming, and release fan-out

## 6. File-Level Implications

### 6.1 Likely to stay variant-driven

- `variants/variants.yaml`
- `scripts/generate-variant.mjs`
- `src/generated/variant.ts`
- `src/generated/variant.json`
- `android/app/build.gradle`
- `android/app/src/main/res/values/strings.xml`
- Android launcher and splash resource outputs
- `.github/workflows/android.yaml`
- shared runtime branding consumers such as:
  - `src/pages/HomePage.tsx`
  - `src/lib/diagnostics/diagnosticsExport.ts`
  - `src/lib/tracing/traceExport.ts`

### 6.2 Likely to be simplified back

- `src/lib/ftp/ftpConfig.ts`
- `src/lib/telnet/telnetConfig.ts`
- `src/lib/config/appSettings.ts`
- `src/lib/savedDevices/store.ts`
- `src/lib/playlistRepository/localStorageRepository.ts`
- `src/lib/native/featureFlags.web.ts`
- `src/lib/fuzz/fuzzMode.ts`
- the many other `src/` and `tests/` files touched only to thread storage helpers through existing `c64u_*` keys
- `.github/workflows/ios.yaml`
- `.github/workflows/web.yaml`

## 7. Acceptance Criteria

V1 is complete when all of the following are true:

- Android can build `c64commander`
- Android can build `c64u-controller`
- Android release outputs and Play package names follow the selected variant
- shared runtime branding surfaces are driven from one generated variant object
- iOS and web still build and publish the default `c64commander` variant cleanly
- the repository does not depend on variant-prefixed browser storage keys
- the repository does not require multi-variant web or iOS publication machinery
- the supported local web test route remains two variants served from distinct origins, such as different `localhost` ports

## 8. Explicit Non-Goals

These are out of scope for this addendum and must not be smuggled back in during implementation:

- browser-profile-safe coexistence of multiple web variants
- same-origin browser-profile-safe coexistence of multiple web variants
- side-by-side iOS installation of multiple variants
- proving every schema dimension on every platform in V1
- speculative runtime endpoint variation when both variants use the same values
- widespread test churn solely to support prefixed storage keys

## 9. Implementation Guidance

When this addendum conflicts with the original variant spec, follow this addendum for V1 implementation.

The intended implementation shape is:

1. keep the variant generator and Android identity pipeline
2. keep centralized shared branding surfaces as a primary retained outcome
3. keep variant-specific feature-flag defaults as a primary retained outcome
4. remove broad storage-prefixing work
5. collapse iOS/web release scope back to the default variant
6. validate that Android remains the only platform with true multi-variant release obligations

Implementation note:

- do not retain web storage or cache partitioning merely to support local side-by-side testing on different `localhost` ports
