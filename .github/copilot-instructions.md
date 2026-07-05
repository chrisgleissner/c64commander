# Copilot Instructions for c64commander

This is the entry index for agents working on **c64commander** — a React + Vite +
Capacitor app for managing a C64 Ultimate device (configuration, device control, SID
playback) across web, Android, and iOS.

It is intentionally short. The detail lives in two files; read the one that fits your
need and keep this file as the map.

## Three sources of truth

1. **`REVIEW.md`** (repo root) — the **quality bar**. What every change must satisfy:
   what reviewers flag, severity calibration, verification expectations, and the
   repository-specific hazards that have actually bitten (device-wedging writes,
   coverage-hang render loops, golden-trace and coverage gates, the keypad/CTA
   contract, cross-platform parity). Read it _before and while_ you write code — the
   best problem is the one prevented at the keyboard.
2. **`AGENTS.md`** — the **execution manual**. Change classification
   (`DOC_ONLY` / `CODE_CHANGE` / `UI_CHANGE` / `DOC_PLUS_CODE`), the validation matrix,
   screenshot discipline, coverage gates, device-stabilization (Pixel 4 / `u64` / `c64u`)
   loops, golden-trace stewardship, and release identity.
3. **`README.md`** — product overview, local build, and Android notes.

On a genuine conflict, the narrower, safer rule wins. A task-specific user prompt may
narrow scope but must not violate `REVIEW.md` or `AGENTS.md`.

## Non-negotiables (read first; full rationale in REVIEW.md)

1. **Never weaken a gate to go green.** Do not skip, `xfail`, comment out, or loosen
   tests, coverage thresholds, golden-trace assertions, or lint. Fix root causes.
2. **Keep the repo buildable.** If your change breaks a build, fix it before declaring
   done.
3. **Every bug fix ships a dedicated regression test** that fails before and passes
   after, named for the edge condition it locks in.
4. **Never swallow exceptions.** Rethrow with context or log at WARN/ERROR with a stack
   trace — a silent `catch` is a release blocker.
5. **Never wedge the device.** Single-item config writes use `PUT`, not the
   body-buffering `POST /v1/configs`; coalesce rapid interactive writes. See REVIEW.md §2.
6. **Validate the smallest honest set** for your change classification (AGENTS.md) — no
   build/test/screenshot ceremony for doc-only changes; full validation for executable
   ones.
7. **Don't revert unrelated worktree changes** — assume a concurrent agent owns them
   unless the task says otherwise.

## Quick discovery

- **High-level context**: `README.md`
- **Review standards / quality bar**: `REVIEW.md`
- **Execution & validation rules**: `AGENTS.md`
- **REST API docs**: `docs/c64/devices/u64e/3.15alpha/u64e-openapi.yaml` for C64U/U64/U64E2
  and `docs/c64/devices/u2/3.14a/u2-openapi.yaml` for U2; Streams and `machine:input` are
  U64-family capabilities and must be runtime-gated.
- **Telnet reference**: `docs/c64/c64u-telnet.yaml`
- **UX guidance**: `docs/ux-guidelines.md`
- **CTA / keypad inventory**: `docs/cta-inventory.md`
- **Maestro guidance**: `docs/testing/maestro.md`
- **UI pages**: `src/pages/` · **Navigation**: `src/components/TabBar.tsx`
- **Core API client**: `src/lib/c64api.ts` · **Hooks**: `src/hooks/`
- **Song sources**: `src/lib/sources/` · **HVSC module**: `src/lib/hvsc/`,
  `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID player utilities**: `src/lib/sid/` · **Native bridges**: `src/lib/native/`

## Architecture boundaries

- **UI**: `src/pages/`, `src/components/`, `src/components/ui/`
- **Data/hooks**: `src/hooks/`, `src/lib/c64api.ts`
- **App config state**: `src/hooks/useAppConfigState.ts`, `src/lib/config/`
- **Song sources**: `src/lib/sources/` (local FS + HVSC)
- **HVSC ingestion**: `src/lib/hvsc/` (service/types/native bridge)
- **Native bridges**: `src/lib/native/`, `src/lib/hvsc/native/`
- **Android HVSC engine**: `android/app/src/main/java/com/c64/commander/hvsc/`
- **SID playback utilities**: `src/lib/sid/`

## Build and test (essentials)

Use the smallest honest subset for your change; see AGENTS.md for the full matrix.

```bash
npm install
npm run lint    # format:check:ts + eslint + variant/feature-flag/bundle checks
npm run test    # Vitest unit
npm run build
```

Other suites: `npm run test:coverage` (≥91% branch), `npm run test:e2e` (Playwright +
golden traces), `cd android && ./gradlew test` (Android JVM), `npm run test:agents`
(pytest, ≥90% branch). Android local: `npm run cap:build` then `./build --install-apk`
(set `JAVA_HOME`). Formatting is enforced by Prettier/ESLint — do not hand-format.
