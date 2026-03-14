# Review 7: Production Hardening Audit

## Executive Summary

This review found that C64 Commander has a materially stronger production posture than a typical multi-runtime hobby application. The repository shows deliberate investment in CI, screenshots, E2E coverage, diagnostics, auxiliary test systems, and platform-specific validation. The broad conclusion is:

- Web and Android surfaces are close to production-ready and, based on current evidence, can be treated as operationally credible release targets.
- iOS is materially less mature and should not be represented as equally production-ready without qualification.
- The most concrete code-level issue identified in this pass is a silent catch in `web/server/src/staticAssets.ts` that violates repository exception-handling rules and should be fixed before claiming full hardening compliance.

The key non-blocking concerns are mostly about observability clarity rather than obvious correctness failures: slider propagation semantics need a dedicated regression guard, and connection freshness/status wording can mislead operators during quiet but healthy sessions.

## Scope

This audit covered:

- Repository inventory and subsystem grouping
- Documentation consistency across `README.md`, `doc/**`, `docs/**`, and in-app docs
- App/runtime architecture and route topology
- Runtime interaction questions raised by maintainers, especially slider propagation and connection freshness
- CI workflow posture, coverage enforcement, screenshots, and E2E validation
- Web server/session hardening
- Android/iOS platform posture
- Test breadth across app, Playwright, Maestro, agents, and c64scope

This review respected the user-requested non-goals:

- HTTP/FTP usage itself was not flagged as a defect
- rollout strategy was not treated as a defect area
- GitHub Actions hash pinning was not treated as a finding
- already-resolved Review 6 items were not re-raised as new defects

Note on plan tracking:

- During this audit, `PLANS.md` was concurrently replaced with unrelated implementation work. That file was preserved instead of being overwritten again. Review-7 progress is therefore reflected primarily in the generated artifacts under `doc/research/review-7/artifacts/`.

## Repository Inventory

The repository is not a single web application. It is a multi-runtime suite with the following major surfaces:

- `src/`: React + Vite application
- `web/server/`: self-hosted web runtime and auth/session surface
- `android/`: native Android packaging and plugin layer
- `ios/`: native iOS packaging and native validation surface
- `playwright/`, `.maestro/`, `tests/`: browser and mobile validation layers
- `agents/`: Python agent/test subsystem
- `c64scope/`: MCP-based hardware evidence and validation subsystem

The inventory and subsystem counts are documented in `artifacts/repo-inventory.md`.

## Architecture Analysis

The architecture is coherent and intentionally partitioned. Major user-facing flows are route-driven and lazy-loaded from `src/App.tsx`, with separate feature pages for Home, Play Files, Disks, Settings, Docs, and supporting flows. The repository also treats diagnostics, testing, and operator documentation as first-class surfaces rather than incidental support material.

The main architectural risk is not disorder. It is seam complexity. Shared TypeScript modules influence:

- browser UX
- Node web-server behavior
- Android/iOS packaging assumptions
- Playwright evidence capture
- Maestro mobile flows
- c64scope and agent tooling

That means regressions are more likely to occur at runtime boundaries than within isolated leaf components.

## Subsystem Deep Dives

### Runtime interaction model

The maintainer question about slider propagation was investigated directly. The evidence in `src/components/ui/slider.tsx` and `src/lib/ui/sliderBehavior.ts` shows that slider updates are already propagated continuously during drag through a coalesced async queue. The queue defaults to 120 ms throttling, and downstream write serialization can add further delay. The concern is therefore not that sliders are release-only; the concern is that downstream pacing can still create perceived lag.

### Connection liveness and freshness

The connection manager records probe timestamps correctly, and the device state store records request timestamps correctly. The operator-facing issue is that the connectivity indicator merges these timestamp domains and labels the result as `Last request`, even though it is really a last-observed-activity value. In addition, background rediscovery is scheduled only while in demo or offline states, not during quiet real-device sessions. Large freshness values are therefore expected under the current design and can look worse than they are.

### Web server

The web server posture is strong in several areas: session token generation is server-side and random, cookies are hardened with `HttpOnly` and `SameSite=Lax`, and login failure tracking exists. The main hardening defect found in this pass is a silent catch in static asset path decoding that returns a 400 response without logging or enriching the exception.

### Android and iOS

