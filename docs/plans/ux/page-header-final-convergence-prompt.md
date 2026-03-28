# Page Header Final Convergence Prompt

## Role

You are a senior UI engineer and calm-design specialist working on the C64 Commander React + Vite + Capacitor app at `/home/chris/dev/c64/c64commander`.

Implement the final, high-confidence convergence pass for the main page header and, where necessary, the fixed footer chrome so the app feels intentionally framed, calm, space-efficient, and structurally unified on small mobile screens.

Read and follow `AGENTS.md` and `.github/copilot-instructions.md` first.

This is not a generic “make the header smaller” task.

This pass exists to finish the top/bottom app chrome so that:

- the header feels like the top edge of the page shell
- the footer feels like the matching bottom rail
- the content feels anchored between them
- the app uses scarce vertical space well without feeling cramped
- the result adheres strongly to calm-design principles instead of looking merely “dense”

## High-Level Design Objective

The current app chrome is close, but still visually unresolved.

The main issue is not only height.

The real issue is that the header does not yet read as either:

1. a strong framing rail that mirrors the footer
2. a natural, tightly integrated top edge of the content below

Instead, it still reads too much like a separate band with a title and badge placed inside it.

Your job is to resolve that ambiguity.

The final state should feel like this:

- one coherent app shell
- top rail
- content
- bottom rail

The top rail should be quieter than the footer because it carries less information, but it must still clearly belong to the same chrome system.

## Mandatory Read Order

