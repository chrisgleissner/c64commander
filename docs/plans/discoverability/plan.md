# Discoverability — Implementation plan

Companion to `spec.md` (what to build, revision 2) and `prompt.md` (the kickoff for the implementing
agent). Read `spec.md` first; this document does not restate its decisions, it sequences them.

---

## 0. The mandate

**This is a one-shot implementation.** It runs to completion however long it takes. It is not done
when the code compiles, and it is not done when the tests pass. It is done when every line below is
true:

1. Every milestone in §2 is implemented.
2. Every row of `spec.md` §12 has a test that exists, runs, and passes.
3. The manual has been extended and rebuilt.
4. The screenshot corpus has been retaken, with the drift procedure in §5 applied.
5. `README.md` has been amended.
6. The local gates in §4 are green.
7. The HIL merge gate has passed, baselined first.
8. A pull request has been raised.
9. Every review comment on that pull request has been addressed.
10. Every CI check on that pull request is green.
11. The pull request is merged.
12. `main` is tagged `0.10.0-rc2` and the tag is pushed.

**Nothing is deferred, and nothing is reported as outstanding.** If a piece of the work turns out to
be harder than expected, it is still finished. If it turns out to be genuinely impossible, that is a
finding to raise with the user before continuing — not an item to leave in a list at the end.

`0.10.0-rc1` already exists, which is why the target is `0.10.0-rc2`.

---

## 1. Branch

Branch from `main`:

```bash
git fetch origin && git checkout -b feat/discoverability origin/main
```

Do not build on `feat/appearance-styles`. The renames in `spec.md` §10 touch the same files that
branch shipped, and rebasing a change of this size onto a moving base is avoidable work.

---

## 2. Milestones

The order matters: each milestone leaves the tree green, and each later one consumes what an earlier
one built.

### M1 — Appearance renames

`spec.md` §10. The smallest and most independent piece, so it goes first and proves the gates.

1. Capture the pre-rename token fixture **before changing anything**: run the compiler, and write
   every compiled token value into `tests/fixtures/appStyleTokens.pre-rename.json` keyed by the **new**
   id. This file is the only evidence that no colour changed, and it cannot be reconstructed once the
   YAML is edited.
2. Teach `scripts/compile-styles.mjs` about `renamed_from`: satisfy `checkNoSilentRetirement`, emit
   `APP_STYLE_RENAMES`, fail on a collision with a live id or a duplicate, and rewrite the now-false
   "Never renamed once shipped" contract comment.
3. Edit `styles/appearance-styles.yaml`: three keys, `renamed_from`, names, descriptions,
   `default_style`, `device_scheme_map`.
4. Regenerate: `npm run styles:build`.
5. Migrate at the storage read in `useAppStyle.readStoredStyleId`, and map the gallery's `?style=`
   parameter.
6. `git mv` the three showcase screenshots to their new names. Do not regenerate them here; §5 covers
   the corpus.
7. Update every text reference: `README.md`, `docs/internals/appearance-styles.md`,
   `tests/unit/pages/SettingsPage.test.tsx`, `tests/unit/lib/native/safeArea.systemBars.test.ts`,
   `playwright/appStylesGallery.spec.ts`.

Green before moving on: `npm run styles:check`, `npm run typecheck`, `npx vitest run`.

### M2 — The registry and the resolver

`spec.md` §5.1, §5.2, §5.3, §5.12, §5.13, §5.14. No user-visible surface yet.

1. `search/search-index.yaml` and `scripts/compile-search-index.mjs`, modelled on
   `scripts/compile-styles.mjs`. Wire `search:build` into `prebuild` beside `feature-flags:compile`,
   and `search:check` into `lint` beside `styles:check`.
2. `src/lib/search/handlers.ts` — the handler map, with its two contract tests.
3. `src/lib/search/requirements.ts` — the requirement resolver, with its exhaustiveness test.
4. `collapsibleSectionStore.requestSectionOpen(scope, id)`.
5. `src/lib/search/navigate.ts` — `navigateToSearchTarget`, including the guard consultation, the
   bounded wait, the landing highlight and the failure toast.
6. The Config page's `configItem` deep-link handler. Its own search box is not touched.
7. The reachability walk of §5.13.

