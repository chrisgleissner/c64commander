# C64 Commander Reliability Analysis 2

Date: 2026-03-06
Scope: Follow-up reliability investigation after `reliability1`, including on-device Android validation and one production connectivity hotfix

## 1. Executive summary

Re-validating current code against `reliability1` outcomes found active reliability defects and partial regressions. I did not assume prior fixes were complete.

New/remaining findings:

1. HVSC cancellation can converge to `error` instead of deterministic cancelled/idle.
2. Android native FTP has no operation timeout/cancel path and runs on a single worker thread.
3. Source navigator stale-request handling is incomplete (stale error and loading-state races).
4. Disk library state can leak across device changes.
5. Playlist repository hydration can drop local `sourceId` and reduce restore reliability.
6. Non-song auto-advance still has no fallback duration for newly added entries.
7. Volume write failures are still swallowed in one path; mute toggle invocation is fire-and-forget.
8. HVSC progress listener registration has a cleanup race.
9. Android runtime transport regressed into hard demo fallback (`https://localhost` + browser `fetch` to `http://...`).
10. Device hostname resolution for `c64u` is not reliable on the Samsung Note 3 test target.
11. HVSC ingestion fails natively on-device for baseline archive compression method `[3, 4, 1]`.
12. HVSC status/progress state can become internally inconsistent after ingestion failure.
13. Service worker registration fails on Android runtime (`http://localhost/sw.js`) and adds noisy startup errors.
14. Save RAM / Load RAM behavior diverges from the known-good shell scripts, breaking full-RAM restore.

## 2. Findings

### R2-1: HVSC cancel state can race back to `error`

Evidence:

- Cancellation helper sets idle/cancelled then throws: `src/lib/hvsc/hvscDownload.ts:383-392`.
- Non-native ingest callback does the same: `src/lib/hvsc/hvscIngestionRuntime.ts:419-423`.
- Top-level catches always set `ingestionState: "error"`:
  - `src/lib/hvsc/hvscIngestionRuntime.ts:952-978`
  - `src/lib/hvsc/hvscIngestionRuntime.ts:1151-1173`

Risk:

- User-initiated cancel can end in error state and error UI, causing wrong recovery paths and noisy diagnostics.

Test gap:

- `tests/unit/hvsc/hvscIngestionRuntime.test.ts` covers cancellation token reuse (`:299-302`) but does not assert final state convergence for cancel-during-ingest paths.

### R2-2: Android FTP native calls can hang indefinitely

Evidence:

- Single-thread executor serializes all FTP work: `android/app/src/main/java/uk/gleissner/c64commander/FtpClientPlugin.kt:28`.
- `connect/login/retrieveFile` are used without configured connect/data timeout controls:
  - list path: `.../FtpClientPlugin.kt:65-99`
  - read path: `.../FtpClientPlugin.kt:135-159`
- JS bridge types expose no timeout/cancel controls for native calls: `src/lib/native/ftpClient.ts:20-41`.

Risk:

- One blocked network call can block all later FTP operations; browse/play flows can appear permanently stuck.

Test gap:

- `android/app/src/test/java/uk/gleissner/c64commander/FtpClientPluginTest.kt` validates success/failure branches but has no timeout/hung-call behavior checks.

### R2-3: Source navigator stale error/loading race

Evidence:

- Stale token check exists on success path only: `src/lib/sourceNavigation/useSourceNavigator.ts:69`.
- Catch path updates error without stale-token guard: `.../useSourceNavigator.ts:72-84`.
- Finally unconditionally clears loading: `.../useSourceNavigator.ts:109`.

Risk:

- Older failing request can overwrite current request state (`error`, `isLoading`), causing flicker and false-idle UI.

Test gap:

- `tests/unit/sourceNavigation/useSourceNavigator.test.ts` covers stale success discard (`:136-196`) but not stale error or loading race behavior.

### R2-4: Disk library state can bleed across device IDs

Evidence:

- On `uniqueId` change, loaded disks are merged with prior in-memory `prev` disks: `src/hooks/useDiskLibrary.ts:45-53`.
- `lastUniqueIdRef` is tracked but not used to reset state: `src/hooks/useDiskLibrary.ts:32,54`.

Risk:

- Device A disks can appear while connected to Device B, including wrong mount/eject target selection.

