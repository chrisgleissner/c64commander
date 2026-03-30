# Review 14 Implementation Prompt

ROLE

You are a staff-level implementation engineer and convergence owner. Your task is to fix the actionable issues identified in `docs/research/review-14/review-14.md` across runtime behavior, UI semantics, performance, tests, and documentation.

This is an implementation task, not another audit.

You must work from the code as it exists today. Do not blindly inherit older assumptions from Review 13 where Review 14 has already shown the codebase moved on.

---

OBJECTIVE

Bring the following areas to a stable, converged state:

1. Telnet-based Home and file-browser workflows
2. Cross-source playlist-model consistency
3. CommoServe add-to-playlist and playback behavior
4. HVSC lifecycle semantics and UX clarity
5. Interactive REST write performance for lighting sliders

The goal is not to ship partial improvements. Close the concrete gaps identified by Review 14 and leave the repository in a validated, documented state.

---

AUTHORITATIVE INPUTS

Use these as the source of truth:

- `docs/research/review-14/review-14.md`
- `README.md`
- `.github/copilot-instructions.md`
- `AGENTS.md`
- `docs/ux-guidelines.md`
- `src/pages/HomePage.tsx`
- `src/pages/home/components/MachineControls.tsx`
- `src/hooks/useTelnetActions.ts`
- `src/lib/telnet/*`
- `src/lib/reu/reuTelnetWorkflow.ts`
- `src/lib/config/configTelnetWorkflow.ts`
- `src/pages/playFiles/handlers/addFileSelections.ts`
- `src/lib/archive/*`
- `src/lib/sourceNavigation/archiveSourceAdapter.ts`
- `src/pages/playFiles/hooks/useHvscLibrary.ts`
- `src/pages/playFiles/components/HvscControls.tsx`
- `src/pages/home/components/LightingSummaryCard.tsx`
- `src/components/ui/slider.tsx`
- `src/lib/ui/sliderBehavior.ts`
- `src/hooks/useInteractiveConfigWrite.ts`
- the tests that currently lock in the old behavior

If code reality conflicts with stale documentation, fix the documentation after fixing the code.

---

MANDATORY EXECUTION MODEL

## Phase 1 - Read and classify

Before editing:

1. Read the authoritative inputs above.
2. Re-read the tests that currently codify the behaviors under change.
3. Classify the task according to repo rules.

Expected classification:

- `DOC_PLUS_CODE`

## Phase 2 - Implement in this order

1. Fix interactive slider write behavior
2. Converge Home reboot semantics
3. Harden telnet workflow automation
4. Converge the playlist model across source types
5. Rework CommoServe playlist-add and playback behavior
6. Clarify HVSC lifecycle semantics
7. Update tests
8. Update documentation
9. Refresh screenshots only if visible documented UI changed

Do not defer regression coverage to the end if a fix materially changes behavior. Add it as you lock each slice in.

## Phase 3 - Validate honestly

At minimum, the final validation must include:

1. `npm run test:coverage`
2. `npm run lint`
3. `npm run build`
4. targeted Playwright and/or Maestro validation for changed visible flows
5. screenshot refresh only for affected documented UI states

Coverage requirement:

- global branch coverage must remain `>= 91%`

If files under `agents/` change, also run `npm run test:agents`.

Do not claim validation you did not run.

---

REQUIRED END STATE

## A. Interactive lighting writes

Fix the LED slider lag at the root cause.

Requirements:

- eliminate duplicate final-value writes caused by using both preview and commit callbacks for the same slider interaction
- preserve responsive optimistic UI during drag
- keep the implementation deterministic and testable
- add/update regression tests proving the intended write contract

Acceptable outcomes include:

- preview writes while dragging and no duplicate commit write for an unchanged final value
- or commit-only writes if the UX remains acceptably responsive

Unacceptable outcome:

- keeping duplicate immediate writes and merely renaming the behavior

## B. Home reboot semantics

Converge the Home quick-action semantics to the intended canonical model.

Requirements:

- keep the visible `Reboot` action mapped to the REST API reboot endpoint
- keep `Reboot (Clear RAM)` in the Quick Actions overflow menu mapped to the telnet path
- keep keep-RAM and clear-memory variants distinct where both are still needed
- remove semantic ambiguity from labels and placement
- update regression coverage so it explicitly locks in this split model:
  - primary `Reboot` uses REST
  - overflow `Reboot (Clear RAM)` uses telnet

