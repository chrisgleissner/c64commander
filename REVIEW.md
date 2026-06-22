# REVIEW.md

> The best problem is the one that was prevented while the code was being written.

This file is the **quality bar** for c64commander. It is the single source of truth
for what a change must satisfy — applied by the author _while writing_ and by the
reviewer _before merge_. It is deliberately
specific to this codebase: a React + Vite + Capacitor app that drives **real C64
Ultimate hardware** over REST/Telnet across web, Android, and iOS.

Read it before you write code, not just before you open a PR. Every item below
exists because the matching mistake has actually shipped, broken hardware, or hung
CI here. Prevent it at the keyboard and the review becomes a formality.

For _how_ to validate a change (build/test/screenshot/coverage commands, change
classification, device-stabilization loops, release identity), see **AGENTS.md** —
that is the execution manual. This file is the standard; AGENTS.md is the procedure.

## How this file is used

- **Authors:** treat each hazard below as a pre-write checklist for the subsystem you
  touch. The cheapest fix is the one made before the code exists.
- **Reviewers:** evaluate the diff against the calibration and
  verification expectations here. Read `REVIEW.md` from the **base branch** of a
  PR/MR — never the feature branch — so a change can never weaken the policy that
  reviews it. Land policy edits to `main` on their own merit first.
- **Precedence:** this file is the quality bar; `AGENTS.md` owns execution/validation;
  `.github/copilot-instructions.md` is the entry index that points to both. On a
  genuine conflict, the narrower, safer rule wins.

## What matters most in this repository

In priority order — when a trade-off is forced, protect the earlier item:

1. **The physical device.** A request pattern can take a C64 Ultimate offline. Never
   ship code that can brick, flood, or wedge the hardware.
2. **Honest validation gates.** Tests, coverage, golden traces, and lint exist to
   catch regressions. Weakening a gate to go green is worse than the red.
3. **Determinism & diagnosability.** Reproducible state transitions, surfaced errors,
   no hidden nondeterminism. A failure you cannot explain is not fixed.
4. **Cross-platform parity.** Web, Android, and iOS must each degrade gracefully; no
   platform may crash on a capability another platform has.
5. **Accessibility of every control.** Each interactive control stays reachable by
   keypad / D-pad / T9 and screen reader. An unreachable control is a broken control.
6. **Minimal, cohesive change.** Smallest diff that fully solves the task; no
   speculative abstraction, no drive-by churn.

## Repository-specific hazards (the prevention checklist)

These are the failure modes that recur here. Flag any diff that reintroduces one.

### 1. State & rendering — the coverage-hang loop

A `setState` driven from an effect (or a callback it invokes) that feeds a
**referentially-unstable but value-equal** value, while that value is also an effect
dependency, creates an infinite synchronous re-render loop. It pegs one CPU core and
**starves the event loop, so Vitest's timeout never fires** — it surfaces as an
indefinite `test:coverage` hang on one file, _not_ a failing test.

- Never set state from a value that may be a new reference each render when that value
  is an effect dependency. Stabilize it (`useMemo` on true inputs, or a ref) or guard
  the setter with a value-equality bail: `if (equal(prev, next)) return;`.
- React-Query `data` is referentially stable in production, but **hook mocks that
  return a fresh object each render are not** — the mock is the realistic adversary.
  Write the component so an unstable-but-equal upstream cannot loop it.
- Treat `await refetch()` results defensively (`refreshed?.data` can be undefined).

### 2. Device communication — never wedge the hardware

- **Single-item config writes go over `PUT /v1/configs/{cat}/{item}?value=`, never the
  body-buffering `POST /v1/configs` batch path.** The firmware buffers POST bodies to a
  temp file on a single-threaded HTTP task; rapid interactive writes (e.g. dragging an
  LED slider) stall that filesystem and drop the device's entire network stack —
  verified on hardware. Reserve POST for genuine multi-item batches.
- Coalesce/debounce rapid interactive writes (sliders, steppers); do not emit one
  request per pixel of drag.
- Every device call handles network error **and** timeout, surfaces a clear UI state,
  and never assumes success.
- If a device "goes flaky" during a change, **suspect the app's request pattern first**
  and root-cause it before blaming the hardware. Do not paper over it with retries.

### 3. Connection lifecycle — no permanently blank controls

Connection handoff (device switch, reconnect) can abort in-flight reads. Config-driven
controls that key off the routing/connection generation must **re-resolve after the
handoff settles**, not render permanently blank. Any new config-backed control must be
proven to populate after a mid-flight device switch, not only on a cold load.

