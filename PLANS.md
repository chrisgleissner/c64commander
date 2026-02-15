# 2026-02-15 Web Platform (Docker) First-Class Support Plan

## Scope

Introduce Web as an official peer platform to Android and iOS with:
- Dockerized self-hosted deployment
- Server-side REST/FTP proxying to C64U (browser never calls C64U directly)
- Optional login gating derived from the network password setting
- Persistent config in mounted `/config`
- Multi-arch image support limited to `linux/amd64` and `linux/arm64`
- CI build/test/release integration with version-tag consistency

## Decisions

- Web platform uses Playwright (not Maestro) for browser E2E because Maestro is optimized for native app automation and this repository already has mature Playwright browser flows.
- Server is implemented in TypeScript (Node runtime) and serves static assets + auth + REST/FTP proxy.
- Docker image naming convention: `ghcr.io/chrisgleissner/c64commander:<version>`.
- Docker architecture matrix is strictly MVP: `linux/amd64,linux/arm64`.

## Execution Checklist

### 1) Platform Runtime & Proxy
- [x] Add TypeScript web server module.
- [x] Serve static app assets.
- [x] Add health endpoint.
- [x] Add REST proxy endpoint(s) with deterministic errors.
- [x] Add FTP proxy endpoint(s) with deterministic errors.
- [x] Inject network password header into REST requests when configured.

### 2) Auth & Config Persistence
- [x] Add `/config`-backed settings persistence.
- [x] Use network password as single source of truth.
- [x] If password unset: no login required.
- [x] If password set: require login + session cookie for static/proxy routes.
- [x] Add login/logout/status endpoints.
- [x] Expose secure-storage web endpoints for existing app settings UI.

### 3) Frontend Integration (No UI Fork)
- [x] Keep shared TypeScript frontend unchanged in behavior.
- [x] Add web-platform runtime wiring for REST proxy base path.
- [x] Add web-platform runtime wiring for FTP bridge path.
- [x] Wire web secure-storage plugin to server endpoints.

### 4) Docker & Packaging
- [x] Add multi-stage Dockerfile.
- [x] Runtime binds `0.0.0.0:8080`.
- [x] Support mounted `/config` volume.
- [x] Add scripts for local docker build/run.
- [x] Add Buildx publish path for `linux/amd64,linux/arm64` only.

### 5) Tests
- [x] Add unit tests for config/auth/password-injection/proxy helpers.
- [x] Add integration tests for auth middleware and REST/FTP proxy behavior.
- [x] Add Playwright web-platform tests covering:
  - [x] startup + health + UI load
  - [x] auth matrix (no password, wrong password, correct password, route protection)
  - [x] one high-value click path (file browse/add/play)
  - [x] edge path (invalid password or unreachable mock)
  - [x] persistence across restart with mounted `/config`

### 6) CI & Release
- [x] Add CI job(s) to build web assets + web server.
- [x] Build and validate Docker image on `linux/amd64` in PR/push.
- [x] On tags, publish multi-arch image manifest (`linux/amd64,linux/arm64`) to GHCR.
- [x] Enforce image tag equals app version/tag.
- [x] Keep Android/iOS gates intact.

### 7) Documentation
- [x] Update README platform badge/wording to Android|iOS|Web.
- [x] Add Web overview and CORS proxy rationale.
- [x] Add Docker installation intro + official links (Windows/macOS/Linux).
- [x] Add canonical `docker run` usage + Raspberry Pi example + update flow.
- [x] Add LAN-only and internet-exposure warning.

### 8) Final Verification
- [x] Run `npm run lint`.
- [x] Run `npm run test`.
- [x] Run `npm run build`.
- [x] Run web server tests.
- [x] Mark all checklist items completed with outcome notes.

## Outcome Notes

- Completed implementation of the Dockerized Web platform server, auth/config persistence, frontend web wiring, Docker packaging, CI workflow, and README documentation.
- Verified locally with:
  - `npm run lint`
  - `npm run test`
  - `npm run build:web-platform`
  - `npm run test:web-platform`
  - `docker build -f web/Dockerfile -t c64commander:local .`
  - Container smoke health check on `http://127.0.0.1:18080/healthz`
- Added dedicated Playwright web-platform coverage for startup/auth/high-value path/edge path and config persistence across restart.