## C. Telnet workflow hardening

Improve robustness of workflow-heavy telnet paths, especially:

- REU save/restore flows
- config save/apply flows
- menu/file-browser navigation under latency or small screen-structure variance
- telnet rendering variance such as alternate ASCII border characters
- menu item reordering without semantic change

Requirements:

- reduce brittle dependence on fixed step counts or exact labels where feasible
- do not depend on exact border glyphs, box-drawing characters, or fixed menu positions when the same semantic screen can be recognized more robustly
- keep timeouts bounded and diagnosable
- do not silently swallow telnet errors
- add focused regression coverage for the brittle paths you change
- add explicit edge-case tests proving the telnet parser/navigator/workflows survive:
  - alternate border ASCII characters
  - reordered menu items where the labels still exist
  - realistic latency between screen transitions

Do not spend time rebuilding the low-level telnet transport if the real problem is workflow navigation.

## D. CommoServe add-to-playlist behavior

Rework the archive add flow so it does not behave like an uninterruptible foreground import job.

Requirements:

- first align CommoServe with the repository-wide playlist rule:
  - add-to-playlist stores stable source references and metadata
  - playback resolves runtime access
- move playlist add to a deferred-download model
- keep add-to-playlist lightweight by storing enough metadata to resolve and fetch the archive payload later at playback time
- add local caching so a successfully downloaded archive payload can be reused on subsequent plays
- thread cancellation through any remaining expensive archive work that still happens in the foreground
- make progress/error reporting honest for multi-item adds
- keep unsupported archive results diagnosable
- add regression coverage around the chosen behavior

Required model:

- avoid sequential foreground binary downloads during simple playlist selection
- perform the actual archive download when the item is played
- reuse a local cache when the same archive item is played again
- persist a clean archive reference model so the item can be rehydrated after app restart or playlist restore
- do not rely on transient in-memory `request.file` payloads as the long-term source of truth for CommoServe items
- ensure playback failures surface clear cache/download diagnostics

## E. Cross-source playlist consistency

Make the playlist model explicit and consistent across all source types.

Requirements:

- treat playlist items as stable references, not ad hoc containers for source-specific runtime state
- preserve the existing lightweight model already used by `ultimate`, `local`, and most of `hvsc`
- use runtime file wrappers only as a cache or execution convenience, not as the persisted source of truth
- ensure persistence and hydration follow the same model for every source type
- keep the resulting design easy to explain:
  - add stores references
  - play resolves access
  - caches optimize but do not redefine the model

For CommoServe specifically, persist enough archive identity to make the item debuggable and rehydratable, such as:

- archive source id
- archive result id
- archive category
- chosen playable entry id
- chosen playable entry path or file name
- cache key or equivalent stable lookup identifier

## F. CommoServe structural convergence

Decide whether CommoServe should:

- become a real source-navigation implementation
- or remain intentionally specialized

Either outcome is acceptable, but the repository should no longer sit in an accidental half-state.

Requirements:

- remove accidental divergence where it creates bugs
- document the chosen architecture
- keep the UI and execution path consistent with that choice

## G. HVSC lifecycle semantics

Clarify the HVSC state machine and copy so users can tell what stage they are in.

Requirements:

- distinguish cached/downloaded state from ingested/indexed/ready state
- ensure button labels, success text, and failure text describe the actual operation
- preserve existing working behavior unless Review 14’s evidence shows a real defect
- update tests for the revised wording and state transitions

Do not regress the existing HVSC coverage footprint.

## H. Documentation

Update the docs that are affected by the final implementation, which may include:

- `README.md`
- `src/pages/DocsPage.tsx`
- `docs/features-by-page.md`
- `docs/ux-interactions.md`
- relevant diagnostics or feature docs

The docs must describe the behavior that ships after this task, not the behavior that existed before it.

## I. Screenshots

Refresh screenshots only if the visible documented UI changes.

Likely candidates if your implementation changes the visuals:

- Home quick actions / overflow
- HVSC controls
- any visible CommoServe import states

Do not refresh unrelated screenshot folders.

---

DELIVERABLES

Before you stop, produce:

1. the code changes
2. the regression tests
3. the documentation updates
4. any required screenshot updates
5. a precise summary of what changed and which validations were actually run

The task is complete only when the repository behavior, tests, and docs all converge on the same model described by Review 14.