Test gap:

- `tests/unit/hooks/useDiskLibrary.test.ts` does not cover `uniqueId` switch contamination.

### R2-5: Repository hydration can drop local `sourceId`

Evidence:

- Serialization stores `sourceLocator` as normalized file path: `src/pages/playFiles/hooks/usePlaybackPersistence.ts:160-165`.
- Hydration reconstructs local `sourceId` from `sourceLocator`, but treats leading `/` as null:
  `src/pages/playFiles/hooks/usePlaybackPersistence.ts:217-219`.

Risk:

- Restored local playlist items can lose source binding, making runtime file/tree URI lookup less reliable after restart.

Test gap:

- Existing tests cover local restore from legacy localStorage blob (`tests/unit/playFiles/usePlaybackPersistence.test.tsx:120-153`) and HVSC repository hydration (`:189-245`), but not local-source repository hydration.

### R2-6: Non-song auto-advance still lacks default-duration fallback

Evidence:

- Newly added playables are created with `durationMs: undefined`: `src/pages/playFiles/handlers/addFileSelections.ts:389-394`.
- Playback resolves non-song duration without fallback (`sid/mod` only use `durationFallbackMs`):
  `src/pages/playFiles/hooks/usePlaybackController.ts:347-350`.
- Auto-advance guard is only armed when `resolvedDuration` is numeric:
  `src/pages/playFiles/hooks/usePlaybackController.ts:364-375`.

Risk:

- `prg`/`crt`/`disk` entries without pre-populated duration will not auto-advance.

Test gap:

- `tests/unit/playFiles/autoAdvanceGuard.test.ts` validates guard mechanics in isolation and explicitly accepts undefined duration as no-op (`:78-81`), but does not verify end-to-end fallback assignment for non-song categories.

### R2-7: Volume failure observability gap remains

Evidence:

- `scheduleVolumeUpdate` swallows write errors (`catch { return; }`) without log/report:
  `src/pages/playFiles/hooks/useVolumeOverride.ts:308-312`.
- UI invokes mute toggle fire-and-forget: `src/pages/PlayFilesPage.tsx:1022`.
- `handleToggleMute` awaits writes that can throw: `src/pages/playFiles/hooks/useVolumeOverride.ts:404-420`.

Risk:

- User sees no explicit failure signal for some write failures; async rejection handling is inconsistent.

Test gap:

- Existing race tests in `tests/unit/playFiles/volumeMuteRace.test.ts` do not assert logging/reporting behavior for debounced volume-write failures.

### R2-8: HVSC progress listener cleanup race

Evidence:

- Listener registration is async (`...addHvscProgressListener(...).then(...)`):
  `src/pages/playFiles/hooks/useHvscLibrary.ts:488-490`.
- Cleanup can run before `removeListener` is assigned: `.../useHvscLibrary.ts:491-500`.

Risk:

- Component unmount during registration window can leave a dangling listener.

Test gap:

- No unit test asserts listener removal when unmount occurs before async registration resolves.

### R2-9: Android REST transport regression forced demo mode

Evidence:

- On-device logs before fix repeatedly showed mixed-content blocking:
  - `Mixed Content ... 'https://localhost' ... 'http://c64u/v1/info' ... blocked`
- Even after forcing `http://localhost`, browser `fetch` path still failed against real host with:
  - `TypeError: Failed to fetch` / `Host unreachable`
- Root cause was Android WebView network path for C64U REST (mixed-content + browser CORS policy), while API code uses `fetch`: `src/lib/c64api.ts`.
- Hotfix validated on device:
  - [capacitor.config.ts](../../../../capacitor.config.ts) updated with `server.androidScheme = "http"` and `plugins.CapacitorHttp.enabled = true`.
  - Post-fix logs show native interceptor path:
    - `Handling CapacitorHttp request: ... _capacitor_http_interceptor_ ... u=http://192.168.1.13/...`
  - UI transitions to connected state (`Connected`, no demo interstitial).

Risk:

- Any Android build that routes REST through browser `fetch` can falsely degrade into demo mode despite reachable hardware.

Test gap:

- No device-level integration gate currently asserts that Android builds can perform `/v1/info` and `/v1/configs` against a real C64U without entering demo mode.

### R2-10: `c64u` hostname resolution is environment-fragile on Android target

