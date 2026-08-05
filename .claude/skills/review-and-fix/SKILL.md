---
name: review-and-fix
description: >-
  Adversarially review the codebase against a set of acceptance criteria, close any
  implementation or test gap found, verify on hardware where the criteria touch input,
  Live View, audio or playback, then commit on a new branch and converge a PR to
  merge-ready (coverage threshold, all review comments resolved, CI green). Use when asked
  to "review and fix", "verify these acceptance criteria are implemented and tested", or to
  turn a list of acceptance criteria into a merge-ready PR end to end. Takes the acceptance
  criteria as its argument — paste them, or point at a file/issue that contains them.
---

# Review and fix

Turns a list of acceptance criteria into a merge-ready PR: verify what already exists,
close what is missing, prove it on hardware where hardware is the only thing that can
prove it, and drive the PR to green without leaving open threads.

**Input.** The acceptance criteria come in as this skill's `args` — inline text, or a
pointer to where they live (a plan doc, a GitHub issue, a pasted table). If a coverage
threshold or branch name is not stated, use this repo's own gate as the default (read it
from `codecov.yml` — currently 91% project + patch) rather than inventing a number, and
name the branch for what the criteria describe.

This is an **execution** skill, not an analysis one. Do not stop after producing a list of
gaps — close them, prove them, and carry the PR through to merge-ready unless genuinely
blocked (missing permissions, an external outage, hardware unavailable).

---

## 1. Ground yourself before assuming anything is missing

The single most valuable thing an adversarial review can find is that the work already
exists and is subtly wrong — not that it doesn't exist. Assuming a greenfield
implementation is needed, when 90% of it shipped in a prior PR, wastes the session
re-deriving what a `git log` would have shown in thirty seconds.

1. **Search for a spec first.** `docs/plans/**`, `docs/research/**`, and the PR history
   (`git log --oneline --all -- <area>`) for anything already covering this ground. A plan
   doc with a "Status: Draft" or an "As-built" section tells you immediately whether this
   is new work or a review of existing work.
2. **Search for the code.** Don't guess file names — `grep`/`find` for the nouns in the
   acceptance criteria across `src/`, then read the files that come back, not just their
   exports. A module whose tests assert the exact table in the acceptance criteria (cell by
   cell, not just "some behaviour") is a strong signal the requirement is already met;
   confirm it by re-deriving one or two cells yourself rather than trusting the test's own
   comment.
3. **Search for existing tests**, separately from the code — `find tests -iname
   "*<module>*"` — and read what they actually assert, not just that a file with a matching
   name exists.
4. **Check whether this has already been hardware-verified.** `docs/testing/hil-merge-gate.md`
   and any `docs/plans/**/*.md` "As-built"/"Hardware" section may already record a dated,
   evidenced run. A dated result from days ago is a *claim* to independently re-check
   (§4), not a substitute for checking — but it tells you what was already covered and
   saves you from re-deriving the whole hardware plan from scratch.

Only after this ground-truthing should you form a view on what is actually missing.

---

## 2. Map every acceptance-criteria clause to code and tests

Take the criteria apart clause by clause — not "is this feature done" but "does clause 3
specifically hold, and where is that proven." For each clause, record:

- The file(s) that implement it.
- The test(s) that assert it, and **what they actually assert** — a test file existing is
  not the same as the clause being covered. Read the assertions, not the `describe()`
  titles.
- Whether the assertion is against the acceptance criteria's own numbers (a literal table,
  a literal threshold) or only against the code's own internal consistency. A test that
  reproduces the implementation's own formula proves nothing; a test with the acceptance
  criteria's numbers hard-coded into it does.

Where the clause encodes something checkable by hand (a rotation table, a permutation, an
arithmetic relationship), work at least one non-trivial case by hand against the code's
logic before trusting either the code or its test. This is what catches a table that reads
correctly but was derived with a sign error the test happens to share.

---

## 3. Find gaps as concrete, uncovered lines — not a vibe

"Needs more tests" is not a finding. Run the project's coverage tool scoped to the files
that implement the criteria (not the whole repo — that buries the signal) and read the
**uncovered line numbers**, not just the percentage:

```bash
npx vitest run <touched test dirs/files> --coverage
```

For each uncovered range, read the source at that line and decide:

- **In scope**: it is part of the mechanism the acceptance criteria describe (an error
  branch in the module that implements clause 2, an untested state transition in the hook
  that drives clause 4). Close it.
- **Out of scope**: it belongs to a shared, general-purpose component the criteria touch
  only incidentally (a generic keyboard/joystick widget's unrelated display-density
  branch). Note it and move on — chasing every uncovered branch in every file a feature
  merely imports is a worse use of the session than proving the criteria themselves.

Coverage tools also miss functional gaps entirely: a control that exists in the UI but
whose acceptance-criteria-relevant *interaction* (choosing a specific option, not just
rendering the list of options) has no test at all. Cross-check each criteria clause against
its own describe block, the way §2 asks — a missing interaction test often shows up as
100% line coverage on a component whose most important `onChange` is never fired in any
test.

