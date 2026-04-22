# Variant Spec

> Superseded by [docs/research/variants/variant-spec.md](../../research/variants/variant-spec.md).
>
> This planning draft predates the current repository-grounded decisions. Use the research spec as the authoritative target state for:
>
> - multi-variant support within one repo
> - per-repo default publish sets
> - stable internal native/source identifiers
> - variant-specific feature-flag defaults

## 1. Problem Statement

The repository does not have a single authoritative variant source today.

Variant-related data is duplicated across:

- Capacitor configuration
- Android and iOS native project files
- Web metadata and assets
- CI/CD workflows and scripts
- Runtime UI code

This duplication introduces drift risk across:

- application name
- identifiers
- icons and splash assets
- cache and storage prefixes
- artifact naming

The system must provide:

- centralized variant definition
- cross-platform consistency
- low-effort switching
- safe private customization
- deterministic builds
- test independence from variant differences

---

## 2. Supported Variants

### VARIANT-001

- id: `default`
- display_name: `C64 Commander`
- app_id: `c64commander`

### VARIANT-002

- id: `private`
- display_name: `C64U Controller`
- app_id: `c64u-controller`

---

## 3. Variant Dimensions

The system MUST support the following variant-controlled dimensions:

### VARIANT-DIM-001 — Identity

- display name
- internal identifier (`app_id`)
- release naming

### VARIANT-DIM-002 — Platform Identifiers

- Android `applicationId`
- iOS `PRODUCT_BUNDLE_IDENTIFIER`
- custom URL schemes
- provider authorities

### VARIANT-DIM-003 — Assets

- Android launcher icons (all densities)
- Android adaptive icon layers
- Android splash assets
- iOS AppIcon asset catalog
- iOS splash assets
- Web favicon, manifest icons, touch icons

### VARIANT-DIM-004 — Visual System

- color palette
- theme color
- background color
- typography (font families)

### VARIANT-DIM-005 — Runtime UI Values

- display name in UI
- logo paths
- meta theme color
- login page text
- alt text

### VARIANT-DIM-006 — Release Identity

- APK/AAB/IPA filenames
- Docker image names
- GitHub release asset names

### VARIANT-DIM-007 — Runtime Namespaces

- service worker cache prefix
- localStorage keys
- test/runtime identifiers

---

## 4. Resolution Model

### VARIANT-RESOLVE-001 — Build-Time Resolution

The following MUST be resolved before packaging:

- display name
- bundle/package identifiers
- icons
- splash screens
- artifact names

### VARIANT-RESOLVE-002 — Runtime Exposure

The following MAY be exposed at runtime via generated code:

- UI palette
- typography
- UI copy
- storage/cache prefixes

---

## 5. Variant Definition

### VARIANT-SCHEMA-001 — Canonical File

```text
branding/brands.yaml
````

This file is the single source of truth for all variant definitions.

---

### VARIANT-SCHEMA-002 — Structure

```yaml
variants:
  default:
    display_name: C64 Commander
    app_id: c64commander
    description: Configure and control your Commodore 64 Ultimate over your local network.

    colors:
      theme_color: "#6C7EB7"
      background_color: "#6C7EB7"
      primary_hsl: "228 35% 57%"
      secondary_hsl: "45 20% 88%"
      accent_hsl: "228 45% 65%"

    typography:
      sans: Inter
      mono: JetBrains Mono

    assets:
      web_icon_png: branding/assets/default/web/c64commander.png
      web_icon_svg: branding/assets/default/web/c64u-icon.svg
      android_launcher_foreground: branding/assets/default/android/ic_launcher_foreground.png
      android_splash: branding/assets/default/android/splash.png
      ios_app_icon_1024: branding/assets/default/ios/app-icon-1024.png
      ios_splash_2732: branding/assets/default/ios/splash-2732.png

    platform_overrides:
      android:
        application_id: uk.gleissner.c64commander
        custom_url_scheme: uk.gleissner.c64commander
      ios:
        bundle_id: uk.gleissner.c64commander
      web:
        cache_prefix: c64commander-static
        image_repo: ghcr.io/chrisgleissner/c64commander

  private:
    display_name: C64U Controller
    app_id: c64u-controller
    description: Configure and control your Commodore 64 Ultimate over your local network.

    colors:
      theme_color: "#6C7EB7"
      background_color: "#6C7EB7"

    assets:
      web_icon_png: branding/assets/private/web/c64u-controller.png
      web_icon_svg: branding/assets/private/web/icon.svg
      android_launcher_foreground: branding/assets/private/android/ic_launcher_foreground.png
      android_splash: branding/assets/private/android/splash.png
      ios_app_icon_1024: branding/assets/private/ios/app-icon-1024.png
      ios_splash_2732: branding/assets/private/ios/splash-2732.png

    platform_overrides:
      android:
        application_id: uk.gleissner.c64ucontroller
        custom_url_scheme: uk.gleissner.c64ucontroller
      ios:
        bundle_id: uk.gleissner.c64ucontroller
      web:
        cache_prefix: c64u-controller-static
        image_repo: ghcr.io/<private-owner>/c64u-controller