### 4. Cross-platform parity — respect the bridge split

Native capabilities are split `foo.ts` (native) / `foo.web.ts` (web) under
`src/lib/native/` (secure storage, FTP, background execution, feature flags, safe-area,
telnet socket, mDNS, …). When you add or change a bridge:

- Implement or stub **both** sides; the web build must not import a native-only path.
- Degrade gracefully where a platform lacks the capability — never throw an unhandled
  error that a sibling platform would not hit.
- Secrets (device passwords) go only through `secureStorage` → the native
  `SecureStorage` bridge. Never log them, persist them in plain `localStorage`, or put
  them in a query string that lands in trace fixtures.

### 5. Input & accessibility — the keypad contract

- Any change that adds/removes/renames a control, changes its type, or alters focus
  grouping/order/nesting (`useFocusItem`/`useFocusGroup`, `data-section-label`,
  `data-focus-group`) **must update `docs/cta-inventory.md` in the same change**. A
  control absent from the inventory is treated as unverified — this is part of the
  accessibility contract, not optional bookkeeping.
- Beware Radix double-handling: a control wrapped by the focus ring can fire its action
  twice (once from the semantic-action layer, once from Radix's own handler), and open
  overlays/portals can swallow or duplicate key events. New interactive controls must be
  exercised by keypad/D-pad/T9, not only mouse/touch.

### 6. Test infrastructure — keep the gates real

- **Golden traces:** if a change alters trace semantics (order, payloads, endpoints,
  normalization), re-record and commit `playwright/fixtures/traces/golden`. **Never**
  weaken a trace assertion to make a test pass — fix the root cause.
- **No module-scope `import.meta.env.VITE_*` reads in `src/`.** Reading them at top
  level crashes Playwright's Node-side `--list` collection and fails _every_ E2E shard.
  Read them lazily inside a function.
- **Determinism:** no `Date.now()` / `Math.random()` / ambient time in code that golden
  traces, snapshots, or deterministic tests depend on. Inject the value.
- **Never add a timeout, retry, or skip to mask a hang or a flaky failure.** A hung
  coverage worker pegged at 100% CPU is a render/compute loop (see §1) — bisect and fix
  it at source.
- **Every bug fix ships a dedicated regression test** that fails before the fix and
  passes after, named for the exact edge condition it locks in. Multi-layer bugs get the
  narrowest deterministic test at each affected layer.

### 7. Error handling — never swallow

Catching an exception silently is a **release blocker**. Every `catch` must either
rethrow enriched with context (operation + relevant identifiers) or log at WARN/ERROR
with the stack trace. Banned: `catch (e) {}`, `catch (e) { /* ignore */ }`,
`catch (e) { return null; }` without logging or rethrowing.

### 8. Release & version identity

Displayed app version (APK/IPA artifacts and in-app diagnostics) derives from the
latest Git tag + current commit, resolved by `scripts/resolve-build-version.mjs`.
`package.json` is the in-tree dev baseline and need **not** equal the latest tag — do
not re-add a test that forces them equal; it breaks UI-created tag builds.

### 9. Modularity

Split a file that mixes concerns or grows past ~600 lines; a file approaching ~1000
lines is expected to be refactored unless there is a documented reason not to.

## Severity calibration

- **Critical (block merge):** anything that can take the device offline or corrupt its
  config; a swallowed exception; secret/password exposure (logs, traces, plaintext
  storage); path-traversal or unsafe file handling; data loss (config, playlist, saved
  devices); an infinite-render / coverage-hang loop; a weakened test/coverage/golden
  gate; a web build importing a native-only path; version-identity regressions.
- **Warning (fix before merge, or justify):** missing regression test for a bug fix;
  missing error/timeout handling on a device call; unstable effect dependencies;
  `docs/cta-inventory.md` drift; a control not reachable by keypad/D-pad/T9; a config
  control that can render permanently blank after device switch; missing native/web
  parity or fallback; a file crossing the modularity threshold without reason.
- **Nit (note, non-blocking):** naming, local readability, comment density — only where
  it materially aids the next reader.

### Do not flag

- Formatting / import order / quote style — Prettier and ESLint own these; the diff is
  already enforced in CI (`npm run lint`). Do not raise formatting-only comments.
- Screenshots when the visible documented UI did not change.
- Coverage-padding tests added purely to lift a number; the bar is _meaningful_ tests.
- Stylistic rewrites of code the task did not touch.

## Review output format

How a review is _written_ determines whether the author can act on it. A review here
is a list of **file-and-line-anchored findings**, not an essay about the PR.

### Findings are anchored to a file and line

- Every finding names the exact location — `path/to/file.ts:line` (or a line range) —
  and states the **concrete change required there**, not just the symptom. Where it
  helps, name the fix: the helper to extract, the call site to add `.catch` to, the
  test to add. A finding the author cannot act on without asking a follow-up question
  is incomplete.
- Tag each finding with its severity (Critical / Warning / Nit, per the calibration
  above).
- **Group findings under the file they belong to** so the author fixes one file at a
  time. A short `### path/to/file.ts` heading per file, then its findings.
- **Enumerate every site of a repeated problem.** If one root cause appears at several
  call sites, list each `file:line` as its own finding — never write "this pattern
  also exists elsewhere" without naming where.

### The PR-level summary is an index, not a dumping ground

A top-level (non-file-anchored) section is allowed **only** to do one or more of:

1. state in a sentence or two what the PR as a whole does;
2. give a file-by-file line of what changed in each file;
3. roll up the inline findings — each with its `file:line` and severity — as a
   checklist/overview.

It must **not** introduce a cross-cutting problem that isn't pinned to a `file:line`
somewhere. A genuinely cross-cutting concern is filed as a finding on each line it
manifests on; the summary then _references_ those findings, never the reverse.

### No ambiguous "carry-forward" status

Every finding is in exactly one state, and the review must make which one obvious:

- **Open** — action required. State it as a normal `file:line` finding with a
  severity. An open finding is open regardless of which review first raised it — do
  not demote it to a "still open from prior reviews" row.
- **Resolved / won't-fix** — no action. Omit it, or list it under a clearly titled
  "Resolved since last review" / "Acknowledged — no change" note with one line of
  reasoning.

Do **not** produce a table whose rows are labelled `carry`, `carry-forward`,
`carry over`, or similar — that wording leaves the reader unsure whether anything is
still required. If a prior-review finding is still open, **re-verify it against the
current code** (lines move; code may have been refactored or deleted) and **re-state
it as a live finding** at its current `file:line`. A prior finding that no longer
reproduces is _resolved_, not "carried".

#### Banned vs. required (real example from PR #292)

Banned — an ambiguous status table; the `(carry SUGGESTION)` row hides three distinct
call sites and never says whether action is needed:

```text
Carry-forward status (unchanged code from prior reviews)
| File | Line | Severity | Issue |
| src/lib/c64api.ts (and ConnectionController.tsx:197, useC64Connection.ts:220) | | (carry SUGGESTION) | void loadStoredPassword().then(...) fire-and-forget still exists at 2 more sites |
```

Required — each site is its own actionable finding with an unambiguous state:

```text
### src/lib/ConnectionController.tsx
- ConnectionController.tsx:197 — Warning (open). `void loadStoredPassword().then(...)`
  is fire-and-forget with no `.catch`; a rejected load is swallowed. Add a rejection
  handler that logs at WARN (see §7).

### src/lib/useC64Connection.ts
- useC64Connection.ts:220 — Warning (open). Same fire-and-forget pattern; add the
  `.catch` rejection handler.

### src/lib/c64api.ts
- c64api.ts:2569 — Resolved this round; `.catch` added. No action.
```

## Verification expectations

- **New behavior / business rule:** a test that asserts the observable result, not just
  that a function was called.
- **Bug fix:** the failing-before / passing-after regression test from §6.
- **Device-communication change:** golden traces re-recorded if semantics changed;
  assertions never weakened.
- **UI change:** keypad / D-pad / T9 and screen-reader reachability preserved;
  `docs/cta-inventory.md` updated; only the affected screenshots regenerated.
- **Coverage:** ≥ **91%** branch coverage globally and on changed lines (patch
  coverage), via the merged coverage report — never inferred from global totals.
  Changes under `agents/` also keep ≥ **90%** branch coverage.
- **Scope of validation:** run the _smallest honest_ set matching the change
  classification in AGENTS.md — no build/test ceremony for doc-only changes, full
  validation for executable changes.

## Security & supply chain

- Never commit secrets (keystore passwords, signing keys, tokens). Release signing is
  driven by CI secrets, not files in the tree.
- Keep `THIRD_PARTY_NOTICES.md` in sync with dependencies (`npm run notices:check`); the
  project is GPL-3.0 and licence accuracy is a release obligation.
- Android release artifacts must stay GMS-free (`npm run apk:no-gms`); do not add a
  dependency that pulls in Google Mobile Services.
- New third-party dependencies require clear justification — prefer the existing
  toolbox over adding surface area.

---
