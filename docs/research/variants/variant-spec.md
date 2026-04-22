# Variant Spec

## 1. Goal

This repository must support a small number of centrally defined app variants without creating a maintenance fork of the codebase.

The target system must allow:

- one repository to define multiple variants
- one repository to build one or many of those variants
- another repository to build a different subset of the same model
- stable internal source layout and native source namespaces
- consistent user-visible naming for the selected variant
- variant-specific feature-flag defaults
- deterministic generation of native, web, and release metadata

The primary optimization target is maintainability, not maximal native project renaming.

---

## 2. Fixed Decisions

This spec locks in the following decisions.

### VARIANT-DECISION-001

A single codebase MAY define multiple variants.

### VARIANT-DECISION-002

A repository MAY publish artifacts for one variant or multiple variants from that same codebase.

The publish set MUST be explicitly controlled per repository and per workflow entrypoint.

### VARIANT-DECISION-003

The current repository MUST default to publishing only:

- `c64commander`

Multi-variant publication MUST still work when explicitly enabled.

### VARIANT-DECISION-004

Internal source code identifiers and native source layout MAY remain unchanged.

In particular:

- Android source namespace MAY remain `uk.gleissner.c64commander`
- iOS project structure and source file names MAY remain unchanged
- internal implementation names MAY continue to use `c64commander`

### VARIANT-DECISION-005

User-visible outputs MUST consistently reflect the selected variant.

This includes:

- app display name
- launcher/home-screen identity
- installable artifact filenames
- exported/downloaded filenames shown to users
- web manifest and browser-visible metadata
- login and shell branding text

### VARIANT-DECISION-006

Variants MUST support different feature-flag defaults.

Feature flags are not the same thing as variant identity, but each variant may ship with a different default feature configuration.

---

## 3. Current Repository Audit

The current codebase is not variant-ready. Variant-related identity is duplicated across multiple layers.

### VARIANT-AUDIT-001 — Shared And Build Surfaces

Hard-coded today in shared/build surfaces:

- `capacitor.config.ts`
  - `appId`
  - `appName`
- `package.json`
  - package name
  - Capacitor init script values
  - Docker image defaults
- `build`
  - Docker container/image names
  - APK naming
  - hard-coded Android package launch target
- `.github/workflows/android.yaml`
- `.github/workflows/ios.yaml`
- `.github/workflows/web.yaml`
- helper scripts such as:
  - `scripts/web-auto-update.sh`
  - `scripts/run-maestro-gating.sh`
  - `scripts/run-maestro.sh`
  - `scripts/smoke-android-emulator.sh`
  - `scripts/startup/collect-android-startup-baseline.mjs`

### VARIANT-AUDIT-002 — Web Surfaces

Hard-coded today in web-visible surfaces:

- `index.html`
  - title
  - author
  - description
  - Open Graph title/description
  - icon references
- `public/manifest.webmanifest`
  - app name
  - short name
  - icon filenames
  - theme/background colors
- `public/sw.js`
  - service worker cache prefix
- `public/*`
  - icon asset filenames
- `web/server/src/staticAssets.ts`
  - login page title and heading
- `src/pages/HomePage.tsx`
  - logo asset reference
- `src/index.css`
- `tailwind.config.ts`
  - current design tokens and fonts are global, not variant-driven

### VARIANT-AUDIT-003 — Android Surfaces

Hard-coded today in Android surfaces:

- `android/app/build.gradle`
  - `applicationId`
  - output APK filename
- `android/app/src/main/res/values/strings.xml`
  - app name
  - package name
  - custom URL scheme
- `android/app/src/main/res/mipmap-*`
  - launcher icons
- `android/app/src/main/res/drawable*`
  - splash assets
- `android/app/src/main/AndroidManifest.xml`
  - Android-visible app label is resolved through generated resources, but those resources are not variant-generated today

### VARIANT-AUDIT-004 — iOS Surfaces

Hard-coded today in iOS surfaces:

- `ios/App/App/Info.plist`
  - `CFBundleDisplayName`
- `ios/App/App.xcodeproj/project.pbxproj`
  - `PRODUCT_BUNDLE_IDENTIFIER`
- `ios/App/App/Assets.xcassets/AppIcon.appiconset`
- `ios/App/App/Assets.xcassets/Splash.imageset`

### VARIANT-AUDIT-005 — Runtime Namespaces And Exports

Current runtime storage and test identifiers are mostly single-variant:

