# CI Stabilization Plan: Playwright install latency + flaky UI E2E

## Scope
- Workflow: `/.github/workflows/android.yaml` (`Web | E2E (sharded)`)
- Test: `playwright/ui.spec.ts` (`UI coverage › config widgets read/write and refresh`)

## Track A — CI install-time reduction via Playwright container

### Observations (from logs/code)
- `Web | E2E (sharded)` currently runs `npx playwright install --with-deps` in every shard.
- The same job currently carries a Playwright browser cache and an apt-repo workaround step, indicating host-level browser dependency installation is expected.
- In failed shard job logs (run `22412765615`, job `64890551298`), Playwright install enters `Installing dependencies...` and executes apt package resolution/installation.
- Project Node in CI is `24` (`actions/setup-node@v4`), and lockfile currently resolves `@playwright/test` to `1.57.0`.

### Hypotheses
- The long-tail shard setup time is caused by `--with-deps` triggering OS package installation on ubuntu runners.
- Using the official Playwright container image aligned with lockfile Playwright version will eliminate apt-based browser dependency installs and reduce setup variance.

### Implementation steps
1. Update `web-e2e` job to run in Playwright container image (`mcr.microsoft.com/playwright:v1.57.0-noble`).
2. Remove Playwright apt/workaround/cached-browser/install steps from `web-e2e`.
3. Keep existing shard selection/execution behavior unchanged.
4. Keep Node setup at v24 in job for engine alignment.

### Validation steps
- Verify workflow has no `playwright install --with-deps` in sharded job.
- Verify sharded job has no apt Playwright dependency install steps.
- Run local syntax/format validation for changed YAML via repo lint/build checks.
- Observe CI shard setup timings after push.

### Risks and mitigations
- Risk: Container image Playwright version mismatch with lockfile can cause browser protocol mismatch.
  - Mitigation: Pin container tag to lockfile-resolved Playwright version.
- Risk: Container runtime changes environment assumptions.
  - Mitigation: Keep existing Node setup and shard command behavior unchanged.

## Track B — Flaky test stabilization

### Observations (from logs/code)
- Failed shard log shows flake at `playwright/ui.spec.ts:146:3` with assertion failure at line 192:
  - `expect(getByLabel('System Mode select')).toContainText('NTSC')`
  - error: `element(s) not found`.
- In the test, `U64 Specific Settings` section is toggled via button click immediately before that assertion.
- Toggle semantics mean the final click can collapse an already-open section, making the select element absent.

### Hypotheses
- The test is nondeterministic because it uses unconditional toggle click instead of enforcing an expanded/visible target state before asserting text.

### Implementation steps
1. Replace unconditional final section click with deterministic "ensure target control is present" logic.
2. Assert visibility before text assertion to eliminate race/state ambiguity.
3. Keep functional assertions (server state + refreshed UI value) unchanged.

### Validation steps
- Run the flaky test repeatedly in CI-like command path (single spec).
- Run targeted Playwright UI spec affected area.
- Run repository-required lint/test/build and coverage gate before completion.

### Risks and mitigations
- Risk: Overfitting to one rendering path.
  - Mitigation: Gate on control presence, not timing sleeps; preserve full value assertions.
- Risk: Reduced coverage if assertions are weakened.
  - Mitigation: Keep existing assertions and add state-deterministic precondition only.

## Measurement & Evidence

### Before
- Install behavior: Sharded job executes `npx playwright install --with-deps` and apt dependency install (`Installing dependencies...` present in logs).
- Flake evidence: Run `22412765615`, shard job `64890551298` failed at `playwright/ui.spec.ts:146:3` with missing `System Mode select` locator.

### After
- Pending implementation + validation.

