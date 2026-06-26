# PR CONVERGE HANDOVER — PR #297 (test/full-cta-coverage-2) + merged PR #296

Task: converge PR #297 per `.github/prompts/pr-converge.prompt.md`, with PR #296 merged in.
**All work is UNCOMMITTED in the working tree (23 changed files). Commit before pushing.**

## What is DONE (in working tree, not committed)

1. **Merged PR #296** (dependabot weekly-rollup) into branch — merge commit `a94e4551` is committed; the dep-bump working-tree changes are part of the 23 files. Clean merge, no conflicts.
2. **Fixed the 2 original CI typecheck failures** (blocked `Web | Unit tests (coverage)`):
   - `src/lib/snapshot/cpu/captureEngine.ts`: added missing `type CaptureHandler` to the import from `./six502/capturePayload`.
   - `src/lib/snapshot/cpu/restoreCart.ts:206`: `new Blob([crt as BlobPart], ...)` (TS 5.7 lib DOM `Uint8Array<ArrayBufferLike>` vs BlobPart).
3. **Addressed EVERY review comment** (Copilot + Kilo-code-bot):
   - `src/lib/snapshot/cpu/cpuSnapshot.ts:84` (CRITICAL silent resume swallow): now logs via `addErrorLog` with method/vectorAddr context.
   - `src/lib/snapshot/cpu/capability.ts:79 & :130` (empty catches): now log via `addErrorLog`.
   - `src/lib/snapshot/cpu/captureEngine.ts:175-178` (catch didn't roll back machine state): added `PendingPatch` rollback tracking + `restorePatch` helper that does machinePause→restore IRQ vector→restore safe region→machineResume, logging on failure. Also resumes the program on the unstable-read `CpuCaptureFailedError` path.
   - `src/lib/ftp/ftpClient.ts:302` (CRITICAL cancelRead swallow): now logs via `addErrorLog`/`buildErrorLogDetails`.
   - `src/lib/deviceInteraction/deviceInteractionManager.ts:1060` (telnet hostScope missing toLowerCase): added `.toLowerCase()` to match FTP pattern at line 949.
   - `android/.../FtpClientPlugin.kt:375` (readFile cleared cancelledReads at start → erased pre-abort): now HONORS a pre-existing cancellation (checks `cancelledReads.contains` inside try, rejects `readAbortedMessage`, returns early) instead of removing it.
   - `android/.../FtpClientPlugin.kt` listDirectoryRecursive (cascade on data-channel timeout): added `timedOut` flag; on `java.net.SocketTimeoutException` sets timedOut + breaks the walk (added `timed_out` to result JSObject).
   - `src/lib/snapshot/cpu/six502/capturePayload.ts` (dead code `buildNmiCaptureHandler` + `CIA2_ICR_ADDR`): REMOVED (only its own test referenced it; wiring full ISN capture = scope creep). Test block removed from `tests/unit/lib/snapshot/cpu/six502/capturePayload.test.ts`.
   - `src/hooks/useC64Connection.ts:176` (SUGGESTION: document broader coalescing): added clarifying comment that mount/user refetches returning cached info within the window is intentional/safe.
   - `docs/cta-inventory.md` (SaveRamDialog CTA `save-ram-type-cpu` missing): added a "Save RAM dialog" subsection documenting all dialog CTAs (save-ram-type-cpu, presets, custom form).
   - `PLANS.md` (Copilot "rewritten in-place"): NOT a code fix — NO repo rule mandates PLANS.md preservation (verified: no mention in REVIEW.md/AGENTS.md/copilot-instructions.md/CLAUDE.md). Respond to that Copilot thread explaining PLANS.md is a per-session working/state file, legitimately rewritten each session.
4. **Fixed the E2E telnet discovery regression** (homeInteractivity reboot/power-cycle tests failed with "Top-level action menu did not return after discovery probe"):
   - Root cause: `src/lib/telnet/telnetCapabilityDiscovery.ts` used `sendKey("ESCAPE")` to return to the root action menu after probing a submenu. The contract mock (`tests/contract/mockTelnetServer.ts`) treats a lone ESC as a two-stage prefix (sets `escapePending`, closes the WHOLE menu on the next non-ESC input) and does NOT close just the submenu — so discovery never saw the root menu again → DESYNC. ESCAPE is also wrong for real firmware (dismisses the whole menu).
   - Fix: replaced `readRootMenuAfterEscape` with `returnToRootMenu` that sends **LEFT** (proven submenu-backout key — matches `telnetMenuNavigator._recoverFromDesync` and `telnetActionExecutor` cleanup which send LEFT/ESCAPE+LEFT), reads for the root menu, and re-opens via `openActionMenu` if the menu was dismissed. Unit tests pass (12/12).
5. **Fixed formatting**: `npm run format:ts` had pre-existing unformatted files in the branch (assembler.ts, RestoreSnapshotDialog.tsx, several tests). Reformatted; `format:check:ts` now clean.

## IMMEDIATE BLOCKER — must fix before commit/push

Running `npm run lint` now FAILS at typecheck with NEW errors (introduced by the PR #296 dependabot dep bump, most likely the `typescript-eslint` 8.61.1→8.62.0 or a TS lib change):

```
src/pages/DocsPage.tsx(43,30): error TS2677: A type predicate's type must be assignable to its parameter's type.
  Type 'string' is not assignable to type '"C64U" | "CommoServe" | "Local" | "HVSC" | null'.
src/pages/DocsPage.tsx(48,30): ...same ('CommoServe'|'Local'|null variant)
src/pages/DocsPage.tsx(189,50): error TS2345: Argument ... 'string | null' is not assignable to 'string'.
src/pages/DocsPage.tsx(239,83): ...same
```

These are at `DocsPage.tsx:43,48,189,239`. Lines 43/48 are type predicates (`.filter((x): x is "..." => ...)`); 189/239 pass arrays with possible `null` to a `readonly string[]`. **Fix:** tighten the predicates to the actual union type (not bare `string`) and filter out `null` (e.g. `.filter((x): x is NonNullType => x != null)`), or adjust the array typing. This is a real regression from the dep bump and MUST be fixed for CI to be green. Verify it's from #296 with `git log --oneline -3 -- src/pages/DocsPage.tsx` and by checking the diff vs `origin/main`.

## Remaining steps (after DocsPage.tsx fix)

1. `npm run lint` green.
2. `npm run test` (full unit/Vitest) — already ran telnet discovery (12 pass) + typecheck. Run full suite; watch for the snapshot/cpu tests (capability, cpuSnapshot, captureEngine, restoreCart) since I changed logging imports — those test files were reformatted only, logic unchanged, but the cpuSnapshot.ts `finally` now has a `.catch` that logs — confirm existing tests still mock `addErrorLog` or don't assert on it.
3. `npm run build` (vite web build).
4. **Coverage gate:** `npm run test:coverage` ≥ 91% branch (AGENTS.md). The new rollback paths in captureEngine.ts (restorePatch) and the FtpClientPlugin timeout-bail may need targeted tests. captureEngine restorePatch is a best-effort error path — add a test that a mid-patch write failure triggers rollback+rethrow+log. If coverage <91%, add focused tests.
5. **Android:** `cd android && ./gradlew test` — FtpClientPlugin.kt changed (cancelReads check, timedOut bail). Verify existing `FtpClientPluginTest.kt` passes; add a test for the timeout-bail if coverage requires.
6. `git add -A && git commit` (message: address review comments, fix typecheck/E2E, merge #296). Then `git push`.
7. **Resolve every review thread on PR #297** via `gh` — reply + resolve each of: Copilot 3480883629 (snapshotFormat — already FIXED, explain), 3480883680 (ftpClient cancelRead — FIXED), 3480883711 (FtpClientPlugin cancelReads — FIXED), 3480883741 (host/port optional — toLowerCase FIXED; "make required" declined as intentional defensive fallback), 3480883767 (PLANS.md — not applicable, no such repo rule); Kilo 3480926347 (snapshotFormat — FIXED), 3480926356 (ftpClient — FIXED), 3480926370 (deviceInteraction toLowerCase — FIXED), 3480926374 (listDirectoryRecursive — FIXED), 3480926382 (useC64Connection — documented), 3482630938 (cpuSnapshot — FIXED), 3482630942 & 3482630960 (capability — FIXED), 3482630968 (captureEngine rollback — FIXED), 3482630970 (SaveRamDialog cta-inventory — FIXED), and the new capturePayload dead-code suggestion (REMOVED).
8. **Wait for CI green**, fix any further failures. The device-gateway guard (`pr-converge` step 4): confirm no direct `fetch(.../v1...)` or native FTP/Telnet socket imports introduced outside approved gateway modules — my changes only added `addErrorLog` imports and used existing APIs, so this should pass.

## Key files changed (23)
src/lib/snapshot/cpu/{captureEngine,cpuSnapshot,capability,restoreCart}.ts, src/lib/snapshot/cpu/six502/{capturePayload,assembler}.ts, src/lib/snapshot/snapshotFormat.ts (already correct, untouched), src/lib/ftp/ftpClient.ts, src/lib/deviceInteraction/deviceInteractionManager.ts, src/lib/telnet/telnetCapabilityDiscovery.ts, src/hooks/useC64Connection.ts, src/pages/home/dialogs/{SaveRamDialog,RestoreSnapshotDialog}.tsx, docs/cta-inventory.md, android/.../FtpClientPlugin.kt, and matching test files (reformatted). PLUS the PR #296 dep bumps (package.json/lock, gradle, THIRD_PARTY_NOTICES).

PR: https://github.com/chrisgleissner/c64commander/pull/297 (base main). PR #296 merged: https://github.com/chrisgleissner/c64commander/pull/296
