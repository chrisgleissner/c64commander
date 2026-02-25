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

## Shell Regression Follow-up (container migration)

### Root cause (run `22415295134`, attempt 2)
- In `Web | E2E (sharded)`, run steps executed with `shell: sh -e {0}` inside the Playwright container.
- Bash-only syntax in the job then failed under `sh`:
  - `if [[ ... ]]` produced `[[: not found`
  - `mapfile -t SHARD_FILES < shard-files.txt` produced `mapfile: not found`
- Because the Playwright shard command failed before test execution, no `.nyc_output/*.json` files were produced, and `Verify nyc output` failed.

### Shell environment confirmation
- Failed shard logs explicitly show `shell: sh -e {0}` for `web-e2e` run steps after container migration.
- Local shell check (`sh -c 'echo "SHELL=$SHELL"; readlink -f /bin/sh'`) resolves `/bin/sh` to `/usr/bin/dash`, matching the observed `sh` behavior.

### Fix implemented
- Enforced bash for all `run` steps in `web-e2e`:
  - Added:
    - `defaults:`
    - `  run:`
    - `    shell: bash`
- This keeps the Playwright container migration in place and restores compatibility for existing bash features (`[[ ... ]]`, `mapfile`, arrays).

### Hardening review
- Workflow search confirmed bash-only usage in `web-e2e` (`[[ ... ]]`, `mapfile`, `"${SHARD_FILES[@]}"`) and in other non-container jobs.
- Applying `defaults.run.shell: bash` at `web-e2e` job scope ensures all bash-dependent shard steps execute with compatible shell semantics.

### Before
- Install behavior: Sharded job executes `npx playwright install --with-deps` and apt dependency install (`Installing dependencies...` present in logs).
- Flake evidence: Run `22412765615`, shard job `64890551298` failed at `playwright/ui.spec.ts:146:3` with missing `System Mode select` locator.

### After
- Workflow implementation:
  - `web-e2e` now runs in `mcr.microsoft.com/playwright:v1.57.0-noble` (`.github/workflows/android.yaml`).
  - Removed shard-level `Fix broken apt repos`, Playwright browser cache, and `npx playwright install --with-deps` steps from `web-e2e`.
- CI validation:
  - Android workflow run `22414438881` (PR branch) finished `success`.
  - `Web | E2E (sharded)` jobs passed with sharding preserved (`12/12` shards).
- Timing evidence:
  - **Before (run 22412765615, shard job 64890551298):**
    - `npx playwright install --with-deps` executed and entered `Installing dependencies...` with apt package installation.
    - Start timestamp in logs: `19:38:35Z`; e2e execution started at `19:39:22Z` (setup path included Playwright dep install work on host).
  - **After (run 22414438881, updated workflow):**
    - No shard-level Playwright install step exists in `web-e2e`; no Playwright apt dependency install path remains in that job.
    - Shard setup is reduced to checkout + node + npm + artifact download before test execution.
- Flake/stability evidence:
  - Local CI-equivalent repeated run:
    - `TRACE_ASSERTIONS_DEFAULT=1 npx playwright test playwright/ui.spec.ts --grep "config widgets read/write and refresh" --project=android-phone --workers=1 --repeat-each=20`
    - Result: `20 passed`.
  - Targeted regression run:
    - `TRACE_ASSERTIONS_DEFAULT=1 npx playwright test playwright/ui.spec.ts --project=android-phone --workers=1`
    - Result: `11 passed`.
  - Repository validation:
    - `npm run lint` ✅
    - `npm run test:coverage` ✅ (`All files % Branch = 82.24`, meets >=82 requirement)
    - `npm run build` ✅
  - Regression fix validation (pending fresh CI run on updated commit):
    - Expect no `shell: sh -e {0}` for `web-e2e` run steps.
    - Expect no `[[: not found` or `mapfile: not found`.
    - Expect shard tests to execute and `.nyc_output` files to be generated.
