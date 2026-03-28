# Health Badge Overflow Fix Prompt

ROLE

You are a senior UI engineer working on the C64 Commander React + Vite + Capacitor app for Android, iOS, and web. Implement a minimal, safe, deterministic fix for the unified header health badge overflow issue, add regression coverage, and generate targeted header screenshots.

This repository has strict execution rules. Follow `AGENTS.md` and `.github/copilot-instructions.md` first.

You MUST create and maintain `PLANS.md` and `WORKLOG.md` at the repository root.

- `PLANS.md` is the authoritative execution plan.
- `WORKLOG.md` is a timestamped evidence log of progress, commands, validation, and screenshots produced.

Create both files first, then immediately begin implementation and continue autonomously until the task is complete.

READ FIRST

Read the smallest relevant set before editing:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/ux-guidelines.md`
5. `src/components/UnifiedHealthBadge.tsx`
6. `src/lib/diagnostics/healthModel.ts`
7. `src/components/AppBar.tsx`
8. `tests/unit/components/UnifiedHealthBadge.test.tsx`
9. `tests/unit/lib/diagnostics/healthModel.test.ts`
10. `playwright/connectionStatusLayout.spec.ts`
11. `playwright/layoutOverflow.spec.ts`
12. `playwright/screenshots.spec.ts`
13. `playwright/displayProfileViewports.ts`

TASK CLASSIFICATION

Classify this as `UI_CHANGE`.

Because screenshots under `docs/img/` will also change, treat it as a code change with documentation assets and validate accordingly. Follow the minimal screenshot update rule from `.github/copilot-instructions.md`.

CURRENT CODE REALITY

Ground your work in the existing implementation, not generic assumptions:

- The badge is `src/components/UnifiedHealthBadge.tsx`.
- The existing shared visible-text formatter is `getBadgeLabel()` in `src/lib/diagnostics/healthModel.ts`.
- Internal display profile ids are `compact`, `medium`, and `expanded`.
- User-facing labels are Small, Standard, and Large display, but code and tests use `compact`, `medium`, `expanded`.
- Current health states are `Healthy`, `Degraded`, `Unhealthy`, `Idle`, and `Unavailable`.
- Current connectivity states are `Online`, `Demo`, `Offline`, `Not yet connected`, and `Checking`.
- The badge already has critical behaviors that must be preserved:
  - click opens diagnostics via `requestDiagnosticsOpen("header")`
  - `data-testid="unified-health-badge"` stays stable
  - `data-overlay-critical="badge"` markers stay intact
  - existing offline and not-yet-connected behavior remains deterministic

GOAL

Fix the worst-case overflow risk in the app header without redesigning the header row.

The real issue is the badge text budget inside the existing `AppBar` layout, especially for long unhealthy/degraded states with large problem counts on `compact` and `medium` profiles.

NON-NEGOTIABLES

- Do not redesign `AppBar`.
- Do not introduce a new badge component.
- Do not remove the leading device/environment label.
- Do not dynamically reduce font size.
- Do not allow wrapping.
- Do not silently change offline or not-yet-connected copy.
- Do not break badge click behavior, aria behavior, or diagnostics integration.
- Do not bulk-refresh screenshots outside the touched header surface.
- Do not use Maestro for this task. Use the existing Playwright path.

TARGET BEHAVIOR

Preserve the current density pattern unless a narrower deterministic fix is impossible.

Visible badge grammar for connected/demo states:

- `compact`: `LEADING GLYPH COUNT?`
- `medium`: `LEADING GLYPH COUNT? HEALTH`
- `expanded`: `LEADING GLYPH HEALTH PROBLEM_SUFFIX?`

Where:

- `LEADING` is the existing leading label:
  - `DEMO` for demo connectivity
  - inferred connected device label such as `C64U`, `U64E`, `U64E2` for online/checking
- `GLYPH` comes from `HEALTH_GLYPHS`
- `HEALTH` remains the existing health label contract from `HealthState`
- `PROBLEM_SUFFIX` is expanded-only and keeps the existing format:
  - ` · 1 problem`
  - ` · 12 problems`
  - visually uppercased by existing typography classes

Count capping:

- Visible problem count must cap at `999+`
- Examples:
  - `12 -> 12`
  - `999 -> 999`
  - `1000 -> 999+`
  - `1808 -> 999+`

Important:

- This cap is for visible badge text.
- Preserve exact `problemCount` semantics internally.
- Do not reduce aria fidelity unless you have a concrete accessibility reason and test coverage.

Special states:

- `Healthy`, `Idle`, and `Unavailable` with zero visible problems must not show a count.
- Preserve the existing `Offline` and `Not yet connected` special cases.
- Preserve support for all existing badge health states:
  - `Healthy`
  - `Degraded`
  - `Unhealthy`
  - `Idle`
  - `Unavailable`

IMPLEMENTATION DIRECTION

Converge on one shared visible-text contract.

- Do not create a second independent formatter in the component.
- Extend or refactor the existing `getBadgeLabel()` path in `src/lib/diagnostics/healthModel.ts` so formatting rules live in one place.
- Update `UnifiedHealthBadge` to render from that shared contract with minimal span-level logic.

Styling must include a hard overflow safety net even if formatting is correct:

- keep `whitespace-nowrap`
- add badge-local width constraints so the badge cannot force header overflow
- prefer `min-w-0`, `max-w-full`, `overflow-hidden`, and `text-ellipsis` on the badge and/or the trailing text span
- keep the fix badge-local if possible
- only touch `src/components/AppBar.tsx` if strictly necessary to let the badge shrink within the existing flex row

Do not touch unrelated header, tab, or navigation layout code.

TEST REQUIREMENTS

You must add or update dedicated regression coverage. Use the existing seams instead of inventing new ones.

1. `tests/unit/lib/diagnostics/healthModel.test.ts`

Add a deterministic matrix for visible badge formatting using the shared formatter.

Required dimensions:

- profiles: `compact`, `medium`, `expanded`
- health states: `Healthy`, `Degraded`, `Unhealthy`, `Idle`, `Unavailable`
- counts: `0`, `1`, `12`, `999`, `1000`, `1808`

Required assertions:

- visible count cap is `999+`
- compact stays terse
- medium includes the health label
- expanded alone includes the problem suffix
- zero-problem healthy/idle/unavailable states do not render a count
- leading device/demo label is preserved
- offline and not-yet-connected behavior stays unchanged

2. `tests/unit/components/UnifiedHealthBadge.test.tsx`

Add DOM-focused regression coverage for the rendered component:

- no duplicated count rendering
- `whitespace-nowrap` remains present
- overflow safety classes are present
- leading label remains visible
- expanded problem suffix renders only where intended
- click still opens diagnostics with `"header"`

3. Browser-level regression

Add one targeted Playwright regression in the smallest honest file, likely:

- `playwright/connectionStatusLayout.spec.ts`, or
- `playwright/layoutOverflow.spec.ts`

This regression must prove the badge does not overflow in worst-case `medium` and `compact` header scenarios on `/settings`.

Prefer deterministic assertions such as:

- badge `scrollWidth <= clientWidth`
- header row `scrollWidth <= clientWidth`
- no document-level horizontal overflow
- badge remains visible

Do not explode the full matrix in Playwright if unit coverage already proves formatting.

SCREENSHOT REQUIREMENTS

Use the existing screenshot harness in `playwright/screenshots.spec.ts`.

Do not write a standalone screenshot script.

Use:

- `/settings` as the route
- the existing display-profile helpers from `playwright/displayProfileViewports.ts`
- the existing screenshot helpers in `playwright/screenshots.spec.ts`
- a locator screenshot for the header area only, not the full page

Screenshot scope:

- capture the app header area containing the `Settings` title and the badge
- do not capture the full page
- do not regenerate unrelated screenshot folders

Store new screenshots under:

- `docs/img/app/settings/header/`

Use internal profile ids in filenames:

- `badge-compact-healthy.png`
- `badge-medium-unhealthy-12.png`
- `badge-medium-unhealthy-999plus.png`
- `badge-expanded-degraded-12.png`
- `badge-expanded-degraded-999plus.png`

Minimum screenshot matrix:

- `Healthy` with no count for all 3 profiles
- `Degraded` with `12` for all 3 profiles
- `Degraded` with `1808 -> 999+` for all 3 profiles
- `Unhealthy` with `12` for all 3 profiles
- `Unhealthy` with `1808 -> 999+` for all 3 profiles

Add `Idle` or `Unavailable` screenshots only if the visible header output changes or if validation reveals a risk specific to those states.

VALIDATION

Before completion, run the smallest honest validation set required by repo policy for this UI code change:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`
- targeted Playwright covering:
  - the new overflow regression
  - the screenshot generation path you touched