```

---

### VARIANT-SCHEMA-003 — Invariants

* `app_id` MUST be unique
* all asset paths MUST exist
* all platform overrides MUST be defined
* identifiers MUST be globally unique across variants

---

## 6. Build System

### VARIANT-BUILD-001 — Generator

A deterministic generator MUST exist:

```bash
scripts/generate-variant.mjs
```

Inputs:

* canonical variant file
* selected variant

Outputs:

* platform-specific resources
* runtime module
* CI metadata

---

### VARIANT-BUILD-002 — Execution Order

The generator MUST run before:

* `cap sync`
* Android build
* iOS build
* web build

---

### VARIANT-BUILD-003 — Validation

A check mode MUST exist:

```bash
generate-variant --check
```

CI MUST fail if generated outputs differ.

---

## 7. Platform Integration

### VARIANT-ANDROID-001

* `namespace` MUST remain constant
* `applicationId` MUST be variant-driven
* all strings MUST be generated
* assets MUST be generated

---

### VARIANT-IOS-001

* `CFBundleDisplayName` MUST be generated
* `PRODUCT_BUNDLE_IDENTIFIER` MUST be generated
* asset catalogs MUST be generated
* storyboard MUST remain stable

---

### VARIANT-WEB-001

Generated outputs MUST include:

* `index.html`
* `manifest.webmanifest`
* service worker cache prefix
* login page UI values

---

### VARIANT-RUNTIME-001

Generated module:

```text
src/generated/variant.ts
```

Must expose:

* displayName
* appId
* asset paths
* theme values
* cache/storage prefixes

---

## 8. Feature Flags

### VARIANT-FEATURE-001

Feature flags are variant-scoped defaults.

---

### VARIANT-FEATURE-002

Overlay model:

```text
feature-flags.base.yaml
feature-flags.overlay.yaml
→ merged registry
```

Rules:

* base defines full schema
* overlay may override values only
* no new feature IDs allowed in overlay

---

### VARIANT-FEATURE-003

Tests MUST:

* run with all flags enabled
* not depend on variant defaults

---

## 9. Repository Strategy

### VARIANT-REPO-001

Variants MUST NOT be implemented as private branches in a public repository.

---

### VARIANT-REPO-002

Private variant MUST reside in a separate private repository.

---

### VARIANT-REPO-003

Private repository MUST track public upstream via:

```bash
git remote add upstream <public-repo>
```

---

## 10. Release System

### VARIANT-RELEASE-001

Artifacts MUST be named:

```text
<app_id>-<version>-<platform>.<ext>
```

---

### VARIANT-RELEASE-002

Examples:

* `c64commander-<version>-android.apk`
* `c64u-controller-<version>-ios.ipa`

---

### VARIANT-RELEASE-003

Tag namespaces MUST differ:

* public → `vX.Y.Z`
* private → `c64u-controller/vX.Y.Z`

---

### VARIANT-RELEASE-004

CI MUST enforce:

* public builds only `default`
* private builds only `private`

---

## 11. Testing

### VARIANT-TEST-001

Tests MUST be variant-agnostic.

---

### VARIANT-TEST-002

Tests MUST NOT assert:

* display names
* asset filenames
* cache prefixes

unless sourced from generated module.

---

### VARIANT-TEST-003

A validation suite MUST verify:

* schema correctness
* generated outputs
* cross-platform consistency

---

## 12. Constraints

### VARIANT-CONSTRAINT-001

Variant selection MUST NOT be runtime-configurable.

---

### VARIANT-CONSTRAINT-002

Variant configuration MUST NOT rely on environment variables as source of truth.

---

### VARIANT-CONSTRAINT-003

Feature flags MUST NOT represent variant identity.

---

## 13. End State

A compliant implementation guarantees:

* single authoritative variant definition
* zero cross-platform drift
* deterministic builds
* safe long-lived divergence
* clean upstream synchronization
* strict separation of public and private distributions