---

## 4. Implement and test the gaps

- Fix minimally. Match the surrounding code's own idiom rather than introducing a new
  pattern for one gap.
- Every regression test gets proven with the `prove-load-bearing` skill: remove the
  mechanism, watch the test go red, restore it. A test that passes with the fix removed is
  not a test.
- If a gap is genuinely a design decision rather than a bug (the acceptance criteria's
  literal wording was already deliberately superseded by a later, better mechanism — check
  the plan doc's own "deviations" section before assuming this), say so explicitly in the
  PR description rather than reimplementing the literal wording over a documented, reasoned
  improvement.

---

## 5. Verify on hardware where the criteria can lie to you in software

If the criteria touch physical input, orientation/rotation, Live View, audio, or playback,
a green unit-test suite is necessary but not sufficient — see
`docs/testing/hil-merge-gate.md` for why (every property in it has shipped broken while CI
was green). Use the `hil-attach` skill to attach, and prefer a purpose-built HIL script
under `tools/hil/` over ad hoc polling if one already exists for this area.

Rules that have each cost real time on this repo:

- **Confirm which build and which variant/edition is actually installed** before trusting
  any live default read. Two editions can be installed side by side
  (`adb shell pm list packages | grep c64`); a stale or wrong-edition build will show you a
  fabricated failure (or a fabricated pass) that has nothing to do with the code under
  review. Check `document.title` / the package's `lastUpdateTime` against the commit you're
  reviewing before drawing any conclusion from it.
- **Re-run a failing hardware check once before calling it a regression.** ADB key
  injection and Wi-Fi links both flake in ways that look exactly like a stuck input or a
  dropped frame. If a second run is clean, the first was rig noise — say so plainly rather
  than either hiding it or reporting a phantom regression; if it reproduces, it's real.
- **Measure, don't trust the app's own state.** Read the machine's own registers
  ($DC00 for joystick, screen RAM for what's displayed) or the DOM's actual geometry
  (`getBoundingClientRect`, computed `transform`) rather than asserting against a variable
  the app itself computed — that variable is exactly what could be wrong.
- **Put the rig back the way it was found**: restore any setting you toggled to reach a
  test state (Watch/Listen, pinned orientation, foregrounded app/edition), before ending
  the session.
- If no rig is available, say so explicitly in the PR and in the final report, and name
  the specific checks that were therefore not run. Do not describe them as verified.

---

## 6. Run the gates before staging anything

Use the `ship-gates` skill in full — typecheck (via `npm run typecheck`, never bare
`tsc`), eslint, prettier, the full unit suite, and native tests where relevant. Then check
coverage against the threshold this run was given (or the repo default, §"Input" above) on
the files the criteria actually touch, not only the project aggregate — a project-wide
number can hide a criteria-relevant file sitting well under the bar.

Strip local-build churn before staging (`THIRD_PARTY_NOTICES.md`, lockfiles — see
`ship-gates` for the exact list on this repo) and add explicit paths only, never `-A`.

---

## 7. Commit, branch, PR

- Never commit to `main`. Branch named for what the criteria describe.
- Write the PR description in the house style: plain engineering language, concrete nouns,
  previous behaviour vs. defect/gap vs. change vs. verification vs. rejected alternatives
  kept as separate statements, no cute phrasing, no unearned adjectives ("clean", "honest",
  "obvious") without naming the concrete property that makes it so. State exactly what
  hardware verification did and did not cover.
- Push and open the PR with `gh`.

---

## 8. Converge to merge-ready

This is the same loop as `.github/prompts/pr-converge.prompt.md` — reuse it rather than
reinventing it:

1. Pull every review comment via `gh`; investigate each one against the code, not just the
   comment text. Fix real issues (with a regression test, proven per §4), and reply +
   resolve every thread — including ones you conclude are not applicable, with a concrete
   technical reason.
2. Re-run the gates (§6) after every fix, push, and re-check CI (`gh pr checks`) — a check
   named for "unit tests" on this repo often runs a typecheck step first, so a red check
   there is not necessarily a test failure; read the step list before assuming.
3. If the change touches input/Live View/audio/playback, re-run the relevant
   `tools/hil/merge_gate.mjs` stage(s) after the fix, not only before it.
4. Do not end the run on "remaining gap", "I did not push", or "I did not resolve
   threads" — if any of those are still true, keep going.
5. Stop only when: every comment has a reply and its thread is resolved, all CI checks are
   green, the build succeeds, the relevant suites pass, coverage is at or above the target,
   and every commit is pushed.

---

## 9. Final report

State plainly:

- Which acceptance-criteria clauses were already implemented and tested, and where.
- Which gaps were found and closed, with the files touched.
- What hardware verification actually proved, on which build/edition, and what it could
  not cover (stale rig build, no hardware attached, etc.) — never claim more than was
  proven.
- The coverage number achieved against the target, on the criteria-relevant files.
- PR URL and converge status.
