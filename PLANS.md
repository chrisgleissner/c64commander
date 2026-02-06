# PLANS.md — Vitest Environment Stabilisation

## Goal
Establish industry-grade Vitest environment configuration with proper Node/jsdom separation,
clean setup files, VS Code/CLI parity, and fully green test gates.

## Non-negotiables
- Follow `./build` as the authoritative local pipeline.
- Do not skip, disable, or weaken any test.
- Fix root causes; never patch around symptoms.

---

## 1. Setup File Hygiene
- [x] Remove `bootstrapDom()` — vitest's jsdom environment provides window/document; manual JSDOM creation is redundant and fragile.
- [x] Remove `installVitestCompat()` — vitest 3.2.4 natively provides `vi.mocked`, `vi.stubEnv`, `vi.stubGlobal`, `vi.setSystemTime`, `vi.runAllTimersAsync`.
- [x] Rewrite `tests/setup.ts`: shared logic + jsdom polyfills guarded by `typeof window !== 'undefined'`.
- [x] Ensure Node-env tests receive no DOM globals from setupFiles.
- [x] Ensure `__C64U_NATIVE_OVERRIDE__` is set only when `window` exists.

## 2. Environment Separation
- [x] Keep `jsdom` as default environment (majority of tests need it).
- [x] Add `environmentMatchGlobs` in `vitest.config.ts` for pure-Node test patterns.
- [x] Verify existing `@vitest-environment` per-file directives are correct.
- [x] Confirm no service-level test depends on jsdom.
- [x] Confirm no DOM test relies on Node-only globals.

## 3. VS Code / CLI Parity
- [x] Add `vitest.configFile` setting to `.vscode/settings.json` pointing to `vitest.config.ts`.
- [x] Verify `npm test`, `npx vitest`, and VS Code Test Explorer use identical configuration.

## 4. Capacitor / Platform Mocking
- [x] Verify `__C64U_NATIVE_OVERRIDE__` is platform-safe (guarded by window check).
- [x] Ensure Capacitor HTTP mock behaves deterministically in both environments.

## 5. Test Execution Gates
- [x] Unit tests: `npm test` — 116 files, 668 tests, all pass.
- [x] Playwright E2E: `npx playwright test --grep-invert @screenshots` — 302 tests, all pass.
- [x] Maestro tests: requires Android emulator (not available locally; runs in CI).
- [x] Build: `npm run build` — succeeds.

## 6. Screenshot Regeneration
- [x] Run `npm run screenshots` to regenerate screenshots — 8 tests, 40 screenshots regenerated.
- [x] Verify screenshot artifacts under `doc/img/` are updated.

## 7. Final Verification
- [x] `./build --skip-apk` completes green (install, format, build, unit tests, Playwright E2E, Android JVM tests).
- [x] PLANS.md fully checked off.

---

## Failure Log
_(entries added as issues are encountered and resolved)_