- many `localStorage` and `sessionStorage` keys use `c64u_*`
- some exported filenames use `c64commander-*`
- tests and smoke tooling use `uk.gleissner.c64commander`

This is acceptable for internal/native isolation, but not for user-visible outputs.

### VARIANT-AUDIT-006 — Feature Flags

Feature flags already have one authoritative registry:

- `src/lib/config/feature-flags.yaml`

However, the repository does not yet support variant-specific flag defaults.

### VARIANT-AUDIT-007 — Summary Of Gaps

The current repository is missing:

- a canonical variant definition
- a generated runtime variant module
- generated platform resources
- a repo-level publish matrix
- variant-aware release naming
- variant-aware feature-flag defaults

---

## 4. Supported Variants

The initial repository scope contains two public example variants.

### VARIANT-001

- id: `c64commander`
- display_name: `C64 Commander`
- app_id: `c64commander`

### VARIANT-002

- id: `c64u-controller`
- display_name: `C64U Controller`
- app_id: `c64u-controller`

Additional variants MAY be added later through the same schema.

---

## 5. Variant Dimensions

The system MUST support the following dimensions.

### VARIANT-DIM-001 — User-Visible Identity

- display name
- short name
- description
- user-visible logo/icon references
- browser title and login title

### VARIANT-DIM-002 — Install Identity

- Android `applicationId`
- iOS `PRODUCT_BUNDLE_IDENTIFIER`
- custom URL schemes
- provider authorities derived from install identity

### VARIANT-DIM-003 — Assets

- Android launcher icons
- Android adaptive icon layers
- Android splash assets
- iOS AppIcon assets
- iOS splash assets
- Web favicon, manifest icons, touch icons

### VARIANT-DIM-004 — Visual Tokens

- theme color
- background color
- primary/accent token set
- optional font family overrides

### VARIANT-DIM-005 — Runtime UI Values

- display name shown in UI
- login page heading
- alt text
- logo paths
- exported filename basenames

### VARIANT-DIM-006 — Release Identity

- APK/AAB/IPA basenames
- Docker image/repository naming
- GitHub release asset names

### VARIANT-DIM-007 — Feature-Flag Defaults

- default enabled state per flag
- optional variant-specific visibility policy for an existing flag

### VARIANT-DIM-008 — Web Runtime Isolation

Where required for correctness, variants MUST support different web runtime namespaces:

- service worker cache prefix
- browser storage prefixes
- manifest/icon filenames

This is required when two variants might be built or tested against the same web origin or artifact store.

---

## 6. Compatibility And Non-Goals

### VARIANT-COMPAT-001

The Android source namespace is not a variant dimension.

It MAY remain:

- `uk.gleissner.c64commander`

### VARIANT-COMPAT-002

The iOS project, target structure, and source file layout are not variant dimensions.

They MAY remain unchanged.

### VARIANT-COMPAT-003

Internal implementation names MAY remain single-brand if they are not exposed to end users.

Examples:

- source directories
- class names
- internal helper constants
- native subsystem names

### VARIANT-COMPAT-004

Internal storage keys MAY remain stable where platform sandboxing already isolates variants and where user experience is unaffected.

However, web caches and browser storage MUST become variant-derived if otherwise they would collide across builds.

### VARIANT-COMPAT-005

Variant selection MUST be build-time only.

The app MUST NOT expose a runtime selector that changes variant identity after packaging.

---

## 7. Canonical Configuration Model

### VARIANT-SCHEMA-001 — Canonical Variant Root

The canonical variant root MUST be:

```text
variants/
```

### VARIANT-SCHEMA-002 — Canonical Files

The canonical files MUST be:

- `variants/variants.yaml`
  - variant identity
  - platform identifiers
  - asset paths
  - user-visible strings
  - repo publish defaults
- `variants/feature-flags/<variant>.yaml`
  - variant-specific feature-flag overrides

The canonical feature catalog remains:

- `src/lib/config/feature-flags.yaml`

That file remains the source of truth for feature IDs, grouping, and base schema.

### VARIANT-SCHEMA-003 — Example Structure

