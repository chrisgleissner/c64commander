# Production Hardening 4 — Research & Evidence

> Pure research/documentation pass. No production code was changed. Implementation is driven by
> `prompt.md` in this folder.

## 1. Method

All findings are grounded in a live session against **real hardware**, not demo mode.

- **App build under test:** `c64commander-0.8.5-rc1` (versionCode 1980), the current
  `feat/prod-hardening-4` build. A fresh `./build` of the current tree produced an APK whose native
  layer was `UP-TO-DATE` versus the installed one, so the running instance reflects current source.
- **Android target:** Pixel 4, adb serial `9B081FFAZ001WX`, Android 16.
- **Devices (both became reachable during the session):**
  - `u64` — Ultimate 64 Elite, firmware `3.14e`, IP `192.168.1.13`, unique id `38C1BA` (preferred).
  - `c64u` — C64 Ultimate, firmware `1.1.0`, IP `192.168.1.167`, unique id `5D4E12`. It was
    **down at session start** and came online mid-session (consistent with the known intermittent
    drop-out; see memory `c64u-flakiness`).
- **Observation channels:**
  1. `adb logcat` (full capture) — native crashes, Capacitor plugin traffic, `Capacitor/Console`.
  2. **WebView DevTools (CDP)** over `localabstract:webview_devtools_remote_<pid>` forwarded to
     `tcp:9222`. A small Node client subscribed to `Runtime.consoleAPICalled`,
     `Runtime.exceptionThrown`, `Log.entryAdded`, and `Network.*` to capture every JS console line,
     exception, and failed request with timestamps. `Runtime.evaluate` was used to read app runtime
     state (`localStorage`, the in-app `c64u_app_logs` store, playback timers).
  3. Direct REST/FTP probes from the host to corroborate device-side truth.
- **Coverage:** Play (extensive), Config, Disks, Home, Settings device-switcher; device switch
  `u64 → c64u → u64`; app background/foreground during playback.

### Session error budget

Across the entire heavy session (FTP browse, a 4-item mixed playlist, playback start, rapid
Next/Prev, volume drag, config slider drag, two device switches, background/foreground, navigation
of every page) the **only** errors observed anywhere were:

1. One `ERR_CONNECTION_REFUSED` probing `c64u` while it was genuinely offline (expected).
2. The FTP `/USB2` connect timeout described in Finding 1 (the one real reliability defect witnessed).

The app is otherwise very stable. There were **no crashes, no unhandled JS exceptions, no ANRs**.

## 2. Confirmed issues

### F1 — FTP to the Ultimate intermittently times out on sequential navigation; no auto-retry, over-long connect timeout (HIGH)

**Witnessed.** With `u64` healthy, browsing **Add items → C64U → root** listed `Flash/Temp/USB2`
instantly. Opening **`/USB2`** immediately afterwards hung ~8 s then failed; the browser silently
reverted to the root listing (a "Browse failed" toast fired but the list did not change). The
in-app log captured:

```
FTP listDirectory failed  (FtpClientPlugin, COR-…)
  SocketTimeoutException: failed to connect to /192.168.1.13 (port 21)
  from /192.168.1.206 (port 40970) after 8000ms
    at org.apache.commons.net.SocketClient.connect(...)
    at uk.gleissner.c64commander.FtpClientPlugin.listDirectory$lambda$2(FtpClientPlugin.kt:127)
```

**Corroboration.** From the host, `ftp://192.168.1.13/` and `ftp://192.168.1.13/USB2/` both listed
instantly and reliably at the same moment — the device FTP was healthy. **Re-tapping `/USB2` in the
app succeeded.** So the failure was a transient stall accepting a *new* control connection right
after the previous session closed — the well-known Ultimate FTP fragility under rapid sequential
reconnects.

**Code.** `android/.../FtpClientPlugin.kt` opens a **fresh `connect()` + `login()` + `disconnect()`
per call** on a single-thread executor. Connect timeout defaults to `8000 ms`
(`defaultTimeoutMs`, coerced 1000–60000). The JS gateway (`deviceInteractionManager.ts`) applies a
per-mode `ftpListCooldownMs` (100–800 ms) between LIST calls, plus failure backoff and a circuit
breaker — **but nothing retries the failed call**; backoff only delays the *next* user-initiated
call. `src/lib/ftp/ftpClient.ts` re-throws on failure with no retry.

**Why it matters for production.** This is not limited to browsing. Playing **C64U-sourced SID/disk
items** reads blobs over FTP (`FtpClient.readFile`) for MD5/duration and for cross-device disk
upload, in addition to the runner calls. A playlist of C64U items therefore drives a high rate of
short-lived FTP connections, each of which can hit this stall — turning a transient device quirk
into intermittent playback/browse failures that the user must manually retry.

**Fix class (app-side; do not chase firmware):**
- Lower the FTP **connect** timeout for the LAN case (a real connect succeeds in milliseconds; 8 s
  is pure dead time). Keep data/read timeouts generous.
- Add a **single bounded automatic retry** on transient connect/timeout failures
  (`SocketTimeoutException`, connection-refused/reset during connect) with a short pre-retry pause
  (a few hundred ms) so the device can finish tearing down the previous session.
- Ensure a **minimum pacing gap between consecutive FTP connects** to the same host.
- The retry **must respect the circuit breaker** and must not bypass the gateway.