Read only this minimum set before editing:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/ux-guidelines.md`
5. `docs/plans/ux/page-header-density-research.md`
6. `docs/plans/ux/page-header-density-fix-prompt.md`
7. `src/components/AppBar.tsx`
8. `src/components/UnifiedHealthBadge.tsx`
9. `src/components/TabBar.tsx`
10. `src/components/layout/AppChromeContext.tsx`
11. `src/components/layout/PageContainer.tsx`
12. `src/hooks/useDisplayProfile.tsx`
13. `src/lib/displayProfiles.ts`
14. `src/pages/HomePage.tsx`
15. `src/index.css`
16. `src/components/ui/interstitialStyles.ts`
17. `src/components/ui/app-surface.tsx`
18. `tests/unit/components/AppBar.test.tsx`
19. `tests/unit/components/AppBar.layout.test.tsx`
20. `tests/unit/components/UnifiedHealthBadge.test.tsx`
21. `tests/unit/components/ui/interstitialStyles.test.ts`
22. `tests/unit/pageShellClearance.test.ts`
23. `playwright/layoutOverflow.spec.ts`
24. `playwright/modalConsistency.spec.ts`
25. `playwright/screenshots.spec.ts`
26. `playwright/displayProfileViewports.ts`

Also review these reference captures before making visual decisions:

- `docs/plans/hvsc/artifacts/20260328T150405Z/hil/settings.png`
- `docs/plans/hvsc/artifacts/20260328T150405Z/hil/play-route.png`
- `docs/plans/hvsc/artifacts/20260328T150405Z/hil/add-items.png`
- `docs/img/app/home/00-overview-light.png`
- `docs/img/app/home/01-overview-dark.png`

## Task Classification

Classify this as `UI_CHANGE`.

This is a code change with screenshot impact.

Follow the minimal screenshot update rule from `.github/copilot-instructions.md`.

## Final Diagnosis You Must Internalize

The previous density pass improved the header, but it did not fully solve the page-chrome problem.

The remaining issues are:

1. The header still feels visually emptier than the footer.
2. The header still feels too detached from the content below.
3. The app does not yet achieve a strong top/bottom framing effect.
4. In dark mode, header/footer chrome can feel like different surfaces, which exaggerates the separation.
5. In light mode, the surface mismatch is much less of an issue, which proves that color mismatch is an amplifier, not the universal root cause.
6. The root problem across modes is structural integration:
   - weak top rail identity
   - weak handoff from header to first content block
   - top chrome that still reads as a strip rather than shell

Do not misdiagnose this as a pure height problem.

If you only reduce header height again, you risk making the app bottom-heavy without fixing the framing problem.

## Product Decision

Ship a final convergence pass that makes the header and footer feel like one app-chrome system.

This means:

- unify the top and bottom rails into the same visual family
- tighten the transition from header to content
- keep the header calm, compact, and stable
- preserve the page title and always-visible badge
- preserve the footer navigation pattern
- avoid decorative redesign

This is a refinement pass, not a re-theme and not a layout rewrite.

## Current Repo Reality You Must Account For

- `src/components/AppBar.tsx` owns the main page header.
- `src/components/UnifiedHealthBadge.tsx` owns the always-visible diagnostics/status badge.
- `src/components/TabBar.tsx` and `.tab-bar` in `src/index.css` define the fixed bottom rail.
- `src/components/layout/AppChromeContext.tsx` and `src/components/layout/PageContainer.tsx` control reserved shell clearance and the handoff from chrome to page content.
- `src/components/ui/interstitialStyles.ts` and `src/components/ui/app-surface.tsx` already encode the shared overlay safe-zone model around the header title and badge.
- `src/pages/HomePage.tsx` uses custom leading content and must remain intentional.
- The footer already feels stronger and more intentional than the header.
- The light-mode screenshots show that the header/footer color mismatch is not the primary issue in every mode.
- The dark-mode screenshots show that mismatched chrome surfaces make the separation feel worse.

## Design Goal

Make the app feel framed and calm.

The user-visible outcome should be:

- the header reads as a true top rail
- the footer reads as the matching bottom rail
- the first content block feels anchored to the header instead of dropped below it
- the header wastes less space, but still breathes
- the title and badge remain a coherent, stable row
- the badge remains obviously interactive but visually calm
- dark mode no longer exaggerates a split between top and bottom chrome
- light mode remains clean and should not be over-corrected

## Non-Negotiables

- Do not remove the visible page title.
- Do not remove the always-visible badge.
- Do not make the badge float over page content.
- Do not reduce the badge hit target below accessibility expectations.
- Do not add filler content to the header just to make it feel “less empty”.
- Do not redesign the footer into a different navigation paradigm.
- Do not make the header and footer match by brute-force equal height.
- Do not introduce page-specific bespoke header variants.
- Do not break Home logo/title alignment.
- Do not break `--app-bar-height` publication.
- Do not weaken title/badge safe-zone protections for bottom sheets.
- Do not broaden the visual system beyond header/footer/page-shell convergence.

## What Good Looks Like

The final header should feel:

- calm
- structural
- attached
- quiet
- peripheral
- space-efficient
- deliberate

It should not feel:

- empty
- detached
- decorative
- like a floating banner
- top-light against a heavy footer
- like a hero header
- like a capsule/status button dropped into spare space

## Concrete Implementation Direction

### 1. Unify header and footer into one chrome family

This is the highest-priority fix.

The top and bottom rails must share the same visual language.

Do this by aligning:

- background surface tone
- divider/border weight
- horizontal inset rhythm
- shadow restraint

Specific direction:

- In light mode:
  - keep the header/footer on the same or near-identical white/light surface family
  - do not introduce extra contrast for the sake of “separation”
- In dark mode:
  - bring header and footer onto the same or near-identical chrome surface family
  - remove the obvious feeling that the header is on a different band than the footer

Do not solve this with stronger shadows.

Prefer:

- same surface token, or
- two extremely close tokens that still read as one family

### 2. Tighten the handoff from header to content

This is the second highest-priority fix.

The first content block should feel attached to the header.

Specific direction:

- reduce the vertical gap between the header divider and the first card/first section
- keep the reduction local to the first handoff below the header
- do not globally compress all page spacing

Target rhythm on phone:

- initial gap below header divider should be in the `8px` to `12px` range
- it should not feel like an extra blank band
- it should still leave enough air that the first card does not crash into the chrome

This should be achieved through shared shell/page spacing, not per-page hacks.

### 3. Trim header height by reducing non-functional padding only

The header can still shrink a little, but only a little.

Do not optimize for smallest possible height.

Optimize for:

- compactness
- presence
- composure

Specific direction:

- preserve a single stable row
- preserve the badge hit target at `44px` minimum
- reduce only the non-functional vertical padding around the row
- keep title and badge vertically centered

Preferred target on phone:

- content row around `48px` minimum height
- rail padding around `6px` above and below the row

If the current implementation already lands close to this, do not force exact numbers. Favor optical result over rote arithmetic.

### 4. Keep the badge embedded in the rail

The badge should feel like persistent peripheral status with secondary action behavior.

Specific direction:

- keep it in the same row as the title
- keep it inside the same chrome background as the rest of the header
- keep hover, focus, and pressed affordance
- reduce any remaining “separate pill button floating in space” feeling

Do not make it ambiguous.

Do not turn it into plain text.

Do not make it visually louder than the title.

### 5. Mirror the footer by language, not by naive size equality

The footer naturally needs more visual mass because it contains:

- icons
- labels
- active state
- navigation semantics

The header contains less information and should remain lighter.

So:

- match material and rhythm
- do not enforce equal total height
- do not try to “compensate” with extra empty top padding

What should mirror:

- chrome family
- border/divider language
- shell insets
- calm structural presence

What can differ:

- exact height
- content density
- safe-area treatment

### 6. Remove or further reduce top-floating-card styling

If the header still reads like a floating strip, reduce that effect.

Specific direction:

- prefer border-led separation
- use little or no perceptible drop shadow
- avoid mixed signals where the footer is border-led and the header is shadow-led

If you keep a shadow, it should be barely noticeable.

### 7. Preserve and re-evaluate sheet positioning after chrome convergence

If header height or the top/content handoff changes, shared sheet-top math must stay correct.

That means:

- bottom sheets still must not overlap title text
- bottom sheets still must not overlap badge critical content
- the recovered top space should be used where legitimate
- no stale assumptions about older header height may remain

Do this in the shared overlay system only.

### 8. Preserve Home quality explicitly

Home uses logo + title leading content and is the best test of whether the header feels truly resolved.

The Home header must:

- remain vertically centered
- avoid looking oversized
- avoid looking cramped
- align visually with content below and footer below

If Home looks wrong, the solution is not finished.

## Explicit Anti-Patterns

Do not do any of the following:

- do not add a subtitle or decorative secondary row
- do not add filler icons or extra controls to make the header feel busier
- do not introduce a large gradient or flourish to “solve” emptiness
- do not keep a visibly different dark-mode header color just because it looks dramatic
- do not leave a generous blank handoff between header and content
- do not keep a large badge capsule if it still reads detached
- do not shrink the header so much that the footer dominates the screen

## Files Most Likely to Change

- `src/components/AppBar.tsx`
- `src/components/UnifiedHealthBadge.tsx`
- `src/components/TabBar.tsx`
- `src/components/layout/PageContainer.tsx`
- `src/components/layout/AppChromeContext.tsx`
- `src/hooks/useDisplayProfile.tsx`
- `src/lib/displayProfiles.ts`
- `src/index.css`
- `src/pages/HomePage.tsx`
- `src/components/ui/interstitialStyles.ts`
- `src/components/ui/app-surface.tsx`
- `tests/unit/components/AppBar.test.tsx`
- `tests/unit/components/AppBar.layout.test.tsx`
- `tests/unit/components/UnifiedHealthBadge.test.tsx`
- `tests/unit/components/ui/interstitialStyles.test.ts`
- `tests/unit/pageShellClearance.test.ts`
- `playwright/layoutOverflow.spec.ts`
- `playwright/modalConsistency.spec.ts`
- `playwright/screenshots.spec.ts`

Touch other files only if strictly necessary.

## Test Requirements

You must update tests honestly to reflect the final chrome contract.

### Unit

Update the relevant unit tests so they prove:

- the header and footer now belong to the same chrome family in the intended way
- the header still renders a single coherent row
- the badge remains present and accessible
- the title remains present
- the initial content handoff below the header is tighter and intentional
- Home leading content still aligns correctly
- the shared sheet-safe-zone math remains correct

### Playwright

Update or add the smallest honest Playwright coverage to prove:

- the header no longer reads as a detached band
- the visible top/bottom chrome family is converged, especially in dark mode
- the badge stays inside the header
- the first content block starts closer to the header than before
- bottom sheets still clear the title and badge critical content
- compact, medium, and expanded remain coherent

Prefer deterministic geometry and computed-style checks where possible.

### Validation

Because this is a `UI_CHANGE`, before completion run the required honest validation set:

1. `npm run lint`
2. `npm run test:coverage`
3. `npm run build`
4. the smallest targeted Playwright suite that proves the final chrome convergence

Do not skip failures.

If unrelated existing repo failures block completion, identify them precisely and keep your new coverage focused and honest.

## Screenshot Requirements

This refinement affects visible app chrome, and for this final convergence pass you must not pre-restrict screenshot capture to an a priori subset.

For this task, regenerate against the entirety of the maintained screenshot corpus under `docs/img/app`.

Use the repository’s built-in screenshot deduplication workflow rather than attempting to hand-curate a partial run up front.

Specific direction:

- use the existing full screenshot harness, not a manually narrowed subset
- rely on the built-in dedupe/prune mechanism to prevent redundant unchanged PNGs from surviving
- prefer the repo-standard wrapper workflow that runs screenshot capture together with identical-PNG pruning
- do not assume in advance that only the obvious header-visible files will change; let the full corpus run prove that

However, the full-corpus run is not sufficient by itself.

After regeneration, perform explicit sanity checks that deduplication actually worked.

Required post-run checks:

- inspect the resulting `git diff --name-only` for `docs/img/app`
- verify that unchanged visual outputs were pruned rather than left as redundant PNG rewrites
- verify that no visually identical PNG files are being added or churned unnecessarily in the commit history
- if the dedupe/prune step failed to collapse redundant images, investigate and fix that before completion

Expected result:

- the run may inspect the full `docs/img/app` corpus
- the final diff should retain only the screenshots whose visible output truly changed
- redundant identical PNG rewrites must not remain in the commit

## Acceptance Criteria

The work is complete only when all of the following are true:

1. The header reads as a true top rail rather than a detached band.
2. The footer still reads as the bottom rail, and both rails belong to the same chrome family.
3. The content below the header feels anchored to it.
4. The initial gap below the header is tighter and intentional, not a blank band.
5. The header is slightly smaller or tighter than before, but not insubstantial.
6. The title remains visible and stable.
7. The badge remains visible, accessible, interactive, and calm.
8. The badge feels integrated into the header row rather than dropped into spare space.
9. Dark mode no longer exaggerates a split between header and footer surfaces.
10. Light mode remains clean and is not made worse by over-correction.
11. Home leading content still feels deliberate.
12. Bottom sheets still respect title and badge safe zones.
13. The footer navigation pattern remains unchanged.
14. The screenshot run covers the maintained `docs/img/app` corpus, but the final diff retains only genuinely changed visual outputs after dedupe/prune.
15. No redundant visually identical PNG files are added or churned in git history.

## Completion Notes

When you finish, report:

- what changed
- which tests and builds were run
- which screenshot files or folders were updated
- which full screenshot command/workflow was used
- what sanity checks were performed to confirm deduplication/pruning worked
- why the remaining screenshot diff is the correct minimal post-dedupe result