```yaml
schema_version: 1

repo:
  default_variant: c64commander
  publish_defaults:
    release:
      - c64commander
    ci:
      - c64commander

variants:
  c64commander:
    display_name: C64 Commander
    app_id: c64commander
    description: Configure and control your Commodore 64 Ultimate over your local network.

    platform:
      android:
        application_id: uk.gleissner.c64commander
        custom_url_scheme: uk.gleissner.c64commander
      ios:
        bundle_id: uk.gleissner.c64commander
      web:
        short_name: C64 Commander
        theme_color: "#6C7EB7"
        background_color: "#6C7EB7"
        cache_prefix: c64commander-static
        storage_prefix: c64commander
        login_title: C64 Commander Login
        login_heading: C64 Commander
        image_repo: ghcr.io/chrisgleissner/c64commander

    assets:
      web:
        favicon_svg: variants/assets/c64commander/web/favicon.svg
        icon_192_png: variants/assets/c64commander/web/c64commander-192.png
        icon_512_png: variants/assets/c64commander/web/c64commander-512.png
        icon_maskable_512_png: variants/assets/c64commander/web/c64commander-maskable-512.png
      android:
        launcher_foreground_png: variants/assets/c64commander/android/ic_launcher_foreground.png
        launcher_background_xml: variants/assets/c64commander/android/ic_launcher_background.xml
        splash_png: variants/assets/c64commander/android/splash.png
      ios:
        app_icon_1024_png: variants/assets/c64commander/ios/app-icon-1024.png
        splash_2732_png: variants/assets/c64commander/ios/splash-2732.png

    exported_file_basename: c64commander

  c64u-controller:
    display_name: C64U Controller
    app_id: c64u-controller
    description: Configure and control your Commodore 64 Ultimate over your local network.

    platform:
      android:
        application_id: uk.gleissner.c64ucontroller
        custom_url_scheme: uk.gleissner.c64ucontroller
      ios:
        bundle_id: uk.gleissner.c64ucontroller
      web:
        short_name: C64U Controller
        theme_color: "#6C7EB7"
        background_color: "#6C7EB7"
        cache_prefix: c64u-controller-static
        storage_prefix: c64u-controller
        login_title: C64U Controller Login
        login_heading: C64U Controller
        image_repo: ghcr.io/chrisgleissner/c64u-controller

    assets:
      web:
        favicon_svg: variants/assets/c64u-controller/web/favicon.svg
        icon_192_png: variants/assets/c64u-controller/web/c64u-controller-192.png
        icon_512_png: variants/assets/c64u-controller/web/c64u-controller-512.png
        icon_maskable_512_png: variants/assets/c64u-controller/web/c64u-controller-maskable-512.png
      android:
        launcher_foreground_png: variants/assets/c64u-controller/android/ic_launcher_foreground.png
        launcher_background_xml: variants/assets/c64u-controller/android/ic_launcher_background.xml
        splash_png: variants/assets/c64u-controller/android/splash.png
      ios:
        app_icon_1024_png: variants/assets/c64u-controller/ios/app-icon-1024.png
        splash_2732_png: variants/assets/c64u-controller/ios/splash-2732.png

    exported_file_basename: c64u-controller
```

### VARIANT-SCHEMA-004 — Invariants

The following MUST hold:

- `variant` ids MUST be unique
- `app_id` values MUST be unique
- install identifiers MUST be unique across variants
- all asset paths MUST exist
- `repo.default_variant` MUST reference a declared variant
- every publish-default entry MUST reference a declared variant

---

## 8. Feature-Flag Model

### VARIANT-FEATURE-001 — Base Registry

`src/lib/config/feature-flags.yaml` remains the base registry for:

- feature IDs
- groups
- titles
- descriptions
- base defaults

### VARIANT-FEATURE-002 — Variant Overlay

Each variant MAY provide an override file:

```text
variants/feature-flags/<variant>.yaml
```

Example:

```yaml
overrides:
  hvsc_enabled:
    enabled: true
  commoserve_enabled:
    enabled: false
  lighting_studio_enabled:
    enabled: true
    developer_only: false
    visible_to_user: true
```

### VARIANT-FEATURE-003 — Overlay Rules

Variant overlays:

- MUST reference existing feature IDs only
- MUST NOT create new features
- MUST NOT redefine title, description, or group
- MAY override:
  - `enabled`
  - `visible_to_user`
  - `developer_only`

### VARIANT-FEATURE-004 — Generated Output

The build MUST generate a variant-resolved feature registry before app compilation.

This MAY extend the existing feature-flag compiler or be implemented as a dedicated variant-aware step.

### VARIANT-FEATURE-005 — Testing

Tests MUST NOT hard-code expectations around one variant's feature defaults.

Tests that depend on defaults MUST source them from generated variant-resolved outputs.

---

## 9. Build And Generation Model

### VARIANT-BUILD-001 — Generator

A deterministic generator MUST exist:

```text
scripts/generate-variant.mjs
```

