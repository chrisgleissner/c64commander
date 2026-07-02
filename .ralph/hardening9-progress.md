# Hardening 9 Ralph-Robin Progress

## Current state
- Branch: fix/hardening
- Last commit reviewed/created: 1ab881f5 "Fix HARD9-002 native request lane priority"
- Working tree: clean after HARD9-002 status update commit
- Review doc: docs/plans/hardening/9-fable/review.md
- 95 findings (HARD9-001..095)

## Plan
Work batches in order from review.md:
1. Auth & password UX: 001, 004, 025, 028, 043  <- DONE
2. Native request lane & circuit UX: 002, 023, 022, 024, 061, 060, 062  <- IN PROGRESS (002 fixed)
3. Playback duration/songlengths: 005, 006, 008, 064
4. Playback lifecycle: 029, 030, 031, 033, 063, 007
5. Playback perf: 032, 034, 065, 066
6. Diagnostics hot path: 019, 020, 021, 055, 056, 057, 058
7. Disks: 010, 012, 011, 037, 038, 068, 048
8. Snapshot: 009, 035, 036, 039, 067, 069
9. HVSC chain: 013, 014, 015, 040, 046, 074, 084, 075
10. Config write integrity: 016, 017, 018, 050, 051, 052, 053, 054, 085-089
11. Sources/FTP: 045, 047, 049, 070, 073, 078, 079, 080, 081, 082, 083, 076
12. Shell/settings polish: 003 (early), 026, 027, 090, 091, 092, 093
13. Background execution service: 041, 042
14. Startup/state: 044, 059, 071, 072, 077, 094, 095

## Fixed
- HARD9-001: 53eda43f - Discovery probes now treat HTTP 401/403 as
  password-required even though they run as `system` traffic and suppress the
  normal request-layer auth popup. `probeOnce` records `lastProbeError:
  "Password required"` and raises the app-wide `notifyAuthRequired` dialog.
  Startup discovery window expiry preserves that auth-required reason instead
  of replacing it with automatic LAN-discovery fallback text, so the app no
  longer strands a wrong-password c64u as a generic OFFLINE state with no
  password prompt. Regression coverage locks both direct 403 probe handling
  and the full startup-discovery path where every probe is rejected for auth.
- HARD9-004: df7ddcd9 - Network Password field on Settings never loads the real
  saved secret into the editable input. A saved password renders as a locked
  disabled `••••••••` field with a "Change" button that starts an empty draft.
  A `needs-password` reachability result while actively changing the password
  (a wrong replacement password) is now treated as an auth failure and blocked
  before any persistence (`setPasswordError`, no `setPasswordForDevice` call).
  KNOWN GAP: the fix sketch's "persist only after verification succeeds" was
  NOT fully implemented as a call-order change — `switchSavedDevice` reads the
  saved-device record from persisted storage, so `updateSavedDevice`/
  `setPasswordForDevice` still run before that final verification. The
  pre-persist `evaluateNewDeviceReachability` gate (which now also catches
  wrong passwords) is what actually prevents persisting bad credentials in the
  HIL-observed scenario. A same-millisecond device-side password change
  between the two checks is a narrow residual race — would need
  `useSavedDeviceSwitching` reworked to accept a candidate config instead of
  re-reading persisted state. Left for a follow-up if this needs closing.
- HARD9-025: df7ddcd9 - Removed (rather than dirty-guarded) both effects that
  raced a user's in-progress password keystrokes: the `[password]`-mirror
  effect and the async `getPasswordForDevice` preload effect are both gone
  (subsumed by the HARD9-004 fix, since the field never shows the real
  secret). Only remaining effect resets the draft on an actual device switch
  (`[selectedSavedDevice?.id, selectedSavedDevice?.hasPassword]`).
- HARD9-028: df7ddcd9 - Added `authRequired?: boolean` to `ProbeInfoResult`,
  populated via `isAuthRequiredError(error)` in `probeInfoOnce` and
  `probeInfoWithConnectionConfig`'s HTTP-status catch branch; flows through
  `verifyCurrentConnectionTarget` -> `useSavedDeviceSwitching` unchanged. New
  `describeSwitchFailure` helper in SettingsPage.tsx reports "The device
  rejected the password. Check the password and try again." instead of the
  generic offline/unreachable message at both `switchSavedDevice` call sites
  (Save & Connect, discovered-device confirm). The later HARD9-001 fix raises
  the auth prompt from discovery probes and preserves the password-required
  offline reason; no separate `ConnectionState` enum value was added.
- HARD9-043: 52b59dd8 - Native SecureStorage now initializes production
  `EncryptedSharedPreferences` through a synchronized cached holder instead of
  rebuilding `MasterKey`/preferences for every plugin call. If production
  encrypted storage throws, the plugin clears the cached holder, clears/deletes
  the encrypted preference files, deletes the AndroidKeyStore master-key alias
  when available, and degrades `getPassword` to `{ value: null }` so the app
  asks the user to re-enter the password. `setPassword` retries once after
  recovery. Injected test providers still reject, preserving hard-failure tests.