### F2 — Rapid manual Next/Previous replays every intermediate item on the device (MEDIUM)

**Witnessed.** While playing item 0 (`anykey-c64.prg`), four rapid **Next** taps produced, ~2 s
apart and strictly serialized:

```
run_prg ?file=/USB2/_Test/joyride-c64.prg
run_prg ?file=/USB2/_Test/micromys-wheel.prg
machine:reboot
drives/a:mount ?image=/USB2/_Test/The_Great_Giana_Sisters_(REM).d64&type=d64&mode=readwrite
machine:writemem 0277 (LOAD"*",8,1:RUN)  +  writemem 00C6
```

i.e. it actually **started each intermediate track on the device** (two PRG resets + a disk
reboot/mount) instead of skipping to the final target.

**Code.** `usePlaybackController.ts` `enqueueUserTransport` chains user transport actions onto a
FIFO promise queue. This correctly enforces **single-flight** (no parallel/duplicate runners — a
real strength) but performs **no coalescing/supersession**: each queued `Next` runs `playItem`
fully, including device reboot/mount/run.

**Why it matters.** On a fragile device, four taps becoming a burst of resets + a disk mount is
exactly the kind of sequence that can wedge it, and the user who taps Next four times to reach
track 4 does not want tracks 1–3 booted on the machine first.

**Fix class.** Coalesce rapid manual skips: advance the index locally/immediately and debounce the
actual device `playItem` so only the **net target index** is launched. Preserve single-flight and
leave auto-advance (one item at a time) unchanged.

### F3 — `backgroundAutoSkipDue` native listener re-subscribes on every playback-state / callback change (MEDIUM)

**Witnessed.** logcat shows repeated `BackgroundExecution.addListener` / `removeListener` churn —
four add/remove cycles at startup **with nothing playing**, and continued churn during playback and
when backgrounding.

**Code.** `src/pages/PlayFilesPage.tsx:1137` registers the listener in a `useEffect` whose deps are
`[autoAdvanceGuardRef, handleNext, isPaused, isPlaying, syncPlaybackTimeline]`. `handleNext` and
`syncPlaybackTimeline` are `useCallback`s with many dependencies, and `isPlaying`/`isPaused` flip on
every transport action, so the effect tears the native listener down and re-registers it
constantly. Registration is `async`, so there is a window with **no listener attached**.

**Why it matters.** Beyond wasteful native-bridge churn, the async teardown/re-add window creates a
**correctness risk**: a native `backgroundAutoSkipDue` event delivered during that window can be
dropped, i.e. a missed background auto-advance — the exact job this listener exists to perform.

**Fix class.** Subscribe **once on mount** (deps limited to platform), and read the volatile values
(`isPlaying`, `isPaused`, `handleNext`, `syncPlaybackTimeline`, guard) through refs inside the
listener body. Keep the unmount cleanup.

## 3. Verified stable (no action — protect with regressions, do not "fix")

These were exercised on real hardware and behaved correctly. They are recorded so the
implementation pass does not destabilise them.

- **Volume slider coalescing (Play page):** 10 rapid drag swipes produced exactly **2** batched
  `CapacitorHttp.request` config writes; the device Audio Mixer ended at the final value. Bounded,
  no storm.
- **Config `ConfigItemRow` slider:** 10 rapid swipes → 6 bounded writes; device consistent; no
  errors. Acceptable.
- **Auto-advance (duration-driven):** with default duration forced to 10 s and Repeat on, playback
  auto-advanced Giana → anykey → joyride at ~10 s intervals, **exactly once each**, wrapped via
  Repeat, no duplicate runners, no errors.
- **End-of-playlist:** stopping at the last item with Repeat off (clock frozen at duration) is
  correct behaviour, not a hang.
- **Cross-device disk playback (device-bound origin):** after switching `u64 → c64u`, playing a
  `u64`-sourced disk correctly did `FtpClient.readFile` from the **origin** (`192.168.1.13`) and
  `mountDriveUpload` to the selected device (`c64u` `/Temp/temp0000`). `c64u` has no `/USB2` at all,
  yet the disk played correctly via origin fetch. Well engineered.
- **Disk mount cross-page consistency:** a disk mounted by Play showed correctly on the Disks page
  (Drive A, status OK).
- **App lifecycle:** the app uses web visibility events; Capacitor `pause`/`resume`/`appStateChange`
  have "no listeners" by design (only `backButton` is registered, in the licenses page). Resume was
  clean.
- **Exception discipline:** no empty `catch {}` blocks; the `catch → return null` sites that exist
  are logging-failure fallbacks that warn to console.

## 4. Notes for the implementer

- Prefer `u64` first, then `c64u`, when validating (both were live at the end of this session).
- The cleanest way to see app-internal logs/exceptions on device is the WebView DevTools socket
  (`adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>` then CDP `Runtime`/`Log`),
  plus the persisted `c64u_app_logs` localStorage store. `Capacitor/Console` lines also appear in
  `logcat`. Config **writes** go through the `CapacitorHttp.request` plugin (not the `fetch`
  interceptor), so count those when measuring write volume.
- `ftpMaxConcurrency` (per-mode, 1–3) gates JS-side FTP concurrency, but the native plugin executes
  on a **single thread**, so FTP ops are serialised regardless. Keep that in mind for F1 pacing.
