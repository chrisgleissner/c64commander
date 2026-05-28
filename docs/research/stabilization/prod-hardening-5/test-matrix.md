# Prod-Hardening-5 Test Matrix

Per recommended PH5 task, this matrix specifies the deterministic proofs the next
implementation pass must add. Every task has a unit/integration test that fails
before the fix and passes after it.

## PH5-04-IMPORT-CANCEL-GENERATION

| Test layer | Path (suggested) | Contract |
| ---------- | ---------------- | -------- |
| Unit | `tests/unit/playFiles/addFileSelections.deviceSwitch.test.ts` | Recursive import in progress; `resetInteractionState("saved-device-switch")` is invoked OR a saved-device-switch event fires; no later `appendPlayableFile`/`onItemsAdded` call is made; one classified cancellation log is emitted. |
| Unit | same file, second describe | User Cancel still works on its own and aborts the import without firing the saved-device-switch path. |
| Unit | `tests/unit/hooks/useDiskLibrary.deviceSwitch.test.ts` | Recursive disk import in progress; saved-device switch fires; no later `addDisks` mutation; pre-switch already-committed entries remain. |
| Unit | `tests/unit/hooks/useSavedDeviceSwitching.cancelsImport.test.tsx` | The switch hook either subscribes to the import abort signal or publishes a switch event; the import path observes it; assert via spies. |
| Integration | none | Deterministic JS-level tests are sufficient. |
| Playwright | none required | Existing Play import + saved-device switch coverage is adequate. |
| Maestro | none required | |
| Android JVM | none | No Kotlin changes planned. |
| Hardware | Optional `u64`-only smoke if `c64u` remains unreachable | Start recursive C64U import; before completion, switch saved device; confirm no ghost items appear in playlist/disk-library and the abort cancellation toast appears. |
| Expected failure before fix | The saved-device-switch case appends items mutated from the old-device source. |
| Expected pass after fix | Zero mutations after switch; one classified cancellation diagnostic. |
| Command to run | `npm run test -- tests/unit/playFiles/addFileSelections.deviceSwitch.test.ts tests/unit/hooks/useDiskLibrary.deviceSwitch.test.ts tests/unit/hooks/useSavedDeviceSwitching.cancelsImport.test.tsx` |
| Evidence to capture | New test file paths + green run output recorded in WORKLOG.md and results.md. |

## PH5-05-NATIVE-LISTENER-ONCE-PROOF

| Test layer | Path (suggested) | Contract |
| ---------- | ---------------- | -------- |
| Unit | `tests/unit/pages/playFiles/PlayFilesPage.backgroundAutoSkipListener.test.tsx` | Mount Play Files with mocked `BackgroundExecution`. Drive a sequence of state transitions (start, pause, resume, next, stop). Assert `addListener` called exactly once and `removeListener` only on unmount. |
| Unit | same file | Simulated `backgroundAutoSkipDue` event still triggers exactly-once auto-advance with current playback state read through refs. |
| Integration | none | |
| Playwright | none required | PH4 hardware evidence covered this. |
| Hardware | none required | |
| Expected failure before fix | Hypothetical regression: if a future refactor reintroduces volatile deps, the test fails because `addListener` count > 1. |
| Expected pass after fix | Listener count == 1. |
| Command to run | `npm run test -- tests/unit/pages/playFiles/PlayFilesPage.backgroundAutoSkipListener.test.tsx` |
| Evidence to capture | New test file + green run. |

## PH5-06-IDB-CONSOLE-WARN-ROUTING

| Test layer | Path (suggested) | Contract |
| ---------- | ---------------- | -------- |
| Unit | `tests/unit/lib/playlistRepository/indexedDbRepository.consoleQuiet.test.ts` (or extend an existing file) | Trigger each IndexedDB load/open/schema-mismatch failure path with a stub; spy on `console.warn`; assert zero direct `console.warn` calls. Spy on `addLog`; assert exactly one `addLog("warn", ...)` per failure with the expected message and details. |
| Integration | none | |
| Playwright | none required | |
| Hardware | none required | |
| Expected failure before fix | `console.warn` spy receives 1+ calls. |
| Expected pass after fix | `console.warn` spy receives 0 calls; `addLog("warn", ...)` spy receives the expected calls. |
| Command to run | `npm run test -- tests/unit/lib/playlistRepository/indexedDbRepository.consoleQuiet.test.ts` |
| Evidence to capture | Green test run. |

## PH5-01-CONCURRENT-WORKTREE-LANDING

| Test layer | Path | Contract |
| ---------- | ---- | -------- |
| Existing | `tests/unit/playFiles/usePlaybackController.concurrency.test.tsx` | The 88-line addition already in the worktree must pass after landing. |
| Existing | gateway tests for FTP cooldown | Removal of `ftpCooldownUntil` must not break any FTP gateway behavior. Run `tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts` and any FTP-related tests. |
| Command to run | `npm run test -- tests/unit/playFiles/usePlaybackController.concurrency.test.tsx tests/unit/lib/deviceInteraction/deviceInteractionManager.test.ts tests/unit/lib/ftp/ftpClient.test.ts` |
| Evidence to capture | Decision (land vs. revert), test outcomes. |

## Final validation

After all four task fixes:

```
npm run test
npm run lint
npm run build
npm run test:coverage
```

- Global branch coverage must remain >= 91 percent.
- Patch (changed-line) coverage must remain >= 91 percent for executable TS/TSX
  changes (reuse the PH4 local check approach if no repository script is available).
- If Android/Kotlin code is touched (none planned), run
  `cd android && ./gradlew :app:testDebugUnitTest` for the changed plugin.

## Hardware validation matrix

| Task | Required | Optional | Blocker behavior |
| ---- | -------- | -------- | ---------------- |
| PH5-04 | No (deterministic JS-level proof sufficient) | `u64` smoke: start recursive C64U import then switch | Record `c64u` outage if encountered |
| PH5-05 | No | none | n/a |
| PH5-06 | No | Pixel 4 launch verifying WebView console silence on a known-good cold boot | Record blocker if APK build fails |
| PH5-01 | No | n/a | n/a |

If hardware is reached, capture the exact target, product identity, firmware,
APK path, device serial, and outcomes in WORKLOG.md and results.md.

## Coverage thresholds reaffirmed

- Global branch >= 91 percent (current 91.66 percent per PH4).
- Patch lines >= 91 percent.
- `agents/` not in scope; no Python tests required for PH5.