Populating the YAML is the bulk of this milestone. Work page by page — Home, Play, Disks, Config,
Settings, Docs — and use `docs/cta-inventory.md` as the checklist of what exists. Every entry needs a
`requires` list that is honest about its gating; an entry that is enabled when its anchor cannot
render is a resolver timeout in front of a user.

### M3 — The search overlay

`spec.md` §5.5 to §5.11.

1. The scorer, as a pure module, with the table-driven ranking test and the deterministic work gate.
2. The overlay component, with its own keydown handler and `data-key-nav-skip` on the result list. The
   engine's behaviour in §5.7 is the constraint that shapes this component; read it before writing it.
3. Tier 1 registration from the existing stores.
4. Tier 2 delegation: `useHvscArchiveSearch` unchanged, the config item index, the disk library.
5. The three doors: the Home field (M4 places it), the Quick Menu's top entry with its
   close-then-open sequencing, and the dedicated `7` listener of §9.1.
6. `c64u_search_recent:v1` and `c64u_search_picked:v1`, both capped.

### M4 — Home

`spec.md` §6 and §7.

1. The presentation-level closed override in `CollapsibleSection` that suppresses the body without
   writing to the store, plus its test.
2. The settled-offline hook of §7.2, plus the flap test.
3. The search field, the Listen and play block, and the Connect a C64 card.
4. `recentlyPlayed` v2 with its migration.
5. The four tiles, each with its disabled reason.
6. `/play?radio=1` handling on the Play page.
7. **Migrate the automation the reorder breaks**, in this same milestone, not later:
   `tools/hil/merge_gate.mjs:170`, `playwright/video.spec.ts:116`,
   `playwright/screenshot-catalog.json`, `playwright/homeScreenshotLayout.ts`,
   `tests/unit/readmeScreenshotCoverage.test.ts:29`.

### M5 — Keypad and the Key Explorer

`spec.md` §9.

1. `openSearch`, `mediaPlayPause`, `mediaNext` added to `SemanticAction` and `SEMANTIC_ACTIONS`.
2. The dedicated `7` listener, outside `FocusNavigationProvider`, with its
   `keypad_input_enabled: false` test.
3. `TAB_ROUTES.length < 7` assertion.
4. F1 and F3 in `profiles/keypad.ts` only, with the desktop-profile regression test.
5. The latched command bus with its 5 s expiry, and the Play consumer.
6. The Key Explorer panel with its own capture listener, active only while open.

### M6 — The tour

`spec.md` §8.

1. The step descriptors, with `testIds` as a list.
2. The driver: interstitial sequencing, swipe disable, union-rect measurement, four-rectangle scrim,
   re-measure on scroll and resize, degrade-to-caption.
3. `c64u_tour_state:v1`, the Docs card, the Settings → About row, and the offer-once-after-connect row.

### M7 — Documentation, manual, screenshots, README

§5 and §6 below.

---

## 3. Two traps this repo has already been bitten by

**Do not run `npm install`, and do not run `./build`.** Both rewrite `package-lock.json` and prune
`@emnapi`, which turns roughly ten CI jobs red. If a build is needed, use the project's own script and
then strip the churn:

```bash
git checkout -- THIRD_PARTY_NOTICES.md package-lock.json c64scope/package-lock.json
```

**Never `git add -A`.** Stage explicit paths and read `git status --short` before every commit. An
automation on this repo auto-commits and pushes the working tree mid-session; if work appears to have
vanished, check `git log` before redoing it.

---

## 4. Local gates, in order

These are the gates CI runs. Run all of them before pushing.

```bash
npm run typecheck        # NOT bare `tsc --noEmit` — that uses the root config and accepts
                         # what tsconfig.app.json rejects. It has turned a green PR red here.
npx eslint .
npx prettier --check "src/**/*.{ts,tsx}" "tests/**/*.{ts,tsx}"
npm run styles:check
npm run search:check
npx vitest run                                  # ~5 min, run in the background
cd android && ./gradlew :app:testDebugUnitTest  # ~3 min, run in the background
```

Then the HIL merge gate. **Baseline the base commit first** — this gate fails on `main` too, and a
failure that predates the branch must not be mistaken for a regression:

