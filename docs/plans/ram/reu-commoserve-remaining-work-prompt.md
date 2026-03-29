# REU And CommoServe Remaining Work Prompt

## Role

You are a senior autonomous software engineer working inside the `c64commander` repository at `/home/chris/dev/c64/c64commander`.

Finish, verify, and document any remaining work for the REU and CommoServe changes described in:

- `docs/plans/ram/reu-commoserve-refined-brief.md`

Read and follow `AGENTS.md` and `.github/copilot-instructions.md` first.

This prompt exists to drive the remaining convergence work. Do not restart from stale assumptions.
It also includes one currently observed Playwright layout regression that must be fixed if it is still present during your run.

## Task Classification

Treat this as:

- `DOC_PLUS_CODE`
- `UI_CHANGE`

Only update screenshots whose visible UI actually changed.

## Mandatory Read Order

Read only this minimum set before editing:

1. `README.md`
2. `.github/copilot-instructions.md`
3. `AGENTS.md`
4. `docs/ux-guidelines.md`
5. `docs/plans/ram/reu-commoserve-refined-brief.md`
6. `src/hooks/useOnlineArchive.ts`
7. `src/components/archive/OnlineArchiveDialog.tsx`
8. `src/pages/HomePage.tsx`
9. `src/pages/home/dialogs/ReuProgressDialog.tsx`
10. `src/pages/home/dialogs/RestoreSnapshotDialog.tsx`
11. `src/lib/reu/reuWorkflow.ts`
12. `src/lib/reu/reuTelnetWorkflow.ts`
13. `src/lib/reu/reuSnapshotStorage.ts`
14. `src/lib/archive/client.ts`
15. `src/lib/archive/config.ts`
16. `tests/unit/hooks/useOnlineArchive.test.tsx`
17. `tests/unit/components/archive/OnlineArchiveDialog.test.tsx`
18. `tests/unit/lib/reu/reuWorkflow.test.ts`
19. `tests/unit/pages/HomePage.ramActions.test.tsx`
20. `tests/mocks/mockC64Server.ts`
21. `tests/contract/mockRestServer.ts`
22. `tests/contract/mockFtpServer.ts`
23. `tests/contract/mockServers.ts`
24. `tests/contract/README.md`
25. `src/lib/telnet/telnetMock.ts`
26. `android/app/src/main/java/uk/gleissner/c64commander/MockC64UServer.kt`
27. `android/app/src/main/java/uk/gleissner/c64commander/MockFtpServer.kt`
28. `android/app/src/main/java/uk/gleissner/c64commander/MockC64UPlugin.kt`

## Live CommoServe Facts Already Verified

Do not re-investigate these unless the server behavior has obviously changed during your run.

### Presets endpoint

The active app client already uses the correct endpoint:

- `GET /leet/search/aql/presets`

Observed live behavior:

1. One presets request returns all 5 dropdown groups.
2. The response is small and fast enough to use as one background verification request.
3. Fan-out requests per preset type or category are unnecessary.
4. The server requires `Client-Id: Commodore`.
5. Requests without that header fail with `errorCode: 464`.
6. `User-Agent: Assembly Query` is accepted and should remain in the client because it matches the current app contract.
7. The server omits `name` for `date` and `type` values; only `aqlKey` is guaranteed there.
8. On March 29, 2026, the verified year list stopped at `2025`.
9. A search using `date:2026` returned `200 OK` with zero results, not a validation error.

### Consequence

The year dropdown must always include every year from `1980` through the local current year, even if CommoServe returns a lower maximum year.

That rule applies both:

- before verification
- after verification

Do not treat the server’s date list as the authoritative upper bound.

## Current Code Status After Inspection

The current code already appears to have these CommoServe pieces in place:

1. `useOnlineArchive()` now seeds all required preset groups locally.
2. The date preset is synthesized through the local current year.
3. Verified presets are normalized before entering the in-memory session cache.
4. Missing preset `name` values are normalized from `aqlKey`.
5. Preset verification is still one background request per app session and archive config.