Coverage is mandatory:

- global branch coverage must remain `>= 91%`

If tests or build fail, fix the root cause. Do not skip.

PLAN AND WORKLOG REQUIREMENTS

`PLANS.md` must include:

- task classification
- affected files
- implementation order
- test plan
- screenshot plan
- completion checklist

`WORKLOG.md` must include timestamped entries for:

- files inspected
- edits made
- commands run
- test results
- coverage result
- screenshot files written
- any issue encountered and resolution

EXECUTION MODEL

1. Create `PLANS.md`.
2. Create `WORKLOG.md`.
3. Read the required files.
4. Map the exact impact surface.
5. Implement the minimal fix.
6. Add/update regression tests.
7. Add/update the targeted Playwright overflow check.
8. Generate only the required header screenshots.
9. Run required validation.
10. Update `WORKLOG.md` with evidence and final results.
11. Stop only when all acceptance criteria are satisfied.

ACCEPTANCE CRITERIA

The task is complete only when:

- visible badge counts cap at `999+`
- the badge stays single-line
- the badge does not overflow the header in tested worst cases
- offline/not-yet-connected behavior is unchanged
- rendering logic converges on one shared formatting contract
- regression tests pass
- `npm run test:coverage` passes with branch coverage `>= 91%`
- build passes
- targeted header screenshots exist under `docs/img/app/settings/header/`
- `PLANS.md` and `WORKLOG.md` document the work and evidence

BEGIN NOW.