- HARD9-002: 1ab881f5 - Native direct-device REST serialization now acquires
  the native socket slot inside the scheduled `withRestInteraction` request
  handler, after scheduler cooldown/backoff/priority admission. A cooled
  background `saveConfig` no longer blocks a ready user `getInfo` from reaching
  `CapacitorHttp`, while actual native direct-device I/O remains serialized.

## Validation
- `npx tsc --noEmit`: PASS (after HARD9-001)
- `npx eslint src --quiet`: PASS (after HARD9-001)
- `npx vitest run tests/unit/connection/connectionManager.test.ts tests/unit/lib/auth/authChallengeController.test.ts tests/unit/components/DeviceAuthChallengeDialog.test.tsx tests/unit/lib/auth/authChallenge.test.ts`: PASS (4 files / 114 tests, after HARD9-001)
- `npx prettier --check src/lib/connection/connectionManager.ts tests/unit/connection/connectionManager.test.ts`: PASS
- `git diff --check`: PASS
- `./gradlew testDebugUnitTest --tests uk.gleissner.c64commander.SecureStoragePluginTest`: PASS (after HARD9-043)
- `./gradlew assembleDebug`: PASS (after HARD9-043)
- `npx tsc --noEmit`: PASS (after HARD9-043)
- `npx eslint src --quiet`: PASS (after HARD9-043)
- `npx vitest run tests/unit/c64api.test.ts tests/unit/c64api.branches.test.ts`: PASS (158 tests, after HARD9-002)
- `npx tsc --noEmit`: PASS (after HARD9-002)
- `npx eslint src --quiet`: PASS (after HARD9-002)
- `git diff --check`: PASS (after HARD9-002)
- `npm run format:check:ts -- --ignore-unknown src/lib/connection/connectionManager.ts tests/unit/connection/connectionManager.test.ts`: FAIL (script checks the whole repo's `**/*.{ts,tsx,json}` pattern before appended args; reports pre-existing formatting warnings in `src/pages/SettingsPage.tsx` plus the touched connection test before targeted Prettier write. Targeted file check above passes after formatting touched files.)
- `npx vitest run tests/unit/pages/SettingsPage.test.tsx`: PASS (83/83, +4 new
  tests covering HARD9-004/025/028)
- `npx vitest run tests/unit/pages tests/unit/connection tests/unit/hooks
  tests/unit/lib/connection`: PASS (102 files / 1371 tests) — this run
  surfaced and required fixing one pre-existing test
  (`tests/unit/lib/connection/probeInfoContextualError.test.ts`) whose
  `@/lib/c64api/transportErrors` mock didn't export `isAuthRequiredError`,
  which the new `authRequired` code path now calls unconditionally on any
  HTTP-status probe failure. Fixed by adding a minimal `isAuthRequiredError`
  mock (matches HTTP 401/403) to that test file. No other test file mocks
  that module in a way that hits the new call path.
- `npm test -- --run` (full suite): NOT RUN this session (budget-constrained;
  the scoped run above covers every file that imports/touches
  connectionManager.ts, SettingsPage.tsx, or transportErrors.ts).
- `npm run build`: NOT RUN this session.
- Android Gradle (`./gradlew testDebugUnitTest` / `assembleDebug`): NOT RUN —
  no native/Android files touched this batch.
- Hardware (Pixel 4 + c64u) HIL re-verification of the exact wedge sequence
  described in HARD9-004/001: NOT RUN, hardware unavailable this session.
  The original finding was HIL-proven; this fix has only static+unit-test
  validation so far. Strongly recommend a HIL pass (wrong-password save on a
  real c64u) before calling this fully closed.

## Remaining
- Next batch: Native request lane & circuit UX — HARD9-023, HARD9-022,
  HARD9-024, HARD9-061, HARD9-060, HARD9-062.
- Next issue: HARD9-023 (background requests retry 3x with zero delay while
  occupying the REST lane).
- HARD9-003 (Android bottom safe-area inset) is a HIL-proven P1 usability
  blocker per the operating instructions — fix early if auth work stalls.

## Notes for next LLM
- Branch is `fix/hardening` (not a new `fix/hardening-9-fable-app-hardening`
  branch — one already existed with this progress file from a prior run, so
  work continued on it per the "if such a branch already exists, continue on
  it" instruction).
- `ProbeInfoResult.authRequired` is now the app-wide signal for explicit
  saved-device switch/add-device verification failures. `probeOnce` uses
  `notifyAuthRequired` directly because discovery probes return only boolean.
- When touching anything that mocks `@/lib/c64api/transportErrors` in tests,
  remember the mock must now export `isAuthRequiredError` too (real module
  exports `normalizeTransportError` + `isAuthRequiredError` +
  `getHttpStatusFromError` + more — check the real file before mocking).
- `.worktrees/stabilize-structured-soak/` contains an unrelated concurrent
  worktree with its own copy of `src/pages/SettingsPage.tsx` — do not touch
  it; it's a separate workspace, not stray output from this task.
