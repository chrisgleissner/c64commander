# Discoverability — kickoff prompt

Give this to the implementing agent verbatim.

---

## Your task

Implement `docs/plans/discoverability/spec.md` following `docs/plans/discoverability/plan.md`.

Read both in full before writing any code. The spec is at revision 2: revision 1 was reviewed against
this codebase and twenty defects were found, six fatal. Section 14 of the spec records every one of
them and how it was resolved. **Do not re-derive those decisions and do not revert to the revision 1
approach** — if something in the spec looks unnecessarily complicated, section 14 probably explains
which simpler version was tried and why the code rejected it.

## This is a one-shot run

You do not stop until all of the following are true. Not one of them is optional, and none is
deferred to a follow-up.

1. Every milestone M1 to M7 in the plan is implemented.
2. Every row of spec section 12 has a test that exists, runs and passes.
3. The manual is extended and rebuilt, and the PDF is still A4.
4. The screenshot corpus is retaken and the drift triaged per plan section 5.
5. `README.md` is amended.
6. The local gates in plan section 4 are green.
7. The HIL merge gate passes, baselined against the base commit first.
8. A pull request is raised.
9. Every review comment on it is addressed in code.
10. Every CI check is green and no review thread is unresolved.
11. The pull request is merged.
12. `main` is tagged `0.10.0-rc2` and the tag is pushed.

**Do not produce a list of outstanding items.** If something is hard, finish it. If something turns
out to be genuinely impossible, stop and raise it with the user as a question before continuing —
that is a decision to be made, not a line in a summary.

## How to work

Work milestone by milestone in the plan's order. Each milestone leaves the tree green: run the local
gates at the end of each one rather than saving them all for the end, because a typecheck failure
found after six milestones is six milestones of bisecting.

Verify claims against the code before acting on them. This spec cites specific files and line numbers;
if one does not say what the spec says it says, that is a finding — report it and reconcile it rather
than coding around it.

## Traps in this repository that have each cost a red CI run

- **Never run `npm install` and never run `./build`.** Both rewrite `package-lock.json` and prune
  `@emnapi`, which turns roughly ten CI jobs red. After any local build:
  `git checkout -- THIRD_PARTY_NOTICES.md package-lock.json c64scope/package-lock.json`
- **`npm run typecheck`, never bare `tsc --noEmit`.** The npm script runs two projects; bare `tsc`
  uses the root config, accepts what `tsconfig.app.json` rejects, and has turned a green PR red here.
- **Never `git add -A`.** Stage explicit paths, and read `git status --short` before every commit.
  An automation on this repo auto-commits and pushes mid-session; check `git log` before assuming work
  was lost.
- **`docs/manual/**/*.md` is generated** by `scripts/build-manuals.mjs`. Editing it directly is wiped
  on the next build. The prose lives in the script.
- **The HIL merge gate fails on `main` too.** Baseline the base commit with `--only <stage>` before
  concluding your branch caused anything.
- **A leftover `wm size` override** from an earlier session fails the input and clarity stages with no
  code fault at all. Check the display geometry is native before blaming your change.
- **`npm run screenshots` rewrites roughly 203 PNGs**, most with environment drift. Triage per plan
  section 5; do not commit the lot.
- **A green signal is not readiness.** `mergeStateStatus: CLEAN` with unresolved review threads is not
  merge-ready.

## Constraints on what you write

- **Commit messages and the PR body must not name a build variant, a handset or a partner.** The plan
  documents may name hardware; the commits and the PR must not.
- **The PR description** follows the repo's rules: plain engineering language, previous behaviour and
  the defect stated separately from the implemented change and from how it was verified, no
  metaphors, no marketing, no claiming an implementation is "clean" or "correct" without naming the
  property that makes it so.
- **Comments over five lines are not accepted in this repo.** Compress a long why-comment; do not drop
  it.
- **Before amending a failing test, ask whether the change makes sense to a user.** If it does not,
  the production code is wrong, not the test.

## Reporting

When you finish, report against the definition of done in plan section 8, with evidence for each item:
a command output, a test name, a file path, a PR number, a tag. An item without evidence is not done.