Inputs:

- `variants/variants.yaml`
- one selected variant id
- optional repo publish selection for matrix generation

Outputs:

- generated runtime module
- generated web metadata and assets
- generated Android strings/resources/assets
- generated iOS metadata/assets
- generated CI/release metadata

### VARIANT-BUILD-002 — Runtime Module

The generator MUST emit:

```text
src/generated/variant.ts
```

It MUST expose at least:

- variant id
- display name
- app id
- user-visible export basename
- selected asset references
- variant-resolved feature defaults

### VARIANT-BUILD-003 — Execution Order

Variant generation MUST run before:

- feature-flag compilation if variant overrides participate there
- `cap sync`
- Android build
- iOS build
- web build
- release packaging

### VARIANT-BUILD-004 — Check Mode

A check mode MUST exist:

```text
scripts/generate-variant.mjs --check --variant <id>
```

CI MUST fail if generated outputs differ from checked-in outputs.

---

## 10. Platform Integration

### VARIANT-ANDROID-001

Android source namespace MUST remain stable unless there is a separate future migration.

### VARIANT-ANDROID-002

Android `applicationId` MUST be variant-driven.

### VARIANT-ANDROID-003

Android user-visible strings and launcher/splash resources MUST be generated or copied from variant inputs.

### VARIANT-IOS-001

`CFBundleDisplayName` MUST be variant-driven.

### VARIANT-IOS-002

`PRODUCT_BUNDLE_IDENTIFIER` MUST be variant-driven.

### VARIANT-IOS-003

iOS app icons and splash assets MUST be variant-driven.

### VARIANT-IOS-004

iOS project layout and source file names SHOULD remain stable.

### VARIANT-WEB-001

Generated web outputs MUST cover:

- `index.html`
- `public/manifest.webmanifest`
- web icon assets under `public/`
- login page branding used by `web/server/src/staticAssets.ts`

### VARIANT-WEB-002

Service worker cache prefixes and browser storage prefixes MUST be variant-derived whenever otherwise builds would collide on the same origin.

---

## 11. Publication Model

### VARIANT-PUBLISH-001

Defining multiple variants in one repository does not mean every workflow must publish all of them.

### VARIANT-PUBLISH-002

Each repository MUST declare a default publish set.

For this repository, the default publish set is:

- `c64commander`

### VARIANT-PUBLISH-003

Release workflows MAY publish multiple variants, but only when the requested set is explicit and validated against declared variants.

### VARIANT-PUBLISH-004

Another repository MAY use the same model while publishing:

- exactly one variant
- a different default variant
- a different multi-variant subset

### VARIANT-PUBLISH-005

Artifact basenames MUST be variant-driven and user-visible.

Examples:

- `c64commander-<version>-android.apk`
- `c64commander-<version>-android-play.aab`
- `c64commander-<version>-ios.ipa`
- `c64u-controller-<version>-android.apk`

### VARIANT-PUBLISH-006

Docker image repositories and tags MUST be variant-driven when they are published as end-user distributions.

---

## 12. Testing Requirements

### VARIANT-TEST-001

Tests MUST remain variant-aware rather than single-brand-hard-coded, except where they intentionally verify one concrete published variant.

### VARIANT-TEST-002

Tests MUST NOT assert:

- display names
- icon filenames
- artifact basenames
- feature defaults

unless the expected values are sourced from generated variant outputs.

### VARIANT-TEST-003

A validation suite MUST verify:

- schema correctness
- asset existence
- generated output stability
- uniqueness of platform identifiers
- validity of repo publish defaults
- validity of variant feature-flag overlays

---

## 13. Constraints

### VARIANT-CONSTRAINT-001

Variant identity MUST NOT be driven by runtime environment variables alone.

Environment variables MAY select from declared variants in CI or local tooling, but they MUST NOT replace the canonical repository declarations.

### VARIANT-CONSTRAINT-002

Feature flags MUST NOT be the sole mechanism for expressing variant identity.

### VARIANT-CONSTRAINT-003

User-visible files and strings MUST come from variant data, not from scattered ad hoc constants.

---

## 14. End State

A compliant implementation guarantees:

- one codebase can define multiple variants
- one repository can publish one or many variants from that codebase
- the current repository defaults to publishing only `c64commander`
- internal native/source layout stays stable
- end-user-visible outputs consistently match the selected variant
- feature-flag defaults can differ per variant
- builds are deterministic and checkable
- repo-level publication policy is explicit rather than implicit