The current code still has this CommoServe gap:

1. `OnlineArchiveDialog` already renders a legal notice above the search button, but the text is still:
   - `Use CommoServe in accordance with applicable copyright law and archive terms.`
2. The required text is:
   - `You agree you have a necessary license or rights to download any software.`
3. The dialog test currently asserts the old text and must be updated alongside the UI.

Treat the preset work above as verification and regression coverage work unless you discover a real defect.
Treat the legal-notice text replacement as still-unfinished implementation work.

## Remaining Work Objective

Converge the codebase on the following final behavior.

### CommoServe

1. Verify that the dialog still renders immediately from seeded defaults.
2. Verify that the seeded and verified preset behavior still matches the refined brief.
3. Preserve current selections when verification resolves.
4. Replace the current legal notice with the exact required text above the `Search` button.
5. Update the related regression coverage so the required notice text is locked in.

### REU

1. Audit the save and restore flows against the refined brief.
2. Fix any remaining state, progress, transfer, or observability gaps.
3. Do not replace the existing transport-aware step model with a generic staged state machine.
4. Keep `/Temp` as the only remote staging path.
5. Ensure failures terminate cleanly and visibly.

### Display Profile Regression

If still reproducible on the branch, fix this specific Playwright failure:

- file: `playwright/displayProfiles.spec.ts`
- test: `compact auto layout can be overridden to large display without losing the chosen profile`
- project: `android-phone`
- viewport: `360x640`

Observed failure details:

- offending element:
  - `span.text-xs.font-semibold.uppercase.tracking-[0.14em].text-foreground`
- reported overflow:
  - right edge `367.609375px`
  - boundary `360px`

Treat this as a real compact-width layout regression, not a flaky artifact.

Required outcome:

1. the chosen display profile remains visible and reachable when compact auto layout is overridden to large
2. no related profile label or control text may extend past the right viewport boundary at `360px`
3. the fix must not introduce horizontal overflow elsewhere in the display-profile matrix
4. keep the change minimal and local to the real overflow cause

### Mock Parity Against Real `c64u`

Improve the reliability of the REST, FTP, and Telnet mocks by comparing them directly against the actual C64 Ultimate device reachable at host name `c64u`.

Required goal:

1. exercise all mock-supported REST, FTP, and Telnet surfaces against both:
   - the real device at `c64u`
   - the repository mocks
2. compare request/response behavior as precisely as possible
3. where the mock diverges, amend the mock to match the real device behavior
4. rerun all affected tests against the corrected mocks
5. fix any test failures exposed by the improved parity

Safety rule:

- do not execute dangerous, destructive, or non-reversible operations on the real device

Examples of operations to exclude from the real-device parity sweep unless you have an explicit safe harness and can fully revert the change:

- power off or power cycle
- flash erase / clear flash
- irreversible config writes
- file deletion on the device
- device-mutating Telnet actions that cannot be safely rolled back

For mutating endpoints, prefer:

- read-only discovery
- safe no-op writes only when the effect is fully reversible and you restore the original state during the same run

The parity goal is behavioral fidelity, not reckless endpoint coverage.

## Explicit Implementation Rules

### For CommoServe preset handling

Use this request model:

1. render from local defaults
2. fire one background presets request
3. normalize by preset type
4. cache the normalized result in memory for the rest of the app session

Do not:

- make one request per preset type
- block first render on the network
- fully trust server-provided date bounds
- clear current form selections when verification completes

### For the CommoServe legal notice

The dialog already contains a legal notice block in the correct location.

Do not add a second notice.
Replace the existing text in that block with exactly:

- `You agree you have a necessary license or rights to download any software.`

Update the associated unit test to assert that exact sentence.

### For the display-profile regression

Audit the real UI rendered in the failing scenario before editing.

Most likely causes include:

- a flex row missing `min-w-0`
- a label container that cannot shrink
- uppercase tracking pushing a text label beyond the compact-width boundary
- a control row that assumes more than `360px` width