Android appears materially more release-ready than iOS based on current evidence. Android has stronger CI gating and stronger native testing posture. iOS does have active CI and Swift native-test infrastructure, but the repository's own parity documentation still records meaningful readiness gaps, and the overall release posture is clearly weaker than Android.

## Documentation Consistency Audit

Documentation quality is above average, but drift is real. The external docs, internal docs, and in-app docs broadly align in structure, yet Review 7 found contradictions and omissions including:

- feature references that are documented but not fully reflected in in-app docs
- coverage/gating explanations that have drifted from current implementation
- duplicated operator guidance across doc surfaces that is prone to divergence

The complete cross-map is in `artifacts/documentation-crossmap.md`.

## Test Coverage Evaluation

The test posture is strong and unusually broad. The repository includes:

- Vitest browser and node projects
- Playwright E2E and screenshot coverage
- Maestro mobile flows
- Android native tests
- iOS Swift native validation tests
- agent tests with their own branch coverage floor
- c64scope tests with their own hard thresholds

The important limitation is specificity. High aggregate coverage does not by itself prove the exact edge conditions that prompted this audit. Review 7 did not find direct regression proof for:

- repeated slider-to-device writes during drag before release
- intended freshness semantics for long quiet connected sessions

Those should be added as narrow deterministic regression tests.

## CI/CD Evaluation

CI is materially stronger than average for a repository of this size. It includes:

- multi-arch web container build/test flows
- Docker smoke checks with health endpoints
- screenshot regeneration
- sharded Playwright E2E
- compliance/notices drift checks
- coverage-build reuse across downstream jobs
- c64scope and auxiliary coverage enforcement

The main CI weakness is not lack of automation. It is distributed gate ownership. Important web-facing gates live across multiple workflows, and iOS remains less authoritative than Android in release gating.

## Security Evaluation

Within the user-requested audit boundaries, no immediate high-severity web-session design defect was found. The most meaningful positive signals were:

- cryptographically random session tokens
- hardened auth-cookie flags
- login failure blocking
- explicit host validation and header policy in the web runtime

The one code-level hardening defect found in this pass is the silent catch in `web/server/src/staticAssets.ts`.

## Production Risk Assessment

### Highest-risk findings

1. `web/server/src/staticAssets.ts` contains a silent catch that violates the repository's own exception-handling rule.
2. Connection freshness/status wording can mislead operators, especially during quiet healthy sessions.
3. iOS should not be treated as equally production-ready with Android.

### Medium-risk findings

1. Slider behavior is continuous at the UI layer, but downstream pacing still lacks end-to-end regression proof.
2. Documentation drift is meaningful enough to create operator or contributor confusion.
3. Cross-runtime seam complexity remains a real source of production risk.

### Low-risk findings

1. Aggregate coverage enforcement is strong.
2. CI breadth is strong.
3. Auxiliary subsystems such as agents and c64scope show solid quality posture.

## Required Fixes Before Production

### 1. Fix the silent catch in `web/server/src/staticAssets.ts`

Current behavior returns a client error but discards the exception context. This should be logged or rethrown with context to comply with repository hardening rules.

### 2. Make release statements platform-qualified

It is acceptable to treat Android/web as production-capable based on current evidence. It is not accurate to state the entire repository is uniformly production-ready across all platforms without qualification, because iOS remains a weaker readiness surface.

## Recommended Improvements

1. Rename or split the connectivity freshness display so it distinguishes request freshness from probe freshness.
2. Add a deterministic regression test for repeated slider writes during drag.
3. Add a deterministic regression test for long-idle connection freshness semantics.
4. Continue reducing duplication and drift across external docs and in-app docs.
5. Continue raising iOS maturity toward Android rather than presenting current parity.

## Final Production Readiness Verdict

### Repository-level verdict

Conditionally ready for production, with platform qualification.

### Web verdict

Near-ready, with one small but concrete hardening fix required in static asset exception handling.

### Android verdict

Production-ready based on current evidence and substantially stronger than the other runtime surfaces.

### iOS verdict

Not equivalently production-ready. iOS should be treated as a weaker release surface until its remaining maturity gaps are explicitly closed.

### Bottom line

If the silent catch in the web server is fixed and release messaging remains platform-qualified, Review 7 supports shipping the stronger repository surfaces. The evidence does not support claiming uniform all-platform production readiness without qualification.