Evidence:

- On Samsung Note 3 shell:
  - `ping c64u` => `unknown host`
  - `ping 192.168.1.13` succeeds (0% packet loss)
- Demo interstitial appears with default host `c64u`; saving explicit IP restores connectivity.

Risk:

- Default host can drive users into persistent demo-mode loops even when device is reachable by IP.

Test gap:

- No automated connectivity scenario verifies fallback behavior when hostname DNS fails but direct IP is reachable.

### R2-11: HVSC baseline ingestion fails on Android native decompression

Evidence:

- On-device HVSC flow:
  - download completes
  - ingest fails with `Unsupported compression method [3, 4, 1] used in ... hvsc-baseline-84.7z`
- Native stack traces point to:
  - `org.apache.commons.compress.archivers.sevenz.Coders.addDecoder`
  - `uk.gleissner.c64commander.HvscIngestionPlugin.kt:405`
  - `uk.gleissner.c64commander.HvscIngestionPlugin.kt:648`

Risk:

- HVSC install path is non-functional on at least one real Android class/device, blocking core media browsing use-case.

Test gap:

- Android ingestion tests do not currently validate archive-method compatibility against the live HVSC baseline artifact profile.

### R2-12: HVSC status model can show conflicting terminal state

Evidence:

- UI observed simultaneously:
  - `Status: Extracting` / `Extraction + indexing ... in-progress`
  - plus terminal failure message for unsupported compression.
- Persisted state captured with:
  - `c64u_hvsc_state:v1` still in `ingestionState: "installing"`
  - while app logs include `HVSC ingestion failed`.

Risk:

- Users receive contradictory progress, causing retry/cancel confusion and unreliable support diagnostics.

Test gap:

- No end-to-end assertion that failure transitions atomically settle `download`, `extraction`, and `ingestionState` to a single terminal outcome.

### R2-13: Service worker registration noise on Android runtime

Evidence:

- Recent runtime logs include:
  - `Service worker registration failed ... Failed to register ... http://localhost/sw.js`

Risk:

- Startup diagnostics noise hides actionable connectivity and ingestion failures.

Test gap:

- No Android runtime guard ensuring PWA-only paths are skipped or silenced under Capacitor host runtime.

### R2-14: RAM dump/restore path diverges from working device scripts

Evidence:

- `scripts/ram_read.py` pauses once, reads RAM in 16 x 4 KiB blocks, then resumes.
- `scripts/ram_write.py` validates a 65536-byte image, pauses once, writes the full image to `$0000` in one request, then resumes.
- `src/lib/machine/ramOperations.ts` already mirrors the dump script for reads, but `loadFullRamImage(...)` currently routes through `writeRanges(...)` and issues 16 x 4 KiB writes instead of one full-image write.

Risk:

- The Home page Save RAM / Load RAM buttons can report success while restore semantics differ from the only known-good device workflow, leaving RAM restore unreliable on real hardware.

Test gap:

- `tests/unit/machine/ramOperations.test.ts` currently locks in the incorrect chunked restore behavior by asserting 16 write calls for a full image.

## 3. Priority and blast radius

P0:

1. R2-9 Android REST transport regression / demo fallback
2. R2-11 HVSC native archive compatibility failure
3. R2-1 HVSC cancel state race
4. R2-2 Android FTP hanging behavior
5. R2-6 Non-song auto-advance fallback gap

P1:

1. R2-10 Hostname resolution fallback/UX gap
2. R2-12 HVSC state consistency mismatch
3. R2-3 Source navigator stale races
4. R2-5 Playlist local `sourceId` loss
5. R2-7 Volume failure observability

P2:

1. R2-13 Service worker noise under Android runtime
2. R2-4 Disk-library cross-device bleed
3. R2-8 HVSC listener cleanup race
4. R2-14 RAM dump/restore script parity

## 4. Cross-check against reliability1

`reliability1` addressed important areas, but this follow-up found remaining reliability risk in the same domains (playback progression, volume control, HVSC lifecycle) plus major Android runtime transport and archive-compatibility issues.

Hotfix status:

1. R2-9 is patched and validated on device via [capacitor.config.ts](../../../../capacitor.config.ts) (Android scheme + native HTTP fetch patching).
2. Remaining items stay open pending targeted code/test work.