Do not weaken viewport-boundary assertions to make the test pass.
Fix the layout cause.

### For REST / FTP / Telnet mock parity

Use the real device at host `c64u` as the source of truth.

Compare at the level that matters to the app and tests:

- status code
- content type
- response body shape
- field names
- value normalization
- missing vs null fields
- FTP listing format as observed by the app
- Telnet menu text, labels, ordering, disabled markers, prompts, and navigation responses
- error shape and failure mode where it can be observed safely

Where the mock cannot safely be exercised through a real mutating operation, document that exclusion explicitly and keep the mock aligned using the best read-only evidence available.

Do not accept “close enough” behavior if the app or tests depend on the exact response contract.

Do not weaken tests to fit inaccurate mocks.
Fix the mocks to match `c64u`.

Capture evidence for the parity audit:

1. which endpoints/commands were compared
2. which ones were excluded for safety
3. the exact observed mismatch
4. the file(s) changed to correct the mock
5. the test(s) added or updated to lock in the parity fix

### For verified date normalization

The final date list must be built as:

- `1980..max(localCurrentYear, maxVerifiedYear)`

If CommoServe returns no date preset or an empty date preset, fall back to:

- `1980..localCurrentYear`

## Tests You Must Add Or Update

Add or update narrow deterministic regression tests for:

1. seeded presets include the local current year
2. verified presets still include the local current year when the server stops earlier
3. missing `name` values are converted into usable visible labels
4. exactly one presets refresh request occurs per app session and config
5. current user selection is preserved after verified presets resolve
6. the CommoServe legal notice renders the exact required sentence
7. REU save step order remains correct
8. REU restore step order remains correct
9. REU failures terminate with visible error handling and no stuck progress UI
10. the display-profile override UI does not overflow horizontally in the previously failing compact-width Playwright scenario
11. each corrected REST / FTP / Telnet mock divergence is locked in with the narrowest meaningful regression coverage

If any of these are already covered, strengthen or rename the existing tests instead of duplicating them.

## Validation

Run the smallest honest validation set that satisfies repository rules for this change:

- `npm run lint`
- `npm run test`
- `npm run test:coverage`
- `npm run build`

If you change the REST / FTP / Telnet mocks, rerun the mock- and contract-relevant tests that cover those surfaces, then continue to the full required validation.

At minimum, rerun the relevant subsets from:

- `tests/mocks/*`
- `tests/contract/*`
- Playwright or unit suites that depend on `mockC64Server`, FTP mocks, or Telnet mocks

If you touch the display-profile UI, also rerun the focused Playwright coverage for the failing scenario:

- `playwright/displayProfiles.spec.ts`
  - `compact auto layout can be overridden to large display without losing the chosen profile`

If unrelated failures remain on the branch:

1. prove they are unrelated
2. capture the failing file/test name and error
3. continue any remaining scoped work

Do not claim green validation unless you actually ran it.

## Screenshot Scope

Only update screenshots if the visible CommoServe or REU UI changed.

If screenshots are needed, limit them to:

- CommoServe search form
- any REU dialog or progress surface whose visible content changed

Do not regenerate unrelated screenshot folders.

## Completion Bar

Do not stop until all of the following are true:

1. CommoServe year options always include the local current year.
2. CommoServe verification still uses one background presets request only.
3. CommoServe selections survive verification.
4. The CommoServe legal notice above the search button matches the exact required sentence.
5. REU behavior matches the refined brief.
6. Required regression tests are in place.
7. Required validation has been run, or unrelated blockers are documented precisely.
8. Screenshot impact is either updated or explicitly ruled out.
9. the previously observed compact-width display-profile overflow is fixed or explicitly proven unrelated to the touched work.
10. the REST / FTP / Telnet mocks have been audited against the real `c64u` device with explicit safety exclusions.
11. any observed mock divergence from `c64u` has been corrected and locked in with tests.
12. all tests affected by the mock corrections have been rerun and any resulting failures have been fixed.