```bash
node tools/hil/merge_gate.mjs --only <stage>   # against the base commit, to establish the baseline
node tools/hil/merge_gate.mjs                  # against the branch
```

The rig has preconditions of its own: Wi-Fi on, native display geometry with no leftover `wm size`
override, and the machine reset. A stale `wm size` from an earlier session fails the input and
clarity stages with no code fault at all.

---

## 5. The screenshot corpus

The corpus must be retaken — the Home reorder, the search field and the style renames all change what
the images show. It is also the single most drift-prone step in this repo: a blind full rerun rewrites
roughly 203 PNGs, most of them with environment noise rather than real change.

The procedure:

```bash
npm run screenshots
git status --short docs/img | wc -l          # expect ~203 touched
```

Then triage rather than commit:

1. List the touched files and separate them into **intended** (Home, the search overlay, the tour, the
   three renamed style showcases, Settings → Appearance) and **incidental** (everything else).
2. Inspect a sample of the incidental ones. If the visible difference is antialiasing, a clock, a
   version string or a scrollbar, it is drift.
3. `git checkout -- <path>` every incidental file.
4. Stage only the intended ones, and look at each before staging it.

`tests/unit/readmeScreenshotCoverage.test.ts` and `playwright/screenshot-catalog.json` must be updated
alongside, or the coverage test fails on the new slices.

---

## 6. Manual and README

**The manual markdown is generated.** `docs/manual/**/*.md` is written by
`scripts/build-manuals.mjs`, and edits to it are wiped on the next build. The prose lives inside that
script. What must change there:

- The keypad shortcut table — `7` for search, F1 and F3 for transport, and a line saying the Commodore
  key is not yet bound.
- A section on search: the three doors, what it finds, and that a disabled result says why.
- A section on the tour: that it runs on first launch, can be skipped, and is restartable from Docs and
  from Settings → About.
- The Home chapter: the new Listen and play block and what Home shows with no C64 connected.
- The Appearance chapter: the three new style names.

Rebuild the manual and the PDF afterwards, and check that the PDF is still A4 — `marks: none` in the
`@page` rule is what keeps it so.

`README.md` needs: the Appearance Styles table and its three showcase captions, a feature bullet for
search, a feature bullet for the tour, and the new Home screenshots.

---

## 7. Pull request

The PR description follows the repo's own rules: plain engineering language, previous behaviour and
the defect stated separately from the change and from how it was verified, and no marketing.

**Commit messages and the PR body must stay agnostic of the build variant.** Plan documents may name
hardware; the commits and the PR must not name a variant, a handset or a partner.

Then, and this is part of the mandate rather than a follow-up:

1. Watch CI to completion. Use the until-loop pattern rather than polling, and make the filter cover
   failures as well as passes — a filter that greps only for passes stays silent through a crashloop.
2. Read every review comment and address it in code. A reply that argues without a change is only
   acceptable when the comment is factually wrong, and then the reply must say why with evidence.
3. A green signal is not readiness. `mergeStateStatus: CLEAN` with unresolved review threads is not
   merge-ready. Check both.
4. Merge.
5. Tag and push:

```bash
git checkout main && git pull
git tag 0.10.0-rc2 && git push origin 0.10.0-rc2
```

---

## 8. Definition of done

Copy this list into the final report and mark each item with the evidence for it — a command output, a
test name, a file path, a PR number, a tag. An item without evidence is not done.

- [ ] M1 renames, with the pre-rename token fixture proving no colour changed
- [ ] M2 registry, resolver and reachability walk
- [ ] M3 search overlay, scorer and three doors
- [ ] M4 Home, offline arrangement, four tiles, and the migrated automation
- [ ] M5 keypad bindings, latched bus and Key Explorer
- [ ] M6 tour
- [ ] Every row of `spec.md` §12 has a passing test
- [ ] Manual extended and rebuilt; PDF still A4
- [ ] Screenshots retaken, drift triaged, catalogue and coverage test updated
- [ ] `README.md` amended
- [ ] Local gates green
- [ ] HIL merge gate green, baselined first
- [ ] PR raised
- [ ] All PR comments addressed
- [ ] All CI checks green, no unresolved threads
- [ ] PR merged
- [ ] `0.10.0-rc2` tagged and pushed
