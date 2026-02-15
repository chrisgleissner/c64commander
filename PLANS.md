# Web + Multi-Platform Productionization Contract (Node 24)

Last updated: 2026-02-15
Owner: Copilot coding agent
Branch: feat/web

## Goal

Productionize Web as a first-class platform without duplicating Android-shared logic tests, and upgrade the repository from Node 22/20 references to Node 24 LTS with Docker runtime alignment to `node:24-trixie-slim`.

## Phase Status

### Phase 1 — Inventory & Baseline

- [x] Inventory all Node references (`package.json`, workflows, Dockerfile, runtime pin files).
- [x] Inventory current Web container hardening state.
- [x] Inventory platform-specific test coverage and duplication risk.
- [x] Capture baseline validation outputs.

### Phase 2 — Node 24 Upgrade & Toolchain Alignment

- [x] Enforce Node 24 via `package.json` engines (`>=24 <25`) and npm floor (`>=10`).
- [x] Upgrade workflow Node pins to 24:
  - `.github/workflows/android-apk.yaml`
  - `.github/workflows/ios-ci.yaml`
  - `.github/workflows/web-platform.yaml`
  - `.github/workflows/fuzz-chaos.yaml`
- [x] Add `.nvmrc` with `24`.
- [x] Upgrade Node-sensitive types package: `@types/node` to `^24.7.2`.
- [x] Regenerate lockfile and validate deterministic install (`npm install`, then `npm ci`).

### Phase 3 — Web Docker Hardening & Runtime Readiness

- [x] Base image upgraded in all stages: `node:24-trixie-slim`.
- [x] Multi-stage build retained.
- [x] Runtime configured as non-root (`USER node`).
- [x] Explicit `WORKDIR`, `NODE_ENV`, `PORT`, and `EXPOSE 8080` retained.
- [x] `HEALTHCHECK` added and validated against `/healthz`.
- [x] Deterministic copy order retained.
- [x] Runtime logs validated via `docker logs`.

### Phase 4 — Multi-Arch Validation (`linux/amd64`, `linux/arm64`, RPi64)

- [x] Base image manifest evidence captured for `linux/amd64` and `linux/arm64/v8` via `docker buildx imagetools inspect node:24-trixie-slim`.
- [x] Raspberry Pi 64-bit compatibility documented via arm64/v8 manifest presence.
- [ ] Local multi-arch build execution fully validated in this Linux rootless environment.
  - Attempted `docker buildx build --platform linux/amd64,linux/arm64 ...`
  - Observed `exec format error` during arm64 emulation in this local setup.
  - CI path remains authoritative for true multi-arch build execution (QEMU + Buildx in `web-platform.yaml`).

### Phase 5 — Test Strategy Deduplication & Platform-Specific Scope

- [x] Confirmed Android remains canonical for shared domain logic.
- [x] No new duplicate Web/iOS tests were added for shared behavior.
- [x] Web-only coverage retained in existing tests:
  - `tests/unit/web/webServer.test.ts` (auth/health/proxy/ftp)
  - `playwright/webPlatformAuth.spec.ts` (auth matrix, proxy edge path, persistence)
- [x] iOS-only behavior remains in iOS workflow + Maestro flows (`ios-ci.yaml`) without duplicating Android shared logic.

### Phase 6 — Cross-Platform Validation Matrix + CI Gate

- [x] `npm ci`
- [x] `npm run lint`
- [x] `npm run test`
- [x] `npm run build`
- [x] `npm run build:web-platform`
- [x] `npm run test:web-platform`
- [x] `npm run android:apk`
- [ ] `npm run ios:build:sim` (environment-bound on Linux: `xcodebuild: not found`)
- [~] `gh pr checks 40` (35 successful, 2 skipped, 1 pending `codecov/project`, no failures at capture time)

## Verification Evidence

### Node/toolchain evidence

- Local runtime: `node v24.11.0`, `npm 11.6.1`.
- Clean install constraint validated by lock mismatch failure followed by lock regeneration and successful `npm ci`.

### Docker/runtime evidence

- `docker build -f web/Dockerfile -t c64commander:local .` succeeded.
- Container smoke on `:18080` returned `{"ok":true}` from `/healthz`.
- Runtime log confirms server bind: `C64 Commander web server running on http://0.0.0.0:8080`.
- Health status object present in `docker inspect`.

### Multi-arch/base image evidence

- `docker buildx imagetools inspect node:24-trixie-slim` reported manifests for:
  - `linux/amd64`
  - `linux/arm64/v8`

### CI evidence snapshot

- `gh pr checks 40` showed Android CI, iOS CI, and Web CI checks passing.
- Remaining pending check is external coverage aggregation (`codecov/project`) with no failing checks reported.

## Risk Log

- [x] Node 24 dependency compatibility risk mitigated by successful `npm ci`, lint, test, build, and web-platform validation.
- [x] Docker runtime hardening risk mitigated by successful local smoke + healthcheck + logs.
- [ ] Rootless local arm64 emulation for Buildx remains environment-constrained; rely on CI multi-arch pipeline execution.
- [x] Test matrix explosion avoided (no redundant cross-platform duplication introduced).

## Definition of Done

- [x] Node 24 enforced across package metadata and CI workflows.
- [x] Web Docker image aligned to `node:24-trixie-slim` with pragmatic hardening.
- [x] Web local Docker runtime + healthcheck validated.
- [x] Android remains primary shared-logic surface; no redundant Web/iOS duplication added.
- [x] Platform-specific Web coverage remains focused on Web-only behavior.
- [ ] Full end-state CI gate fully settled (one non-failing pending external check at capture time).
