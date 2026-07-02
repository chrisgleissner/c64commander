# Hardening 9 — Fable Full-App Review

- **Date:** 2026-07-02
- **Reviewed version:** `0.9.0-afb6e` (commit `afb6ea72`, branch `fix/playback-hardening` == `main` HEAD)
- **Method:** 8 parallel deep subsystem reviews (playback, connection/transport, file sources, home/config,
  disks/snapshot, native Android, app shell/navigation/input/settings, state/query/diagnostics/startup),
  followed by direct spot-verification of the highest-severity claims against source, plus corroborating
  evidence from a live hardware session on the Pixel 4 + c64u earlier the same night. `tsc --noEmit` and
  `eslint --quiet` are both clean — every finding below is a logic/design defect, not a mechanical one.
- **Known-intentional designs were excluded** (native CapacitorHttp routing with timeouts = BUG-066 fix;
  HTTP keep-alive on despite the c64u firmware TCP wedge; PUT-not-POST for single config writes;
  wake-lock adoption-on-remount = BUG-025/040 fix; songlengths post-ingestion `force` reload; snapshot
  restore skipping CIA timer registers; config page rendering all live REST categories; routing-epoch
  query keys).

## How to use this document (for the fixing session)

Every finding has a stable ID `HARD9-NNN` and a label line. Grep for the ID to find it here; the
**Files** entries are `path:line` at commit `afb6ea72` (lines may drift — anchor on the quoted code).
Work in severity order unless a fix batch (see [Suggested fix batches](#suggested-fix-batches)) groups
findings in the same files. After fixing, flip **Status** in the [index](#index-of-findings) to
`FIXED (<commit>)`, and follow the project rule: fix production code, don't bend tests
(if a test disagrees, ask whether the new behavior makes sense for a USER).

Label semantics:

- **Severity:** `P0` wedges the app or hard-fails user CTAs under realistic conditions with no recovery
  signposting; `P1` user-visible loss/delay/data-damage under common conditions; `P2` narrower races,
  false positives, compounding latency; `P3` robustness/polish, low likelihood or low blast radius.
- **Dimensions:** `correctness`, `data-loss`, `ux-responsiveness`, `performance`, `robustness`,
  `security`, `a11y`.
- **Confidence:** `high` = full code path traced (a subset additionally spot-verified by a second
  reader, marked **[verified]**; two corroborated on real hardware, marked **[HIL]**); `medium` =
  strong code evidence, one link inferred.
- **Effort:** S (≤ ~1h focused change + test), M (multi-file change), L (design change).

---

## Dimension scorecard

Grades reflect the whole app at `afb6ea72`, weighing both the findings below and the large amount of
prior hardening (rounds 1–8) that demonstrably fixed most transport-layer P0s (see
[Carried-over verification](#carried-over-verification-from-hardening5)).

| Dimension | Grade | Assessment |
|---|---|---|
| Correctness | **C** | Core happy paths are solid and well-tested, but edge-case logic bugs are pervasive in every subsystem: playback state machine (HARD9-005..007, 029..031), config write coalescing (016), HVSC state (013..015), snapshot encoding (009). |
| Data integrity | **C−** | Multiple *silent* data-loss paths: full-range snapshots that save nothing (009), a failed HVSC promotion that can delete the whole library (040), playlist durations clobbered and persisted (005), disk library wipe on fast unmount (048), curated playlist order destroyed irreversibly (007), stale secrets persisted before verification (004). |
| UX responsiveness | **C+** | The single most damaging pattern is priority inversion on the native request lane (002) plus zero-delay background retries (023): user taps go dead for seconds exactly when the device is slow. Circuit/gate error toasts that never clear (024) and dead CTAs in reachable-looking UI (011, 047) compound it. |
| Performance | **C−** | Diagnostics amplification is the standout: full trace-ZIP export on every error (019), whole-store copies into a closed overlay on every event (021), O(store) localStorage writes per log line (020), plus playlist list rebuilds every second during playback (032) and multi-MB songlengths re-parses per track transition (008). |
| Robustness | **B−** | The TS transport layer is in good shape after rounds 1–8 (verified fixes). The native Kotlin layer is weaker: unsettled promises on cancel (013), FGS contract violations (041, 042), thread-safety gaps (043, 072), missing timeouts (074). |
| Security | **B** | No remote-facing criticals. Local attack surface: mock HTTP/FTP servers compiled into release builds listening on loopback (071); real decrypted password loaded into a masked field and silently persistable (004); smoke-mode latch via plain localStorage (059). |
| Accessibility | **B−** | Not deeply audited (scope was bug-hunting); what surfaced: duplicate DOM ids breaking label association (090), gesture-zone overlap making bottom controls untappable (003). |

---

## Index of findings

| ID | Title | Area | Sev | Dimensions | Conf | Effort | Status |
|---|---|---|---|---|---|---|---|
| HARD9-001 | Wrong/changed device password strands app in OFFLINE with no prompt | transport | P0 | ux, correctness, robustness | high [HIL] | M | FIXED (53eda43f) |
| HARD9-002 | Native FIFO request lane defeats user-intent priority | transport | P1 | ux, perf, correctness | high [verified] | M | FIXED (1ab881f5) |
| HARD9-003 | Android bottom safe-area inset hardcoded to 0 → controls in gesture zone | shell | P1 | ux, a11y, correctness | high [verified][HIL] | M | OPEN |
| HARD9-004 | Saved-password editor silently mutates and persists the secret | settings | P1 | data-loss, ux, security | high [verified][HIL] | M | FIXED (df7ddcd9) |
| HARD9-005 | Duration slider clobbers every playlist item's resolved duration | playback | P1 | correctness, data-loss | high [verified] | M | OPEN |
| HARD9-006 | Mid-track duration change never re-arms auto-advance guard | playback | P1 | correctness, ux | high | S | OPEN |
| HARD9-007 | Shuffle doesn't shuffle; Reshuffle irreversibly destroys order | playback | P1 | correctness, data-loss, ux | high | M | OPEN |
| HARD9-008 | Songlengths cache cleared on every playlist change → repeated multi-MB re-parses | playback | P1 | performance, ux | high | S | OPEN |
| HARD9-009 | Full-range custom snapshot silently saves empty (u16 truncation) | snapshot | P1 | correctness, data-loss | high [verified] | S | OPEN |
| HARD9-010 | Mount/eject success judged by HTTP status; firmware in-body errors discarded | disks | P1 | correctness, ux, robustness | medium | S | OPEN |
| HARD9-011 | CommoServe-imported disks permanently unmountable after remount | disks | P1 | data-loss, ux, correctness | high | M | OPEN |
| HARD9-012 | Disks page hardcodes read-only mounts, breaking in-game saves | disks | P1 | correctness, ux | medium | S | OPEN |
| HARD9-013 | HVSC ingest promise never settles after cancel (reject in cancelled coroutine) | native | P1 | correctness, ux, robustness | high [verified] | S | OPEN |
| HARD9-014 | Stale "update applied" records survive HVSC reset, block updates forever | hvsc | P1 | correctness, data-loss, ux | high [verified] | S | OPEN |
| HARD9-015 | Poisoned empty browse snapshot → recursive HVSC add returns zero songs | hvsc | P1 | correctness, ux, robustness | medium | M | OPEN |
| HARD9-016 | Latest-intent write lane drops committed writes to a different config item | config | P1 | data-loss, correctness, ux | high | M | OPEN |
| HARD9-017 | Profile load/revert/flash-load never invalidate `c64-config-items` | config | P1 | correctness, ux | high [verified] | S | OPEN |
| HARD9-018 | Save-to-App / revert baseline / verification read a stale persistent cache | config | P1 | correctness, data-loss | high | M | OPEN |
| HARD9-019 | Full trace ZIP exported on every recorded error | diagnostics | P1 | performance, ux | high | S | OPEN |
| HARD9-020 | Unguarded localStorage log writes; O(n) parse/stringify per log line | diagnostics | P1 | robustness, correctness, perf | high | M | OPEN |
| HARD9-021 | Closed diagnostics overlay copies full trace/log stores on every event | diagnostics | P1 | performance, ux | high | M | OPEN |
| HARD9-022 | CONSERVATIVE preset gets no half-open probe; user CTAs hard-fail in circuit window | transport | P2 | ux, correctness | high | S | FIXED (9ab556cb) |
| HARD9-023 | Background requests retry 3× with zero delay, holding the REST lane ~9s | transport | P2 | ux, perf, robustness | high | S | FIXED (3ceecd75) |
| HARD9-024 | Circuit/state-gate error toasts classified "unknown", never auto-clear | transport | P2 | ux, correctness | high | S | FIXED (22147b34) |
| HARD9-025 | Password field write race between connection state and secure-storage load | settings | P2 | correctness, data-loss | medium | S | FIXED (df7ddcd9) |
| HARD9-026 | 600ms drag-settle timer collapses a held swipe mid-gesture | shell | P2 | ux, correctness | high | S | OPEN |
| HARD9-027 | Diagnostics overlay scroll save/restore targets the wrong scroller (dead code) | shell | P2 | correctness, ux | high | S | OPEN |
| HARD9-028 | Saved-device switch reports auth failure as "offline" | settings | P2 | ux, correctness | medium | M | FIXED (df7ddcd9) |
| HARD9-029 | Playing a new track while machine paused leaves C64 frozen, UI "playing" | playback | P2 | correctness, robustness | medium | S | OPEN |
| HARD9-030 | Deleting the playing item resets UI but device keeps playing; watchdog armed | playback | P2 | correctness, ux | high | M | OPEN |
| HARD9-031 | Auto-advance dies when user navigates away from Play page | playback | P2 | correctness, ux | high | L | OPEN |
| HARD9-032 | Playlist rows rebuilt on every 1s timeline tick (memoization defeated) | playback | P2 | performance, ux | high | S | OPEN |
| HARD9-033 | Cancel during add-items can throw inside a React state updater | playback | P2 | robustness, correctness | medium | S | OPEN |
| HARD9-034 | Concurrent playlist repository commits can persist a stale snapshot | playback | P2 | data-loss, robustness | medium | M | OPEN |
| HARD9-035 | CPU snapshot "saved" toast while C64 left frozen (resume failure swallowed) | snapshot | P2 | correctness, robustness, ux | high | S | OPEN |
| HARD9-036 | CPU restore failure strands machine in restore cart; no RAM-only fallback | snapshot | P2 | correctness, robustness, ux | high | M | OPEN |
| HARD9-037 | Mount sheet permits concurrent mounts to the same drive | disks | P2 | correctness, ux | medium | S | OPEN |
| HARD9-038 | Local-disk rotation/eject-before-delete break after first drives poll | disks | P2 | correctness, ux | medium | M | OPEN |
| HARD9-039 | Capture-timeout rollback can corrupt safe region while CPU executes it | snapshot | P2 | correctness, robustness | medium | S | OPEN |
| HARD9-040 | Failed HVSC baseline promotion can delete the only library copy | native | P2 | data-loss, correctness, robustness | high | S | OPEN |
| HARD9-041 | Late setDueAtMs resurrects phantom FGS + wake lock after Stop | native | P2 | correctness, robustness, ux, perf | high | M | OPEN |
| HARD9-042 | Stale-generation FGS start intent never calls startForeground (crash risk) | native | P2 | correctness, robustness | medium | S | OPEN |
| HARD9-043 | SecureStorage builds EncryptedSharedPreferences per call, unsynchronized | native | P2 | correctness, data-loss, robustness, perf | medium | S | FIXED (52b59dd8) |
| HARD9-044 | FTP/SAF readFile buffers whole file ×3.3 in heap — OOM on large files | native | P2 | robustness, perf, correctness | high | M | OPEN |
| HARD9-045 | normalizeSourcePath collapses internal whitespace, corrupting paths | sources | P2 | correctness, robustness | high | S | OPEN |
| HARD9-046 | Ingestion finalize overwrites songlengths projection with duration-less records | hvsc | P2 | correctness, data-loss | medium | M | OPEN |
| HARD9-047 | Web local sources list files after reload that can no longer be opened | sources | P2 | correctness, ux | medium | M | OPEN |
| HARD9-048 | Disk library save effect writes stale/empty state before load settles | sources | P2 | data-loss, robustness | medium | S | OPEN |
| HARD9-049 | Archive entries with a dot in the name rejected despite byte detection | sources | P2 | correctness, ux | high | S | OPEN |
| HARD9-050 | Throttled-preview sliders leave device at intermediate value on return-to-start | config | P2 | correctness, ux | high | S | OPEN |
| HARD9-051 | Home quick-config writes never set hasChanges → Revert stays disabled | config | P2 | correctness, ux | high | S | OPEN |
| HARD9-052 | Home optimistic pins: no routing-epoch clear, no watchdog | config | P2 | robustness, ux | high | S | OPEN |
| HARD9-053 | Profile load/revert sends entire config as one giant POST /v1/configs | config | P2 | robustness, perf | medium | M | OPEN |
| HARD9-054 | Audio Mixer solo routing bypasses mutation layer; stale snapshot restore | config | P2 | correctness, robustness | medium | M | OPEN |
| HARD9-055 | Error-toast eviction + sliding dedup window silently hide persistent failures | diagnostics | P2 | correctness, ux | high | M | OPEN |
| HARD9-056 | Backend-decision correlation set grows unbounded | diagnostics | P2 | performance, robustness | high | S | OPEN |
| HARD9-057 | Trace persistence exceeds sessionStorage quota; size accounting broken on restore | diagnostics | P2 | performance, data-loss, correctness | high | S | OPEN |
| HARD9-058 | Fetch trace duplicates full request/response payloads in the hot path | diagnostics | P2 | performance | high | M | OPEN |
| HARD9-059 | Smoke-mode localStorage fallback is a self-perpetuating latch in prod | state | P2 | robustness, security, correctness | medium | S | OPEN |
| HARD9-060 | Background health probes pass allowDuringError but the state gate ignores it | transport | P3 | correctness, ux | high | S | FIXED (1d16f3de) |
| HARD9-061 | Second user CTA during half-open circuit probe hard-fails instead of queueing | transport | P3 | ux | high | S | FIXED (82492610) |
| HARD9-062 | Startup saved-device fallback commits selection before verification | transport | P3 | correctness, ux | medium | S | FIXED (16fc9351) |
| HARD9-063 | Volume sync wedges after starting a new track from paused state | playback | P3 | correctness, robustness | medium | S | OPEN |
| HARD9-064 | Session restore revives "playing" UI for a dead device session | playback | P3 | correctness, ux | medium | S | OPEN |
| HARD9-065 | resolveVolumeSyncDecision is dead code diverging from live sync logic | playback | P3 | robustness | high | S | OPEN |
| HARD9-066 | handlePlaylistSelect carries a bogus dependency | playback | P3 | robustness | high | S | OPEN |
| HARD9-067 | Snapshot restore halts CIA TOD clocks / flips ICR mask bits | snapshot | P3 | correctness | medium | S | OPEN |
| HARD9-068 | resolveLocalDiskBlob cross-source fallback can mount the wrong disk | disks | P3 | correctness | medium | S | OPEN |
| HARD9-069 | Snapshot store silently drops oldest snapshot at the 100 cap | snapshot | P3 | data-loss, ux | high | S | OPEN |
| HARD9-070 | FTP control encoding never set — non-ASCII filenames unfetchable | native | P3 | correctness, ux | medium | S | OPEN |
| HARD9-071 | Mock C64U HTTP+FTP servers ship in release builds, registered unconditionally | native | P3 | security, robustness | high | M | OPEN |
| HARD9-072 | TelnetSocket state read/written across threads without synchronization | native | P3 | correctness, robustness | high | S | OPEN |
| HARD9-073 | cancelRead after completion leaves permanent entries in cancelledReads | native | P3 | correctness, performance | high | S | OPEN |
| HARD9-074 | 7-Zip probe subprocess has no timeout — wedged probe bricks ingestion | native | P3 | robustness, ux | medium | S | OPEN |
| HARD9-075 | queryAllSongs materializes 50k rows on the shared Capacitor plugin thread | native | P3 | performance, ux | high | S | OPEN |
| HARD9-076 | Device-discovery probe leaks HttpURLConnection on body-read failure | native | P3 | robustness, performance | high | S | OPEN |
| HARD9-077 | MainActivity.onCreate does synchronous filesystem repair on main thread | native | P3 | ux, performance | high | S | OPEN |
| HARD9-078 | Recursive FTP listing's timed_out flag dropped by the JS contract | native | P3 | correctness | high | S | OPEN |
| HARD9-079 | Native CommoServe transport ignores AbortSignal — Cancel doesn't cancel | sources | P3 | robustness, perf, ux | high | M | OPEN |
| HARD9-080 | Shared preset-refresh promise: unmount-abort → unhandled rejection, stuck status | sources | P3 | robustness, correctness | high | S | OPEN |
| HARD9-081 | Web FTP recursive scan unbounded while native caps at depth 8 / 5000 | sources | P3 | robustness, perf, correctness | high | S | OPEN |
| HARD9-082 | Refresh clears only the exact current path; recursive adds serve 10-min-stale cache | sources | P3 | correctness, ux | high | S | OPEN |
| HARD9-083 | Pre-aborted FTP read still performs the full transfer | sources | P3 | robustness, performance | medium | S | OPEN |
| HARD9-084 | HVSC cancellation unchecked during deletion pass and finalize | hvsc | P3 | ux, robustness | high | S | OPEN |
| HARD9-085 | CategorySection disables every row while any single write is pending | config | P3 | ux | medium | S | OPEN |
| HARD9-086 | Optimistic rollback can resurrect a stale pin on racing writes | config | P3 | correctness | high | S | OPEN |
| HARD9-087 | useInteractiveConfigWrite pending/burst flags wrong under concurrent writes | config | P3 | correctness, ux | high | S | OPEN |
| HARD9-088 | Failed throttled preview snaps the slider thumb back mid-drag | config | P3 | ux, robustness | high | S | OPEN |
| HARD9-089 | Category Refresh drops optimistic pins even when the refetch failed | config | P3 | robustness, correctness | medium | S | OPEN |
| HARD9-090 | Duplicate "Automatic Demo Mode" control with duplicate DOM id | settings | P3 | a11y, correctness | high | S | OPEN |
| HARD9-091 | Notification-duration slider persists on every drag tick | settings | P3 | performance, robustness | high | S | OPEN |
| HARD9-092 | Orientation lock re-applied on every SettingsPage mount (incl. swipe transits) | settings | P3 | robustness, performance | high | S | OPEN |
| HARD9-093 | Mouse-drag gesture state stranded by a missed pointerup before intent lock | shell | P3 | robustness, ux | medium | S | OPEN |
| HARD9-094 | Deferred startup bootstrap never runs if the app launches hidden | state | P3 | robustness, correctness | medium | S | OPEN |
| HARD9-095 | Module-scope import.meta.env read in App.tsx (Playwright collection tripwire) | state | P3 | robustness | high | S | OPEN |

---

## P0 — Critical

### HARD9-001 — Wrong or changed device password strands the app in OFFLINE with no password prompt and no visible reason
- **Area:** transport · **Severity:** P0 · **Dimensions:** ux-responsiveness, correctness, robustness · **Confidence:** high **[HIL]** · **Effort:** M · **Status:** FIXED (53eda43f)
- **Files:** `src/lib/c64api.ts:1239`, `src/lib/connection/connectionManager.ts:224-250`, `src/lib/deviceInteraction/deviceInteractionManager.ts:548-554`, `src/lib/diagnostics/healthCheckEngine.ts:188-192`
- **Failure scenario:** User changes/enables the network password on the C64U (or secure storage loses the stored one, or a corrupted password gets saved — see HARD9-004). On next app start every discovery probe gets HTTP 403, but probes run with `__c64uIntent: "system"` which auto-suppresses the global auth challenge (`c64api.ts:1239`), and `probeOnce` doesn't record HTTP errors into `lastProbeError` (only non-`HTTP \d+` messages). Discovery expires into `OFFLINE_NO_DEMO`. In OFFLINE the device state is ERROR: background probes are blocked before any HTTP, and on CONSERVATIVE (the AUTO default while firmware is unknown — which it necessarily is behind a 403) user CTAs are blocked too, so *nothing can ever produce the 403 that would raise `notifyAuthRequired`*. The app shows plain OFFLINE indefinitely; the only recovery is the user guessing to re-enter the password. **Observed live on hardware tonight:** a c64u with password `pwd` and a saved wrong password `pwdt` showed nothing but a generic `OFFLINE ○` badge while `X-Password: pwdt` requests failed in logcat.
- **Evidence:** `isAuthRequiredError` is consumed only by the add-device flow and `DeviceDiscoveryInterstitial` (`addDeviceReachability.ts:55`, `DeviceDiscoveryInterstitial.tsx:306/340`); no OFFLINE-banner, probe, health-check, or switch path maps 401/403 to the auth challenge. `maybeRaiseAuthChallenge` fires only from non-suppressed `request()` failures (`c64api.ts:846-849, 1427`), which cannot occur in the OFFLINE+CONSERVATIVE state machine.
- **Fix sketch:** In `probeOnce`/`probeInfoWithConnectionConfig`, detect `isAuthRequiredError` and (a) set a distinct probe error ("Password required"), (b) raise `notifyAuthRequired` or a connection-snapshot `authRequired` flag that the OFFLINE banner turns into the password popup. Surface "needs password" as a distinct saved-device-switch outcome (see HARD9-028). Reflect an AUTH state distinct from OFFLINE in the health badge.
- **Resolution (53eda43f):** `probeOnce` now detects 401/403 via `isAuthRequiredError`, records `lastProbeError` as "Password required", and raises the app-wide `notifyAuthRequired` dialog even though system discovery probes suppress the normal request-layer auth popup. Startup discovery window expiry now preserves an auth-required probe failure instead of overwriting it with the automatic LAN-discovery fallback, so the user sees the password prompt/reason while the connection state settles to `OFFLINE_NO_DEMO`. Added regression coverage for both the direct 403 probe path and the full startup discovery path where every probe is rejected for auth; non-auth HTTP failures still do not raise the password prompt.

---

## P1 — High

### HARD9-002 — Native FIFO request lane defeats user-intent priority and holds the slot through cooldown/backoff deferrals
- **Area:** transport · **Severity:** P1 · **Dimensions:** ux-responsiveness, performance, correctness · **Confidence:** high **[verified]** · **Effort:** M · **Status:** FIXED (1ab881f5)
- **Files:** `src/lib/c64api.ts:518-549`, `src/lib/c64api.ts:1663-1666`, `src/lib/deviceInteraction/deviceInteractionManager.ts:207-223`, `src/lib/deviceInteraction/deviceInteractionManager.ts:818-833`
- **Failure scenario:** On Android with CONSERVATIVE (AUTO default for every c64u until firmware is known), a background `/v1/configs` or `/v1/drives` read enters `serializeNativeDeviceRequest` and then sits in the REST scheduler deferred by `getReadyAtMs` (configsCooldown 1200ms, or backoff up to 6000ms) — *while holding the single native slot*. A user tap (Reset, Pause, mount) is pushed into `nativeDeviceRequestQueue`, which is strict FIFO with no intent field, so the CTA waits out the background read's entire cooldown/backoff plus every already-queued request. Taps feel dead for multiple seconds exactly when the device is slow.
- **Evidence:** `request()` builds `executeRequest = () => serializeNativeDeviceRequest(runRequest, restMaxConcurrency)` (`c64api.ts:1663-1666`); the slot is acquired before `runRequest` runs (`await new Promise(...queue.push...); return await run()`) and `pumpNativeDeviceRequestQueue` pops FIFO. `runRequest` → `withRestInteraction` → `restScheduler.schedule({...getReadyAtMs})`; deferred tasks keep the slot occupied. With limit 1, the priority scheduler only ever holds one `request()`-originated task at a time — `user > system > background` ordering is unreachable for the entire REST surface on native.
- **Fix sketch:** Acquire the native slot *inside* the scheduled task (wrap the `withRestInteraction` handler, not the whole `runRequest`), or give `nativeDeviceRequestQueue` intent-priority ordering. Don't hold the slot across `getReadyAtMs` deferrals — only while a request is actually in flight.
- **Notes:** Introduced with the BUG-066/native-serialization work; the scheduler priority verified in hardening/5 is now bypassed on native.
- **Resolution (1ab881f5):** Native direct-device REST serialization now wraps only the actual request handler inside `withRestInteraction`, after scheduler priority/cooldown/backoff admission, instead of wrapping the whole scheduled request. Background work that is waiting for scheduler cooldown no longer occupies the only native device slot, so ready user CTAs can run first while actual native direct-device I/O remains serialized. Added regression coverage where a cooled background `saveConfig` is pending and a user `getInfo` reaches `CapacitorHttp` before the delayed background request.

### HARD9-003 — Android bottom safe-area inset hardcoded to 0 — bottom controls sit in the system gesture zone
- **Area:** shell · **Severity:** P1 · **Dimensions:** ux-responsiveness, a11y, correctness · **Confidence:** high **[verified][HIL]** · **Effort:** M · **Status:** OPEN
- **Files:** `src/lib/native/safeArea.ts:55-60`, `android/.../MainActivity.kt:113`, `src/index.css:30-45,763-767`, `android/.../SafeAreaPlugin.kt:74-82`
- **Failure scenario:** Pixel 4, gesture navigation, "Hide navigation bar" on. The app is edge-to-edge (`WindowCompat.setDecorFitsSystemWindows(window, false)`) and the WebView's `env(safe-area-inset-bottom)` is 0, so the only bottom-inset source is the native sync — which `normalizeAndroidInsets` unconditionally zeroes (`bottom: 0`). The tab bar and — whenever the tab bar is absent or the IME places form content at the visual bottom (e.g. typing the Network Password) — page controls like "Save & Connect" sit in the last ~24dp where HOME/back gestures stay live: taps trigger the HOME gesture instead of the control. **Reproduced on hardware tonight:** tapping the password field at the bottom repeatedly triggered app-background instead of focus.
- **Evidence:** `normalizeAndroidInsets = (insets) => ({ top: …, right: …, bottom: 0, left: … })` discards the real bottom inset that `SafeAreaPlugin.kt` correctly reports from `WindowInsetsCompat.Type.systemBars() or displayCutout()`. `--safe-area-inset-bottom: max(env(...), var(--native-safe-area-inset-bottom))` → 0 on Android; nothing else pads the bottom.
- **Fix sketch:** Stop zeroing the bottom inset; report the tappable-gesture inset (`WindowInsetsCompat.Type.mandatorySystemGestures()` bottom, or nav-bar inset clamped when hidden) through `--native-safe-area-inset-bottom` so the tab-bar frame and page/interstitial footers keep clear of the gesture zone.

### HARD9-004 — Saved-password editing is implicit — masked field silently mutates and persists the secret before verification
- **Area:** settings · **Severity:** P1 · **Dimensions:** data-loss, ux-responsiveness, security, correctness · **Confidence:** high **[verified][HIL]** · **Effort:** M · **Status:** FIXED (df7ddcd9)
- **Files:** `src/pages/SettingsPage.tsx:452-467,1296-1307,643-692`, `src/lib/connection/addDeviceReachability.ts:17-26,54-55`
- **Failure scenario:** The "Network Password" `<Input type="password">` is populated with the *real decrypted saved password* (effect calls `getPasswordForDevice` and `setPasswordInput(nextPassword)`). The masked dots look like a placeholder; a stray keystroke appends to the actual secret ("pwd" → "pwdt") with no reveal toggle, no dirty indicator, no confirm. On "Save & Connect", `evaluateNewDeviceReachability` classifies 401/403 as `needs-password` = save-allowed, so the wrong password passes the "never persist an unreachable device" gate; `setPasswordForDevice(...)` persists the corrupted secret *before* `switchSavedDevice` verification runs. Only later symptom: generic OFFLINE (→ HARD9-001). **This exact sequence happened live on hardware tonight.**
- **Evidence:** `handleSaveConnection` order: reachability probe → `if (status === "unreachable") return` (auth failure is not "unreachable") → `setPasswordForDevice` → `updateSavedDevice` → `updateConfig` → `switchSavedDevice`; on verification failure only `reportUserError` fires, with the bad password already committed to secure storage.
- **Fix sketch:** Never load the secret into the editable field — show "Password saved · Change" starting from an empty field; treat a `needs-password` probe result *with a supplied password* as an auth failure ("Wrong password for this device") and don't persist; persist the password only after verification succeeds.
- **Notes:** Companion findings: HARD9-025 (write race), HARD9-028 (switch outcome), HARD9-001 (resulting dead-end).
- **Resolution (df7ddcd9):** `passwordInput`/`passwordInputRef` never load the stored secret; a saved password renders as a disabled `••••••••` field with a "Change" button that starts an empty draft. `handleSaveConnection` reuses the untouched stored password (fetched only at save time, never rendered) when the user hasn't clicked Change. A `needs-password` reachability result while `passwordEditing` is true and a password was supplied is now treated as a wrong-password auth failure and blocks the save entirely (`setPasswordError`, no `setPasswordForDevice` call). **Partial scope:** the fix sketch's "persist the password only after verification succeeds" was not implemented as a full reordering — `switchSavedDevice`'s own post-persist verification (`executeSavedDeviceSwitch`) reads the saved-device record from persisted storage, so `updateSavedDevice`/`setPasswordForDevice` must still run before that call. The pre-persist `evaluateNewDeviceReachability` gate (which now also catches wrong passwords) is what prevents persisting bad credentials in the HIL-observed scenario; a same-millisecond password change on the device between the two checks remains a (much narrower) theoretical race. Full reordering would require restructuring `useSavedDeviceSwitching` to accept a candidate config instead of re-reading persisted state — left for a follow-up if this residual risk needs closing.

### HARD9-005 — Duration override slider silently clobbers every playlist item's resolved duration
- **Area:** playback · **Severity:** P1 · **Dimensions:** correctness, data-loss · **Confidence:** high **[verified]** · **Effort:** M · **Status:** OPEN
- **Files:** `src/pages/playFiles/playFilesUtils.ts:120-123`, `src/pages/PlayFilesPage.tsx:1535-1557`
- **Failure scenario:** Playlist has songlength-resolved durations (HVSC / Songlengths.md5). User drags the "Default duration" slider (or edits the input). After the 500ms debounce, `applyDurationOverrideToPlaylist` overwrites `durationMs` on EVERY item — including items with correct resolved songlengths — and the clobbered values are persisted (`durationOverrideMs`/`defaultDurationMs`). Totals, per-row durations, and auto-advance timing all go wrong; the enrichment effect only fills `null` durations, so resolved values don't come back except for SID items relaunched via `startPlaylist`. MOD/PRG/CRT items lose durations permanently.
- **Evidence:** `applyDurationOverrideToPlaylist = (playlist, durationMs) => playlist.map((entry) => (entry.durationMs === durationMs ? entry : { ...entry, durationMs }))` — unconditional overwrite. Wired via `handleDurationSliderChange → debouncedDurationOverrideMs → persistDurationOverride(setPlaylist(applyDurationOverrideToPlaylist))`; persisted at `usePlaybackPersistence.ts:463`, `playlistRepositorySync.ts:196`.
- **Fix sketch:** Apply the default duration only to items whose duration was not resolved from songlengths/metadata (track a `durationSource` per item), treating the slider purely as the fallback in `playlistItemDuration`.

### HARD9-006 — Changing duration mid-track does not re-arm the auto-advance guard
- **Area:** playback · **Severity:** P1 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/PlayFilesPage.tsx:1547-1557,1159-1180`, `src/pages/playFiles/hooks/usePlaybackController.ts:846-857`
- **Failure scenario:** Track playing with duration 3:00 (`dueAtMs = start+180000`). User drags duration to 10:00 — progress bar shows 10:00 but `autoAdvanceGuardRef.current.dueAtMs` is never updated, so `syncPlaybackTimeline` still auto-advances at 3:00. Reverse: shortening 10:00→1:00 pins the progress bar at 100%/0:00 remaining while the track keeps playing for 9 more minutes.
- **Evidence:** Only writers of `dueAtMs` are `playItem`, pause/resume, and session restore; the duration handlers update `durationMs` state only. `syncPlaybackTimeline` fires purely on `now >= guard.dueAtMs`; the native watchdog gets the same stale value via `autoAdvanceDueAtMs`.
- **Fix sketch:** When `durationMs` changes for the playing track, recompute `guard.dueAtMs = trackStartedAtRef.current + newDurationMs` (respecting paused state) and call `setAutoAdvanceDueAtMs`.

### HARD9-007 — Shuffle checkbox does not shuffle playback; Reshuffle irreversibly destroys curated order
- **Area:** playback · **Severity:** P1 · **Dimensions:** correctness, data-loss, ux-responsiveness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/pages/playFiles/hooks/usePlaylistManager.ts:46,64-80`, `src/pages/PlayFilesPage.tsx:1757-1763`, `src/pages/playFiles/hooks/usePlaybackController.ts:1355-1447`, `src/lib/playlistRepository/indexedDbRepository.ts:446-488`
- **Failure scenario:** (a) Checking "Shuffle" does not randomize playback — `handleNext`/auto-advance still walk `activeIndex + 1`; the checkbox only enables the Reshuffle button. (b) Pressing Reshuffle physically reorders the playlist and persists it; unchecking Shuffle does not restore the original order — curated ordering is gone permanently.
- **Evidence:** `shuffleEnabled` is consumed only by the checkbox and `reshuffleDisabled`; persistence includes never-used `randomSeed: null, randomCursor: null` (`usePlaybackPersistence.ts:493-494`); the repository ships unused `RandomPlaySession`/`createSession`/`next` machinery intended for non-destructive shuffle.
- **Fix sketch:** Implement shuffle as a playback-order layer (use the existing `RandomPlaySession` seed/cursor machinery in next/auto-advance) instead of mutating the stored playlist; keep Reshuffle as "new seed".

### HARD9-008 — Songlengths bundle cache cleared on every playlist change → repeated multi-MB re-parses
- **Area:** playback · **Severity:** P1 · **Dimensions:** performance, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/playFiles/hooks/useSonglengths.ts:133-135,293-296,359,451-469`, `src/pages/PlayFilesPage.tsx:1405-1430`
- **Failure scenario:** With a Songlengths.md5 loaded (up to 6MiB auto-loaded), every playlist identity change — every track transition (`playItem`'s duration update), every duration-slider persist, every add batch — (1) clears `songlengthsCacheRef`, then (2) the enrichment effect re-runs `applySonglengthsToItems` over the entire playlist, re-parsing the database once per distinct folder. Seconds of main-thread work per auto-advance on device hardware; the same full pass inside `startPlaylist` delays playback start on every row tap.
- **Evidence:** `useEffect(() => { songlengthsCacheRef.current.clear(); }, [playlist, songlengthsFiles]);` clears on every playlist reference change; the enrichment effect iterates all SID items even when `durationMs` is already set; the bundle signature (`path:mtime`) already detects staleness, making the blanket clear redundant.
- **Fix sketch:** Drop the cache-clearing effect (signature check already invalidates stale bundles) and skip enrichment for items with resolved `durationMs`.

### HARD9-009 — Full-range custom snapshot ($0000-$FFFF) silently saves an empty snapshot (u16 length truncation)
- **Area:** snapshot · **Severity:** P1 · **Dimensions:** correctness, data-loss · **Confidence:** high **[verified]** · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/snapshot/snapshotFormat.ts:109-112`, `src/lib/snapshot/customSnapshotRanges.ts:105-111`, `src/lib/snapshot/snapshotCreation.ts:179-197`
- **Failure scenario:** User picks Save RAM → Custom and enters 0000–FFFF. `length = 0x10000` passes validation and `dumpRamRanges`, but `writeUint16LE(view, descriptorOffset + 2, range.length)` truncates 0x10000 to 0. The 64KiB of data is appended, but on decode `ranges[0].length === 0` → restore writes nothing and still toasts "Snapshot restored". Silent, discovered only when the user needs the snapshot.
- **Evidence:** `MemoryRange.length` documented "1–65536" (`snapshotTypes.ts:32`); the CPU-snapshot path explicitly works around this exact overflow (`cpuSnapshot.ts:35-44`) but the custom-range path has no guard or split.
- **Fix sketch:** In `encodeSnapshot`, reject or split ranges with `length > 0xFFFF` (reuse the CPU_SNAPSHOT_RANGES-style split), or clamp in `validateCustomSnapshotRanges`.

### HARD9-010 — Mount/eject success judged by HTTP status only — firmware in-body errors discarded, false "Disk mounted" toasts
- **Area:** disks · **Severity:** P1 · **Dimensions:** correctness, ux-responsiveness, robustness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/c64api.ts:2346-2437`, `src/lib/disks/diskMount.ts:324-344`, `src/components/disks/HomeDiskManager.tsx:592-611,661-668`
- **Failure scenario:** The firmware reports many failures as HTTP 200 with a non-empty `errors` array (the codebase itself proves this: `assertConfigWriteAccepted` at `c64api.ts:1141-1167` and `writeWithRetry` in `restoreCart.ts:105-118` both check `result.errors`). `mountDrive`/`mountDriveUpload`/`unmountDrive` return `{ errors: string[] }` but no caller inspects it. An in-body rejected mount yields the "Disk mounted" toast, sets the optimistic `mountedByDrive[drive]` override, and clears `driveErrors` — success shown, drive unchanged.
- **Evidence:** `HomeDiskManager.tsx:592-607` never checks the return; `diskMount.ts:326-344` discards the API result.
- **Fix sketch:** Add an `assertDriveWriteAccepted`-style check inside `mountDrive`/`mountDriveUpload`/`unmountDrive`, throwing with the joined firmware errors so the existing error path surfaces the real reason.

### HARD9-011 — CommoServe/runtime-file disks become permanently unmountable after page remount, with a misleading error
- **Area:** disks · **Severity:** P1 · **Dimensions:** data-loss, ux-responsiveness, correctness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/hooks/useDiskLibrary.ts:55-71`, `src/lib/sourceNavigation/localSourcesStore.ts:52`, `src/components/disks/HomeDiskManager.tsx:1109-1155`, `src/lib/disks/diskMount.ts:287-301`
- **Failure scenario:** Disks imported from CommoServe hold their bytes only as `File` objects in `runtimeFiles` (React state) while the `DiskEntry` (location "local", `sourceId` = archive id, no `localUri`) is persisted. Navigate away or restart: `setRuntimeFiles({})` and the module-level map are memory-only. The library still lists the disk; Mount throws "Local disk access is missing. Re-add the folder or file to refresh permissions." — meaningless for an archive download. Bytes gone; entry is a dead tombstone.
- **Evidence:** `diskMount.ts:287-300` — sourceId lookup against `loadLocalSources()` (archive sources are not local sources) → fallback loop → final throw. Nothing persists archive binaries.
- **Fix sketch:** Persist archive-imported disk bytes (IndexedDB/Filesystem) keyed by disk id, or re-download on demand via the stored `sourceId`+selection; at minimum detect the archive-sourced case and show an accurate "re-import from CommoServe" error.
- **Notes:** Same root pattern as HARD9-047 (web local sources).

### HARD9-012 — Disks page hardcodes every mount as read-only, breaking in-game disk saves
- **Area:** disks · **Severity:** P1 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/components/disks/HomeDiskManager.tsx:592-594`, `src/lib/playback/playbackRouter.ts:516-527`
- **Failure scenario:** `handleMountDisk` always passes `{ mode: "readonly" }` (introduced in fe212a59, a test-hardening PR), including for the user's own D64s on the C64U. Games saving high scores/states fail with DOS 26 "WRITE PROTECT ON". The same disk launched via Play mounts `"readwrite"` (`playbackRouter.ts:520`; `mountDiskToDrive` default) — inconsistent, and no UI exposes the mode.
- **Evidence:** `HomeDiskManager.tsx:593` is the only production caller passing a mode; `MountDiskToDriveOptions` defaults to `"readwrite"` (`diskMount.ts:310`).
- **Fix sketch:** Default library mounts to `readwrite` (matching playback) or expose a read-only toggle in the mount sheet; if read-only-by-default is intended, surface the mode on the drive card so DOS 26 is explicable.

### HARD9-013 — HVSC ingest promise never settles after explicit cancel (reject skipped in cancelled coroutine)
- **Area:** native · **Severity:** P1 · **Dimensions:** correctness, ux-responsiveness, robustness · **Confidence:** high **[verified]** · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../HvscIngestionPlugin.kt:649-651,833-837,898-900`, `src/lib/hvsc/hvscIngestionRuntime.ts:678`
- **Failure scenario:** User taps Cancel during an HVSC install. `cancelIngestion` sets the token AND calls `activeJob?.cancel(...)`. The extractor throws `CancellationException`; the catch block runs, but `withContext(Dispatchers.Main) { call.reject(...) }` executes inside a now-cancelled coroutine — `withContext` checks the caller's Job on entry and throws without running its block. The reject is never delivered; the awaited `ingestHvsc` promise hangs forever, leaving the pipeline stuck in EXTRACTING until app restart. Same skip applies to the generic error path when cancelled and to `handleOnDestroy`.
- **Evidence:** `HvscIngestionPlugin.kt:833-837` (`activeJob?.cancel(CancellationException(...))`), catch at 649-651. The memory-pressure path (`requestCancellation`) only sets the AtomicBoolean and does NOT cancel the job — which is why that path works and masks this bug in testing.
- **Fix sketch:** Deliver the reject outside the cancelled job: `withContext(NonCancellable + Dispatchers.Main) { call.reject(...) }` (also in the generic catch/finally), or `Handler(Looper.getMainLooper()).post`.

### HARD9-014 — Stale "update applied" records survive HVSC library reset and permanently block updates
- **Area:** hvsc · **Severity:** P1 · **Dimensions:** correctness, data-loss, ux-responsiveness · **Confidence:** high **[verified]** · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/hvsc/hvscIngestionRuntime.ts:175-181,198-214,850-858`, `src/lib/hvsc/hvscStateStore.ts:95-98`
- **Failure scenario:** User taps "Reset HVSC library data", then reinstalls. Baseline ingests, but every incremental update version is skipped ("Update N already applied") because per-version success records from the previous install were never cleared. `installedVersion` stays at baseline (skips don't bump it), so `checkForHvscUpdates` reports the same updates as required forever — the library permanently misses update content while the UI perpetually shows updates available.
- **Evidence:** `resetHvscLibraryData` patches state without touching the `updates` record map (`updateHvscState` keeps `current.updates` when the patch omits it, `hvscStateStore.ts:76`); the install loop `continue`s on `isUpdateApplied(plan.version)` without calling `applyIngestionSuccess`.
- **Fix sketch:** Clear `updates: {}` in `resetHvscLibraryData` (and on new baseline ingest); alternatively bump `installedVersion` when skipping an already-applied update.

### HARD9-015 — Poisoned empty browse snapshot makes recursive HVSC "add folder" silently return zero songs
- **Area:** hvsc · **Severity:** P1 · **Dimensions:** correctness, ux-responsiveness, robustness · **Confidence:** medium · **Effort:** M · **Status:** OPEN
- **Files:** `src/lib/hvsc/hvscService.ts:262-267,422-435`, `src/lib/hvsc/hvscMediaIndex.ts:117-123,184-190`, `src/lib/sourceNavigation/hvscSourceAdapter.ts:94-97`, `src/lib/hvsc/hvscBrowseIndexStore.ts:799-825`
- **Failure scenario:** On native (SQLite-backed) installs the integrity stat-probe fails (SIDs are not individual files — attested by the code's own docstring), so `ensureHvscIndexReady` clears the browse snapshot. `queryFolderPage` then rebuilds `this.browseSnapshot` from an empty `entriesSnapshot` and caches the empty-but-truthy snapshot. Browsing works via runtime fallback, but "add all from HVSC root" hits `getHvscSongsRecursive` → poisoned snapshot → `querySongsRecursive("/")` returns `[]`; the adapter treats `[]` as success and never falls back to paged BFS — zero items added, no error.
- **Evidence:** `hvscIndex.clearBrowseSnapshot()` on failed integrity; `this.browseSnapshot = buildHvscBrowseIndexFromEntries([])`; `loadBrowseSnapshot` prefers the in-memory snapshot; `if (bulkSongs) return bulkSongs.map(songToEntry);` — `[]` is truthy.
- **Fix sketch:** Never cache a snapshot built from empty entries (or return null from `listSongsRecursiveFromBrowseIndex` when the snapshot has zero songs); make `getHvscSongsRecursive` treat an empty result on a non-empty install as "fall back to BFS".

### HARD9-016 — Latest-intent write lane silently drops committed writes to a different config item
- **Area:** config · **Severity:** P1 · **Dimensions:** data-loss, correctness, ux-responsiveness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/lib/deviceInteraction/latestIntentWriteLane.ts:53-101`, `src/hooks/useInteractiveConfigWrite.ts:98-127,153-155`, `src/pages/home/components/AudioMixer.tsx:48`, `src/pages/home/components/LightingSummaryCard.tsx:76`
- **Failure scenario:** One `useInteractiveConfigWrite` lane is shared by all 8 SID sliders (4 SIDs × vol/pan) and by both lighting sliders. The lane holds a single `latestJob`; `schedule()` replaces it regardless of which item the payload targets. User commits SID1 volume then SID1 pan within the 400ms quiet window (or drags both): the queued volume update is replaced and never sent. Worse, `resolveUpTo(settledVersion)` resolves the dropped job's promise as SUCCESS, so `useDeviceBoundSlider` latches a pendingIntent the device never echoes; after the 2-4.5s watchdog the slider silently snaps back. No error, no toast.
- **Evidence:** `schedule` sets `latestJob = {version, value}` unconditionally; in `process`, `if (nextLatest.version > job.version) continue;` discards the older job, then `resolveUpTo(settledVersion)` resolves its waiter successfully. `quietUntilRef = Date.now() + 400` on burst overlap widens the drop window.
- **Fix sketch:** Merge payloads per config-item key instead of replacing (`latestJob.value = {...latestJob.value, ...next}`), or key coalescing by item so only same-item intents supersede. Also make SidCard's pan `panPreviewMode` asymmetry (throttled vs commitOnly) explicit or consistent.

### HARD9-017 — Profile load / revert / load-from-flash never invalidate `c64-config-items` — Home shows pre-load values
- **Area:** config · **Severity:** P1 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high **[verified]** · **Effort:** S · **Status:** OPEN
- **Files:** `src/hooks/useAppConfigState.ts:409-420`, `src/hooks/useC64Connection.ts:522-528,548-558,647-662`
- **Failure scenario:** User taps "Load From App" (or Revert, or "Load From Flash"). Toast says loaded, but every quick-config control on Home — Turbo, Video Mode, RAM Expansion, SID cards, lighting — keeps showing old values: they read via `useC64ConfigItems` (`["c64-config-items", ...]`, staleTime 30s) and nothing invalidates that key family. Reverse gap too: Config-page writes invalidate only `c64-category`/`c64-all-config`, so Home stays stale up to 30s.
- **Evidence:** `applyConfigData` invalidates only `["c64-category"]` and `["c64-all-config"]`; same for `loadConfig`/`resetConfig`/`useC64SetConfig`/`useC64UpdateConfigBatch` onSuccess; Home reads exclusively through `c64-config-items`/`c64-config-item` (`HomePage.tsx:119-156`).
- **Fix sketch:** Add `invalidateQueries({queryKey: ["c64-config-items"]})` (and `["c64-config-item"]`) to `applyConfigData` and the flash-load/reset/set-config success paths (prefix invalidation already works since routingEpoch is appended).

### HARD9-018 — Save-to-App, initial revert baseline, and revert "verification" read a persistent client cache instead of the device
- **Area:** config · **Severity:** P1 · **Dimensions:** correctness, data-loss · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/hooks/useAppConfigState.ts:143-150,422-477`, `src/lib/c64api.ts:1021-1093,2157-2161`
- **Failure scenario:** (a) The idle initial snapshot (5s after connect) captures categories via `getCachedCategory`, which serves `selected` values from a localStorage-persisted, no-TTL enrichment cache — last *session's* values for categories not yet read this session. If settings changed via the C64U's own menu since, the baseline is wrong and "Revert Changes" actively writes stale last-session values to the device. (b) "Save to App" snapshots the same stale cache. (c) `revertToInitial` "verification" refetches through the same cache which `updateConfigBatch` just updated per-item via `setCachedConfigValue` — verification compares the writes against themselves and always passes, even if firmware clamped values.
- **Evidence:** `fetchAllConfig.readCategorySnapshot` prefers `api.getCachedCategory(category)`; `getCachedCategory` falls back to `loadConfigEnrichmentCategory` (localStorage, per-device, no expiry); `updateConfigBatch` calls `setCachedConfigValue` for every written item before verification re-runs `fetchAllConfig`.
- **Fix sketch:** Give `fetchAllConfig` a `fresh: true` mode bypassing `getCachedCategory` for snapshot capture, Save-to-App, and revert verification; keep the cache for background enrichment only (or add read timestamps and reject stale entries).

### HARD9-019 — Full trace ZIP exported on every recorded error
- **Area:** diagnostics · **Severity:** P1 · **Dimensions:** performance, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/tracing/traceSession.ts:573-591,604-613`, `src/lib/tracing/fetchTrace.ts:90,157-159`, `src/App.tsx:352-395`
- **Failure scenario:** Device unreachable (common per c64u flakiness). Every failed poll produces a fresh `Error`, so `errorOnce` (WeakSet keyed by Error identity) never dedups; each failure runs `exportTraceZip()` — `JSON.stringify(getTraceEvents(), null, 2)` over up to 25,000 events / 50MB plus synchronous `zipSync` — on the main thread, every few seconds, for the entire outage. UI jank, battery drain, GC churn.
- **Evidence:** `recordTraceError` schedules `setTimeout(() => { const data = exportTraceZip(); ... })` unconditionally; callers include every non-OK HTTP response, every non-expected network failure, every window error/unhandled rejection, every failed traced action.
- **Fix sketch:** Build the export lazily when the diagnostics share flow actually consumes `getLastTraceExport()`, or debounce error exports (≥60s apart) and cap the exported slice.

### HARD9-020 — Unguarded localStorage log writes; O(n) parse/stringify per log line
- **Area:** diagnostics · **Severity:** P1 · **Dimensions:** robustness, correctness, performance · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/lib/logging.ts:50-70`, `src/lib/diagnostics/logger.ts:206-235`, `src/App.tsx:392-394`
- **Failure scenario:** (a) localStorage quota exceeded: `writeLogs` has no try/catch, so `addLog` throws; the console bridge routes every `console.warn/error` through `logger.warn/error` → `addLog`, so any app code calling `console.warn` now throws unexpectedly. (b) `addErrorLog("Unhandled promise rejection", { reason: event.reason })` with a circular `reason` throws inside the rejection handler. (c) Every log line does JSON.parse of the entire 500-entry blob + full re-stringify + synchronous `setItem` — O(store) main-thread work per line, amplified by the console bridge.
- **Evidence:** `writeLogs` (logging.ts:50-53) — bare `localStorage.setItem(LOG_KEY, JSON.stringify(...))`; `addLog` — `const logs = [entry, ...readLogs()]; writeLogs(logs)`; console bridge has re-entrancy guarding only.
- **Fix sketch:** try/catch around `writeLogs` (drop oldest/halve on quota), sanitize `details` with a safe serializer, keep logs in an in-memory ring with debounced persistence.

### HARD9-021 — Closed diagnostics overlay copies full trace/log stores on every event
- **Area:** diagnostics · **Severity:** P1 · **Dimensions:** performance, ux-responsiveness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx:111-113,185-198`, `src/lib/tracing/traceSession.ts:130-132,242`, `src/lib/logging.ts:69,106-119`, `src/App.tsx:257`
- **Failure scenario:** `GlobalDiagnosticsOverlay` is always mounted. Every trace event append dispatches `c64u-traces-updated` → `setTraceEvents(getTraceEvents())`, copying the entire up-to-25,000-element array and re-rendering the overlay — even while closed. A single REST poll emits ~3 events = 3 full copies + renders. Every `addLog` dispatches → `setLogs(getLogs())` AND `setErrorLogs(getErrorLogs())`, each re-parsing the full 500-entry localStorage blob (`getErrorLogs` calls `getLogs` again) — one log line costs three full JSON parses. Idle polling alone drives continuous O(25k) main-thread work over long sessions.
- **Evidence:** Listeners registered unconditionally at `GlobalDiagnosticsOverlay.tsx:185-198`; `getTraceEvents()` returns `[...events]`.
- **Fix sketch:** Subscribe/refresh only while `overlayOpen` (seed state on open); have `getErrorLogs` filter an already-fetched list; batch/throttle update events.

---

## P2 — Medium

### HARD9-022 — CONSERVATIVE circuit breaker still hard-fails user CTAs during the circuit window — half-open probe only exists for presets that don't need it
- **Area:** transport · **Severity:** P2 · **Dimensions:** ux-responsiveness, correctness · **Confidence:** high · **Effort:** S · **Status:** FIXED (9ab556cb)
- **Files:** `src/lib/config/deviceSafetySettings.ts:120-136`, `src/lib/deviceInteraction/deviceInteractionManager.ts:548-554,677-699`
- **Failure scenario:** Two consecutive background-poll network failures (weight 1.0 each) reach CONSERVATIVE's threshold of 2 and open the circuit for 6s. `shouldBlockForState` deliberately lets user intent through the state gate while the circuit is open, but `withRestInteraction` throws `"Device circuit open"` because `userHalfOpenProbe` requires `allowUserOverrideCircuit`, which CONSERVATIVE sets `false`. Every tap in the window produces a destructive error toast, triggered by traffic the user never initiated. The preset whose device most needs a controlled recovery probe is the only one that gets none.
- **Evidence:** `const userHalfOpenProbe = circuitOpen && meta.intent === "user" && config.allowUserOverrideCircuit;` vs CONSERVATIVE `allowUserOverrideCircuit: false, circuitBreakerThreshold: 2`.
- **Fix sketch:** Make the single-flight half-open probe unconditional for user intent (the `restUserCircuitProbeInFlight` single-flighting already provides device protection); keep `allowUserOverrideCircuit` governing only unrestricted override.
- **Notes:** Carried over from hardening/5 P0-2, materially reduced (P0-1's expiry timer is fixed so the wedge is bounded at 6s; timeouts now weigh 0.5).
- **Resolution (9ab556cb):** REST user half-open probes no longer depend on `allowUserOverrideCircuit`; any user-intent REST request may run the existing single-flight probe while the REST circuit is open. System/background requests remain blocked. Added regression coverage for CONSERVATIVE-style disabled override. The second-tap behavior was later changed by HARD9-061 so queued user work waits for the in-flight probe instead of being rejected.

### HARD9-023 — Background-intent requests retry 3× with zero delay, occupying the single REST lane for up to ~9s ahead of user CTAs
- **Area:** transport · **Severity:** P2 · **Dimensions:** ux-responsiveness, performance, robustness · **Confidence:** high · **Effort:** S · **Status:** FIXED (3ceecd75)
- **Files:** `src/lib/c64api.ts:113-114,1306,1493-1631`
- **Failure scenario:** Device goes busy (demo loading — precisely when users tap). A background `/v1/info`/drives poll times out at 3000ms; `scheduledTimeoutFailure` retries immediately (`retryDelayMs = 0`) at 3000ms and again at 6000ms elapsed, all inside one `withRestInteraction` handler — the single REST lane and native FIFO slot (HARD9-002) are held ~9s. The 0ms re-fire also hits an already-struggling device back-to-back.
- **Evidence:** `maxAttempts = scheduledRequest ? SCHEDULED_REQUEST_MAX_ATTEMPTS : 1`, `const retryDelayMs = 0`, guard `SCHEDULED_REQUEST_RETRY_GUARD_MS = 6000`.
- **Fix sketch:** Drop background in-handler retries to 1 (the poll interval is the retry), or release the lane between attempts with a small backoff; cap total handler occupancy.
- **Resolution (3ceecd75):** Removed the immediate scheduled-timeout retry branch from `C64API.request`; background REST calls now make one attempt per scheduler handler and rely on the polling cadence for later retries. Background timeout aborts still record expected diagnostic responses, but they no longer emit `C64U_HTTP_RETRY`, sleep/re-enter the handler, or occupy the REST/native lane for repeated zero-delay attempts. Updated unit coverage locks one-attempt behavior and expected timeout classification.

### HARD9-024 — Circuit/state-gate error toasts are classified "unknown" and never auto-clear on recovery
- **Area:** transport · **Severity:** P2 · **Dimensions:** ux-responsiveness, correctness · **Confidence:** high · **Effort:** S · **Status:** FIXED (22147b34)
- **Files:** `src/lib/uiErrors.ts:107-116,140-151`, `src/lib/deviceInteraction/deviceInteractionManager.ts:644,687`
- **Failure scenario:** A user CTA during a 6s circuit window throws `"Device circuit open"` (or `"Device not ready for requests"` during OFFLINE). `isTransientConnectivityFailure`'s regex matches neither → errorClass "unknown" → destructive persistent toast. On recovery, `clearConnectivityErrorToastsForHost` clears only `|connectivity`-class entries, so the stale error stays pinned (destructive toasts are pinned first in `limitToasts`) while everything works.
- **Evidence:** Regex at `uiErrors.ts:142` (`host unreachable|service unavailable|http 503|failed to fetch|net::err|request timed out|networkerror|dns`) vs the gate messages; recovery filter `key.endsWith("|connectivity")`.
- **Fix sketch:** Add the gate/circuit messages to the connectivity classification (they are by definition transient availability states), or tag gate-thrown errors with a structured class honored by `deriveErrorClass`.
- **Resolution (22147b34):** Extended `isTransientConnectivityFailure` to include device circuit and state-gate messages, including `"Device circuit open"`, `"Device circuit probe already in flight"`, and `"Device not ready for requests"` (plus FTP/Telnet state-gate variants). Because `deriveErrorClass` and recovery logging both use this shared classifier, these errors now dedupe as `connectivity`, log with `recoverableConnectivityIssue`, and clear through `clearConnectivityErrorToastsForHost` on host recovery. Added unit coverage for direct classification and recovery dismissal.

### HARD9-025 — Password-field write race between connection state and secure-storage load
- **Area:** settings · **Severity:** P2 · **Dimensions:** correctness, data-loss · **Confidence:** medium · **Effort:** S · **Status:** FIXED (df7ddcd9)
- **Files:** `src/pages/SettingsPage.tsx:235-237,429-432,452-467`
- **Failure scenario:** Two independent effects own `passwordInput`: one mirrors `password` from `useC64Connection` (deps `[password]`), the other async-loads the selected device's stored password. While the user types a new password, any runtime connection-config change silently replaces the in-progress input; Save persists the old/mixed value from `passwordInputRef`. Switching devices mid-flight can land a stale password into the field for the new device.
- **Evidence:** Both effects call `setPasswordInput`/write `passwordInputRef.current` with no dirty guard; `handleSaveConnection` reads `passwordInputRef.current`.
- **Fix sketch:** Track a `passwordDirty` flag set on user keystroke; both sync effects bail while dirty; clear after successful save or device switch.
- **Resolution (df7ddcd9):** Both racing effects are gone rather than dirty-guarded — the HARD9-004 fix removed the `[password]`-mirroring effect and the async `getPasswordForDevice` preload effect entirely, since the field never displays the real secret. The only remaining effect resets the field on `[selectedSavedDevice?.id, selectedSavedDevice?.hasPassword]` (an actual device switch), which is the one case where resetting the draft is correct; there is no longer any effect that can overwrite an in-progress keystroke from live connection/password state.

### HARD9-026 — 600ms drag-settle timer collapses a held swipe
- **Area:** shell · **Severity:** P2 · **Dimensions:** ux-responsiveness, correctness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/components/SwipeNavigationLayer.tsx:294-307`, `src/hooks/useSwipeGesture.ts:184-248`
- **Failure scenario:** User drags horizontally to peek at the next tab, then holds still >600ms. No pointermove fires, so `dragOffsetPx` stops changing and the `phase === "dragging"` effect's timer expires: `setRunway(buildIdleState(...))` snaps the runway back *while the finger is down*. The next movement re-enters onProgress with full dx — visual jump. Releasing during the reset silently loses a swipe that had crossed the commit threshold.
- **Evidence:** The effect re-arms on `[centerIndex, dragOffsetPx, phase]` — it only stays alive while dx changes; a stationary held pointer is indistinguishable from the missed-pointerup case the timer was added for.
- **Fix sketch:** Feed pointer liveness (gesture-active flag or heartbeats from `useSwipeGesture`), not dx-change, into the settle timer; only run it when no pointer is down.

### HARD9-027 — Diagnostics overlay scroll save/restore targets the wrong scroller (dead code)
- **Area:** shell · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx:99,174,244-255`, `src/index.css:700-725`, `src/components/layout/PageContainer.tsx:40`
- **Failure scenario:** The overlay snapshots `window.scrollY` on open and restores it on close — but the app never scrolls the window: pages scroll inside `.page-shell`. `window.scrollY` is always 0, so restore is a no-op. Any path resetting `.page-shell` `scrollTop` while the full-screen sheet is open (page remount in a swipe slot, Radix scroll lock, the route-driven `navigate("/settings")` on close) loses the user's scroll position with nothing to restore it.
- **Evidence:** scrollRestoreRef effect reads/writes only window scroll; no code touches `[data-page-scroll-container]`.
- **Fix sketch:** Capture and restore the active `.page-shell`'s `scrollTop` (rAF after close), or delete the effect if the container provably preserves scroll.

### HARD9-028 — Saved-device switch reports auth failure as "offline", misdirecting the user
- **Area:** settings · **Severity:** P2 · **Dimensions:** ux-responsiveness, correctness · **Confidence:** medium · **Effort:** M · **Status:** FIXED (df7ddcd9)
- **Files:** `src/pages/SettingsPage.tsx:211,685-700`, `src/hooks/useSavedDeviceSwitching.ts:103-131`, `src/lib/connection/addDeviceReachability.ts:17-26`
- **Failure scenario:** After a bad-password save (HARD9-004), `switchSavedDevice` verification failure is reported as `outcome: "offline"` — "Unable to reach {host}. Check the hostname/IP address and confirm the device is powered on." — actively pointing at power/network when the device answered 401/403. The reachability layer already knows the difference (`needs-password`, `isAuthRequiredError`) and a `DeviceAuthChallengeDialog` exists for regular REST 401/403s, but the save/switch path collapses auth into offline.
- **Evidence:** `executeSavedDeviceSwitch` maps any non-ok verification to `outcome: "offline"`; `isOfflineSwitchResult` inspects only `ok === false`.
- **Fix sketch:** Propagate an `authRequired` flag through `verifyCurrentConnectionTarget`; on failure with the flag, show "The device rejected the password" (and/or raise the auth-challenge dialog); reflect an AUTH state distinct from OFFLINE in the badge (ties into HARD9-001).
- **Resolution (df7ddcd9):** Added `authRequired?: boolean` to `ProbeInfoResult`, set from `isAuthRequiredError(error)` in both `probeInfoOnce` and `probeInfoWithConnectionConfig`'s HTTP-status catch branch, so it flows unchanged through `verifyCurrentConnectionTarget` → `useSavedDeviceSwitching`'s returned verification. `SettingsPage.tsx` now has a `describeSwitchFailure` helper used at both `switchSavedDevice` call sites (Save & Connect, discovered-device confirm): when `authRequired` is set it reports "The device rejected the password. Check the password and try again." instead of the generic unreachable/offline fallback. **Not done:** an AUTH-distinct badge state (that part ties into HARD9-001, still open) — this fix only corrects the error message shown at the two save/switch call sites, not the persistent connection-state badge.

### HARD9-029 — Playing a new track while the machine is paused leaves the C64 frozen with UI showing "playing"
- **Area:** playback · **Severity:** P2 · **Dimensions:** correctness, robustness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/playFiles/hooks/usePlaybackController.ts:584-880,1052-1067,1211-1264`
- **Failure scenario:** User pauses (machinePause — DMA halt, SIDs muted), then presses Next/Previous or taps a row. `flushPendingUserSkip`/`startPlaylist` go straight to `playItem` without resuming the machine. `handleStop`'s own code proves resume-before-command is required (`resumeMachineWithRetry` before `machineReset`). If the launch doesn't clear the halt, the new track loads into a frozen machine: UI flips to playing, elapsed runs, auto-advance arms — no audio, machine wedged until Stop.
- **Evidence:** `handleStop`: `if (isPaused) { await resumeMachineWithRetry(api); }` — neither `playItem` nor `flushPendingUserSkip` nor `startPlaylist` performs this; `flushPendingUserSkip` calls `playItem(...)` then `setIsPaused(false)` with no machine resume.
- **Fix sketch:** In `playItem` (or the skip/startPlaylist entries), if `isPausedRef.current`, call `resumeMachineWithRetry` before executing the play plan.

### HARD9-030 — Deleting the currently-playing item resets the UI but leaves the device playing and the native watchdog armed
- **Area:** playback · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/pages/PlayFilesPage.tsx:1432-1460`
- **Failure scenario:** While playing, user removes the current item (or clears the playlist). `removePlaylistItemsById` sets `isPlaying=false` without any device stop — music keeps playing on the C64 while the UI shows stopped; pressing "Play" launches a new track over the running one. `autoAdvanceGuardRef.current = null` is set but `setAutoAdvanceDueAtMs(null)` never called, so the Android background service keeps its due-time armed and wakes for a phantom auto-skip.
- **Evidence:** The state-reset block contains no `getC64API()` stop, no `restoreVolumeOverrides`, no `setAutoAdvanceDueAtMs(null)` (contrast `handleStop`, `usePlaybackController.ts:1081-1101`). The `setIsPlaying`/`setCurrentIndex` calls also run inside the `setPlaylist` updater (impure updater — render-replay hazard).
- **Fix sketch:** When the removed set contains the playing item, route through `handleStop()`; move side-effectful state updates out of the `setPlaylist` updater.

### HARD9-031 — Auto-advance dies when the user navigates away from the Play page
- **Area:** playback · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** L · **Status:** OPEN
- **Files:** `src/pages/PlayFilesPage.tsx:1186-1264`
- **Failure scenario:** Playback running; user navigates to Config/Home (in-app). The wake lock is deliberately kept (BUG-040 fix), but the 1s timeline interval, `syncPlaybackTimeline`, and the `onBackgroundAutoSkipDue` listener are torn down with the page. When the track's duration elapses, nothing advances: on Android the BgExec service fires its auto-skip event into a void; on web there is no timer at all. Music stops at end of track; the playlist stalls until the user returns to Play (where the overdue guard lurches forward).
- **Evidence:** The effect registering `onBackgroundAutoSkipDue` removes it on unmount; grep confirms no other module registers it. The trace code documents the gap: "Play page unmounted; playback state is no longer directly observable" — but the FGS is kept alive precisely so playback continues.
- **Fix sketch:** Hoist the auto-advance engine (guard, due-time timer, background auto-skip listener, `handleNext("auto")`) into an app-level controller/provider that outlives the Play page; the page renders its state.

### HARD9-032 — Playlist row list rebuilt on every 1-second timeline tick (memoization defeated by inline callbacks)
- **Area:** playback · **Severity:** P2 · **Dimensions:** performance, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/PlayFilesPage.tsx:1627-1665`, `src/pages/playFiles/hooks/usePlaylistListItems.tsx:60-285`
- **Failure scenario:** While playing, `setElapsedMs` re-renders PlayFilesPage every second. Both `usePlaylistListItems` calls receive freshly-created inline arrows (`onAttachLocalConfig`, `onOpenConfig`, ...), so the `useMemo` deps change every render and the entire ActionListItem array — JSX meta nodes, 20+ menu items per row, perf scopes, and `recordSmokeBenchmarkSnapshot("playlist-render")` — is rebuilt twice per second (preview + view-all, up to 200+ rows). Constant CPU burn during playback on device hardware.
- **Evidence:** `usePlaylistListItems.tsx:266-285` lists the handlers in memo deps; `PlayFilesPage.tsx:1633-1635` passes new lambdas each render; `effectivePlaylistItemDuration` also changes identity with `pendingDurationOverrideMs`.
- **Fix sketch:** Wrap the inline handlers in `useCallback` (they close over stable setters); gate the benchmark/perf-scope recording off the recompute path.

### HARD9-033 — Cancel during add-items can throw inside a React state updater
- **Area:** playback · **Severity:** P2 · **Dimensions:** robustness, correctness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/playFiles/handlers/addFileSelections.ts:461-466,629-634`
- **Failure scenario:** User starts a large import, hits Cancel (or switches device, which also aborts) as a batch append is scheduled. `setPlaylist((prev) => { throwIfAborted(); ... })` throws `AbortError` from inside the updater during React's render phase → propagates to the nearest error boundary; Play page white-screens instead of "Add cancelled". The updater is also impure (`playlistSnapshotRef.current = next`).
- **Evidence:** `setPlaylist((prev) => { throwIfAborted(); const next = ...; playlistSnapshotRef.current = next; return next; });`.
- **Fix sketch:** Check `throwIfAborted()` before calling `setPlaylist`; keep the updater pure; mirror `playlistSnapshotRef` after the call.

### HARD9-034 — Concurrent playlist repository commits can persist a stale snapshot
- **Area:** playback · **Severity:** P2 · **Dimensions:** data-loss, robustness · **Confidence:** medium · **Effort:** M · **Status:** OPEN
- **Files:** `src/pages/playFiles/playlistRepositorySync.ts:279-414`, `src/lib/playlistRepository/indexedDbRepository.ts:319-360`
- **Failure scenario:** Two playlist changes in quick succession (playItem duration write, then user removal). The persist effect launches commit A (v1) then B (v2); `inflightCommits` only dedupes identical snapshot keys, so both run concurrently; B's IndexedDB transaction can be created before A's — A (stale) overwrites B. A's validation may pass (counts equal when only durations changed) → phase READY with stale data; next app start silently reverts the user's edit. Also: neither replace path deletes removed `playlist-item:*`/`track:*` keys — unbounded orphan growth.
- **Evidence:** `commitPlaylistSnapshot` has no per-playlist serialization; `replacePlaylistSnapshot` transaction order depends on interleaved awaits.
- **Fix sketch:** Chain commits per playlistId (queue on the prior in-flight promise regardless of snapshotKey, keep only the latest pending intent); delete stale keys when replacing a snapshot.

### HARD9-035 — CPU snapshot "saved" toast can fire while the C64 is left frozen — resume failure swallowed despite the comment saying it must be surfaced
- **Area:** snapshot · **Severity:** P2 · **Dimensions:** correctness, robustness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/snapshot/cpu/cpuSnapshot.ts:80-92`, `src/pages/home/hooks/useHomeActions.ts:197-228`
- **Failure scenario:** After a successful register capture the program is frozen in the handler spin loop. If `resumeAfterCapture` fails (transient c64u drop mid-writemem), the `finally` does `.catch((error) => { addErrorLog(...) })`: swallowed; `captureCpuSnapshotData` returns normally; user sees "CPU + RAM snapshot saved" while their C64 sits frozen with the IRQ vector pointed at the capture handler.
- **Evidence:** The comment directly above the swallow: "it must be surfaced (not swallowed) so the UI can offer a manual recovery path (Restore / power-cycle)".
- **Fix sketch:** Capture the resume failure and rethrow (or return it) after snapshot data is assembled so `handleSaveCpuSnapshot` can toast "snapshot saved but the program could not be resumed — press Restore or reset".

### HARD9-036 — CPU restore failures strand the machine in the restore cart and never fall back to RAM-only restore
- **Area:** snapshot · **Severity:** P2 · **Dimensions:** correctness, robustness, ux-responsiveness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/pages/home/hooks/useHomeActions.ts:230-252`, `src/lib/snapshot/cpu/restoreCart.ts:79-85,209-246`
- **Failure scenario:** (a) `CpuRestoreUnsupportedError` is documented as "the caller should offer RAM-only restore", but `handleRestoreSnapshot` catches nothing — raw "stack pointer $f is below the safe minimum…" toast, no fallback. (b) Worse: if the handshake fails after `runCartridgeUpload` (READY timeout, or a write failing all 4 retries mid-DMA), the C64 has already been reset into the uploaded spin-loop cart — frozen — and the error path performs no recovery (no reset, no release-flag retry, no guidance).
- **Evidence:** `useHomeActions.ts:238-240` `await restoreCpuSnapshotFromDecoded(api, decoded); return;` inside `runMachineTask`, whose catch only calls `reportUserError`.
- **Fix sketch:** Catch `CpuRestoreUnsupportedError` → fall back to `loadMemoryRanges`; for post-upload failures, best-effort `machineReset` (or write RESTORE_FLAG_GO) and tell the user the machine may need a reset.

### HARD9-037 — Mount sheet permits concurrent mounts to the same drive
- **Area:** disks · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/components/disks/HomeDiskManager.tsx:583-656,2181-2191`
- **Failure scenario:** The "Mount disk to Drive A" sheet stays open until the mount settles, and its rows are only disabled by `disableActions: !status.isConnected` — not by `mountPending`. A local-disk mount can take tens of seconds (SAF read timeout up to 45s + upload) with no busy indicator, so the user taps a second disk. Two mounts race to the same drive; the generation guard only suppresses stale UI effects, not firmware request order — drive can end up with disk 1 while the UI reports disk 2.
- **Evidence:** `buildDiskListItems(sortedDisks, { ..., disableActions: !status.isConnected, onMount: ... })` — no `mountPending`, unlike the drive-card buttons (line 1739).
- **Fix sketch:** Include `driveMutationPending[activeDrive]` in the sheet's `disableActions` (or close on tap) and show an in-flight spinner row.

### HARD9-038 — Local-disk group rotation and eject-before-delete break as soon as the first drives poll lands
- **Area:** disks · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** medium · **Effort:** M · **Status:** OPEN
- **Files:** `src/components/disks/HomeDiskManager.tsx:404-417,767-777,926-958`
- **Failure scenario:** After mounting a local (uploaded-blob) disk, `mountedByDrive[drive] = disk.id` makes rotation work. The reconciliation effect deletes that override on the first poll with `dataUpdatedAt >= setAt` (seconds later). `resolveMountedDiskId` then falls back to matching `entry.location === "ultimate" && entry.path === buildDrivePath(...)` — local disks can never match. `mountedDisk` becomes null: rotate arrows vanish, `handleRotate` no-ops, and `handleDeleteDisk` no longer ejects the still-mounted disk. Disk groups — whose whole point is side-swapping — only work for C64U-resident disks or for seconds after a local mount.
- **Evidence:** Override-clear comment (lines 213-219) explains the design for errors/power; for local mounts the poll payload is unmatchable to a local library entry.
- **Fix sketch:** Don't clear `mountedByDrive` for local-location disks while the poll still shows an `image_file` (or match by uploaded filename == disk.path basename); clear only when the drive reports empty or a different image.

### HARD9-039 — Capture-timeout rollback can corrupt the safe region while the CPU is executing it (late-interrupt race)
- **Area:** snapshot · **Severity:** P2 · **Dimensions:** correctness, robustness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/snapshot/cpu/captureEngine.ts:169-187,209`
- **Failure scenario:** The poll loop checks `captured`; on deadline it pauses and rolls back (restore vector, restore safe region, try next candidate). If the program's IRQ fires between the final `captured` read and `machinePause()` (up to 50ms + latency), the CPU is frozen *inside* the handler's spin loop at $033C. The rollback then overwrites the spin-loop code under the CPU's feet; on resume the CPU executes arbitrary restored bytes at its current PC — crashing the program the user asked to snapshot.
- **Evidence:** `if (!captured) { await api.machinePause(); await api.writeMemoryBlock(vectorAddr, irqVector); await api.writeMemoryBlock(base, savedRegion); continue; }` — no re-check of `layout.captured` after pausing.
- **Fix sketch:** After `machinePause()` in the timeout path, re-read the captured flag; if it flipped, treat the attempt as a successful capture.

### HARD9-040 — Failed HVSC baseline promotion can delete the only copy of the user's library
- **Area:** native · **Severity:** P2 · **Dimensions:** data-loss, correctness, robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../HvscIngestionPlugin.kt:543-586,652-679`
- **Failure scenario:** Baseline ingest (`resetLibrary=true`): the metadata DB is wiped, repopulated, and COMMITTED *before* the directory swap. If `libraryRoot.renameTo(oldRoot)` succeeds but `stagingRoot.renameTo(libraryRoot)` fails, recovery `oldRoot.renameTo(libraryRoot)` can also fail; the exception reaches the catch block, which unconditionally `oldRoot.deleteRecursively()` — permanently deleting the sole remaining copy. Even when recovery succeeds, the committed DB indexes files deleted with staging: every HVSC entry 404s until re-ingest.
- **Evidence:** DB `setTransactionSuccessful` at line 565 precedes the rename dance at 571-585; catch cleanup deletes both roots with no check whether `oldRoot` still holds the pre-ingest library.
- **Fix sketch:** Only delete `oldRoot` when `libraryRoot` exists (recovery restored it); order the swap before the DB commit so a failed promotion leaves DB and files consistent.

### HARD9-041 — Late setDueAtMs resurrects a phantom foreground service + wake lock after Stop
- **Area:** native · **Severity:** P2 · **Dimensions:** correctness, robustness, ux-responsiveness, performance · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `android/.../BackgroundExecutionService.kt:104-140,196-215`, `src/pages/PlayFilesPage.tsx:369-379`
- **Failure scenario:** The generation gate only protects the `dueAtMs == null` clear and stale starts. If a *non-null* due update lands after `stop()` (the Play page pushes dueAt via an async latest-intent lane, so a queued auto-advance write can flush after Stop), `updateDueAt` falls through to `startForegroundService(ACTION_UPDATE_DUE_AT)` carrying the *current* post-stop `commandGeneration` — accepted; `startForeground` + wake lock re-acquired, "Playback active" shown. JS believes background execution is off (`activeCount==0`), so nothing ever stops it: wake lock + FGS notification persist until app kill. On Android 12+ with the app backgrounded at that instant, the same call throws `ForegroundServiceStartNotAllowedException` instead.
- **Evidence:** `updateDueAt` builds the intent with the current `commandGeneration` and unconditionally `startForegroundService`s when `!isRunning && dueAtMs != null`; `onStartCommand` only rejects `intentGeneration < commandGeneration`.
- **Fix sketch:** Never (re)start the service from `updateDueAt`: if `!isRunning`, drop non-null due updates too (or require a captured pre-stop generation like the null path). A due timer without an active session has no consumer.

### HARD9-042 — Stale-generation FGS start intent stops itself without ever calling startForeground (crash risk)
- **Area:** native · **Severity:** P2 · **Dimensions:** correctness, robustness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../BackgroundExecutionService.kt:170-192`
- **Failure scenario:** JS start() queues `startForegroundService` (generation N); stop() bumps to N+1 before `onStartCommand` runs (fast play→stop under auto-advance churn). The stale branch calls `stopSelf(startId)` *without* `startForeground()` — risking `RemoteServiceException: Context.startForegroundService() did not then call Service.startForeground()` (the stop-before-timeout waiver is racy in ActiveServices; widely reported on Android 8-13). Same for the `intent == null` sticky-restart path.
- **Evidence:** Stale-generation branch returns after `stopSelf(startId)`; `startForeground` is only reached in the `!isRunning` start branch.
- **Fix sketch:** In stale/null-intent branches, call `startForeground(NOTIFICATION_ID, buildNotification())` then immediately `stopForeground(STOP_FOREGROUND_REMOVE)` + `stopSelf(startId)`.

### HARD9-043 — SecureStorage builds EncryptedSharedPreferences + MasterKey on every call with no synchronization
- **Area:** native · **Severity:** P2 · **Dimensions:** correctness, data-loss, robustness, performance · **Confidence:** medium · **Effort:** S · **Status:** FIXED (52b59dd8)
- **Files:** `android/.../SecureStoragePlugin.kt:28-36`
- **Failure scenario:** `getPrefs()` runs `MasterKey.Builder(...).build()` + `EncryptedSharedPreferences.create(...)` per invocation. Jetpack security-crypto's first-time keyset creation is not safe against concurrent creators: overlapping `getPassword` (connect) and `setPassword` (dialog) can corrupt the Tink keyset, after which every get/set rejects forever — the stored C64U password unrecoverable until app data is cleared. Even absent the race, per-call Keystore round-trips add 50-500ms to every password read on the shared plugin thread.
- **Evidence:** `private fun getPrefs() = prefsProvider?.invoke() ?: EncryptedSharedPreferences.create(...)` — no caching, no lock.
- **Fix sketch:** Single `@Synchronized` lazy holder; add corruption recovery (delete pref file + keystore entry, return null) so a corrupted keyset degrades to "re-enter password".
- **Resolution (52b59dd8):** `SecureStoragePlugin` now uses a synchronized cached holder for production `EncryptedSharedPreferences`, so concurrent plugin calls share one initialization path instead of racing `MasterKey`/Tink keyset creation. Production encrypted-storage failures clear the cached holder, clear/delete the encrypted preference files, delete the AndroidKeyStore master-key alias when present, and recover reads as `{ value: null }` so the JS auth flow asks the user to re-enter the password. Writes retry once after recovery. Injected test providers still reject, preserving deterministic hard-failure coverage.

### HARD9-044 — FTP/SAF readFile buffers entire file + Base64 in heap — OOM on large files
- **Area:** native · **Severity:** P2 · **Dimensions:** robustness, performance, correctness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `android/.../FtpClientPlugin.kt:418-464`, `android/.../FolderPickerPlugin.kt:432-441,470-481`
- **Failure scenario:** `FtpClientPlugin.readFile` accumulates the whole transfer in a `ByteArrayOutputStream`, then `toByteArray()` (copy 2), then Base64 (~1.33×, copy 3) — peak ≈3.3× file size plus bridge JSON. `FolderPickerPlugin.readFile`/`readFileFromTree` do the same; `pickFile` accepts `*/*`. Tapping a large file (a .dnp disk pack, firmware image) drives the app into OOM — hard crash, possibly mid-playback.
- **Evidence:** No size cap anywhere in either plugin.
- **Fix sketch:** Enforce a max-size guard (clear rejection above e.g. 32MB), and/or stream to a cache file and return a URI/path for large payloads.

### HARD9-045 — normalizeSourcePath collapses internal whitespace, corrupting legitimate paths on every source
- **Area:** sources · **Severity:** P2 · **Dimensions:** correctness, robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/sourceNavigation/paths.ts:9-14`, `src/lib/sourceNavigation/useSourceNavigator.ts:89`, `src/lib/sourceNavigation/localSourceAdapter.ts:54,89-93`
- **Failure scenario:** A directory named `My  Demos` (double space — legal FAT name) cannot be opened: every navigation routes through `ensureWithinRoot` → `normalizeSourcePath`, which does `value.replace(/\s+/g, " ").trim()`, rewriting the request to `/My Demos`. FTP LIST fails ("not found"); for web local sources the prefix match misses (raw stored paths keep the double space) and the folder renders empty; Android SAF hits the same mangled path.
- **Evidence:** `paths.ts:11` — name corruption, not normalization; adapter-produced entry paths are un-collapsed, so navigateTo(entry.path) → normalized safePath no longer matches.
- **Fix sketch:** Restrict `normalizeSourcePath` to structural normalization (leading slash, collapse duplicate `/`); drop the whitespace collapse/trim (trim only fully-blank input).

### HARD9-046 — Ingestion finalize overwrites the songlengths projection with duration-less, metadata-stripped song records
- **Area:** hvsc · **Severity:** P2 · **Dimensions:** correctness, data-loss · **Confidence:** medium · **Effort:** M · **Status:** OPEN
- **Files:** `src/lib/hvsc/hvscBrowseIndexStore.ts:707-716`, `src/lib/hvsc/hvscIngestionRuntime.ts:437-443,549,589`, `src/lib/hvsc/hvscSongLengthService.ts:262-271`
- **Failure scenario:** Non-native ingest order: write library → songlengths reload (builds projection *with* durations) → `browseIndex.finalize()` (saves *its* snapshot last, overwriting the projection). `upsertSong` stores `durationSeconds: song.durationSeconds ?? null` and the call site passes none, so every ingested song persists with null duration; in `update` mode it also replaces previously hydrated records (title/author/released wiped). Until the next cold-start re-sync, HVSC browse/adds show missing durations (3:00 default) and lose hydrated titles.
- **Evidence:** `upsertSong` assigns a minimal record — no merge; `finalize()` runs after the songlengths reload; `saveHvscBrowseIndexSnapshot` unconditionally overwrites both persisted snapshots.
- **Fix sketch:** Make `upsertSong` merge with the existing record and resolve durations from the fresh songlengths backend before finalize; or run `finalize()` before the songlengths reload so the projection wins.

### HARD9-047 — Web/desktop local sources list files after reload that can no longer be opened
- **Area:** sources · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** medium · **Effort:** M · **Status:** OPEN
- **Files:** `src/lib/sourceNavigation/localSourcesStore.ts:52,125-136`, `src/lib/sourceNavigation/localSourceAdapter.ts:25-36,218`
- **Failure scenario:** A non-SAF local source persists its `entries` metadata, but the `File` handles live only in the in-memory `runtimeFilesBySource` map. After reload, the source restores, `isAvailable` stays true (`requiresReselect` never set on this path), and the dialog lists every file. Selecting one resolves to `undefined` — or to the `toLocalPlayFile` stub whose `arrayBuffer: async () => new ArrayBuffer(0)` yields a 0-byte payload: the user browses a fully populated tree whose every file fails (or "plays" empty) with no hint the folder must be re-picked.
- **Evidence:** Nothing repopulates `runtimeFilesBySource` on load; availability check covers Android/SAF only.
- **Fix sketch:** On web, mark restored entry-mode sources `requiresReselect` (or check `runtimeFilesBySource.has(source.id)` in `isAvailable`) and surface the existing "re-add this folder" affordance.
- **Notes:** Same root pattern as HARD9-011 (CommoServe disks).

### HARD9-048 — Disk library save effect writes stale/empty state before the load effect settles
- **Area:** sources · **Severity:** P2 · **Dimensions:** data-loss, robustness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/hooks/useDiskLibrary.ts:55-74`
- **Failure scenario:** On mount (and every `uniqueId` change), the persist effect (`saveDiskLibrary(uniqueId, { disks })`) runs in the same commit as the load effect, before loaded disks re-render — writing `[]` on first mount, or the previous device's list under the new device's key on an A→B switch. Normally the follow-up render rewrites correct data, but a fast unmount or app kill in that window wipes or cross-contaminates the disk library.
- **Evidence:** Load effect's `setDisks(normalized)` doesn't update the `disks` binding the save effect reads in the same commit; no hydrated guard.
- **Fix sketch:** Track `hydratedForIdRef` and skip persisting until the load for the current `uniqueId` has committed; or persist in explicit mutators.

### HARD9-049 — Archive entries with a dot in the name are rejected even when byte detection succeeds
- **Area:** sources · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/archive/execution.ts:36-40,58-62`
- **Failure scenario:** CommoServe entry named e.g. `TURBO ASSEMBLER V5.2` (version dot, no real extension): `FileTypeDetector.detect` correctly identifies the bytes, validation passes, but `ensureExecutableName` returns the name unchanged because `fileName.includes(".")`; `getPlayCategory(".2")` yields null → "Unsupported archive file" — hard failure for a file the app just proved it supports.
- **Evidence:** `if (fileName.includes(".")) return fileName;` treats any dot as a valid play extension. `FILE_TYPE_TO_EXTENSION` also lacks `t64`/`tap` though the type presets offer them.
- **Fix sketch:** Check `getPlayCategory(fileName)` first; append the detected-type extension whenever the existing name doesn't map to a category; extend the extension map.

### HARD9-050 — Throttled-preview sliders leave the device at an intermediate value when the user returns to the start position
- **Area:** config · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/hooks/useDeviceBoundSlider.ts:462-465,504-507`, `src/pages/home/components/LightingSummaryCard.tsx:255-270`
- **Failure scenario:** LED brightness 50. User drags to 80 (throttled previews write 60/70/80), reconsiders, returns to 50 and releases. `onValueCommit` cancels the trailing preview, then hits `if (equals(deviceValue, nextValue)) { clearLatchedState(); return; }` — `deviceValue` is still pre-drag 50 (polling paused during drag) — so NO corrective write is sent. Device stays at the last preview (e.g. 70); UI shows 50 until the next refetch, then jumps.
- **Evidence:** Polling pause freezes `deviceValue`; the commit-skip equality compares against the frozen value while previews already mutated device state.
- **Fix sketch:** Track `previewSentRef` during the drag; if any preview flushed, always send the commit even when `nextValue` equals the pre-drag device value.

### HARD9-051 — Home quick-config writes never set hasChanges, so "Revert Changes" stays disabled
- **Area:** config · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/home/hooks/useConfigActions.ts:29-74`, `src/pages/HomePage.tsx:1717-1727`
- **Failure scenario:** Changing Video Mode, Turbo Control, SID address, UltiSID filter, or any LightingSummaryCard select on Home routes through `useConfigActions.updateConfigValue` (direct `api.setConfigValue`) — `updateHasChanges` is never called, so the Revert card stays disabled: users cannot revert changes made from Home. Slider writes and Config-page writes DO set the flag — inconsistent, looks arbitrary.
- **Evidence:** `updateConfigValue` success path invalidates queries and toasts but contains no `updateHasChanges(...)` (compare `useC64Connection.ts:527,550/557`).
- **Fix sketch:** Call `updateHasChanges(getActiveBaseUrl(), true)` on success (or route through `useC64SetConfig`).

### HARD9-052 — Home optimistic pins have no routing-epoch clear and no watchdog — a lost echo disables the control until remount
- **Area:** config · **Severity:** P2 · **Dimensions:** robustness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/home/hooks/useConfigActions.ts:22-27`, `src/pages/ConfigBrowserPage.tsx:908-912`, `src/hooks/useAuthoritativeConfigValueState.ts:124-136`
- **Failure scenario:** A Home select write returns HTTP success, but the device reboots/drops before the value persists or the reconciliation refetch lands. The pinned entry never matches an echo, so `pending[key]` stays true forever: the row shows the never-applied value AND stays disabled for as long as HomePage stays mounted. ConfigBrowserPage explicitly fixed this class (BUG-033) by clearing pins on `routingEpoch` change; the Home store has no equivalent, and select pins have no reconciliation watchdog.
- **Evidence:** `ConfigBrowserPage.tsx:908-912` (`useEffect(clearAll, [routingEpoch])` with BUG-033 rationale) has no counterpart in useConfigActions; `resolveValue` only self-clears on an exact echo.
- **Fix sketch:** Subscribe `useConnectionRoutingEpoch()` in `useConfigActions` and `clearAll()` on change; add a per-entry expiry (reuse `resolveDeviceBoundSliderWatchdogMs`) so a never-echoed pin decays.

### HARD9-053 — Loading an app profile / revert sends the entire device config as one giant POST /v1/configs
- **Area:** config · **Severity:** P2 · **Dimensions:** robustness, performance · **Confidence:** medium · **Effort:** M · **Status:** OPEN
- **Files:** `src/hooks/useAppConfigState.ts:409-420`, `src/lib/c64api.ts:2116-2154`
- **Failure scenario:** "Load From App"/"Revert Changes" builds a payload of every writable item in every category — including hundreds of unchanged values — and `updateConfigBatch` merges all non-sequential categories into a single `POST /v1/configs`. That's the exact temp-file-buffering firmware handler documented (comment at `c64api.ts:2130-2139` + hardware evidence) as capable of stalling the single-threaded HTTP task and dropping the device's network stack; the profile-load POST is the largest body the app can produce. Risks the offline wedge right after the user asks to restore settings.
- **Evidence:** `applyConfigData` → `api.updateConfigBatch(payload)` with the full snapshot; only `requiresSequentialItemWrites` categories are split out.
- **Fix sketch:** Diff against current values and write only changed items; chunk the remainder per-category (or N-item batches) spaced by the existing write throttle, or send small batches as sequential PUTs.

### HARD9-054 — Audio Mixer solo routing bypasses the mutation layer: no invalidation, no hasChanges, stale sessionStorage restore can overwrite current volumes
- **Area:** config · **Severity:** P2 · **Dimensions:** correctness, robustness · **Confidence:** medium · **Effort:** M · **Status:** OPEN
- **Files:** `src/pages/ConfigBrowserPage.tsx:326-372,388-420,422-449`
- **Failure scenario:** (1) `applySoloRouting` calls `getC64API().updateConfigBatch` directly — solo/unsolo writes (changing real volumes for all SIDs) never invalidate queries nor set hasChanges; Home keeps pre-solo volumes. (2) The mount-time restore reads `c64u_audio_mixer_solo_snapshot` from sessionStorage and unconditionally writes those OLD volumes back to the device, even if the snapshot is hours old and volumes changed since — silently clobbering current settings on next Config visit. (3) Multi-item Audio Mixer batches → the POST path (HARD9-053).
- **Evidence:** Direct `api.updateConfigBatch` with no queryClient; restore effect gated only by `restoredSnapshotRef`.
- **Fix sketch:** Route solo writes through `useC64UpdateConfigBatch` (with reconciliation like `useInteractiveConfigWrite`); timestamp the snapshot and only auto-restore if fresh (minutes), else discard and log.

### HARD9-055 — Error-toast eviction + sliding dedup window silently hide persistent failures
- **Area:** diagnostics · **Severity:** P2 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/hooks/use-toast.ts:68-81,101-131`, `src/lib/uiErrors.ts:199-212`
- **Failure scenario:** A destructive error toast shows for a recurring failure. A second destructive toast arrives; `limitToasts` drops the older one straight from state — without dispatching DISMISS, so its `onToastDismiss` (which deletes the `dedupMap` entry) never fires. Each recurrence refreshes the stale dedup timestamp, so the 30s window slides forever: the error never re-toasts while it keeps failing. ERROR_POLICY's "error toasts stay until dismissed" is broken; the user permanently loses visibility of a live failure.
- **Evidence:** `limitToasts` truncates in ADD_TOAST with no side-effect for dropped toasts; `onToastDismiss` only runs in DISMISS_TOAST.
- **Fix sketch:** Invoke `onToastDismiss` for evicted toasts in ADD_TOAST; in uiErrors don't slide the window (keep original timestamp) or verify the toast is still live before suppressing.

### HARD9-056 — Backend-decision correlation set grows unbounded over long sessions
- **Area:** diagnostics · **Severity:** P2 · **Dimensions:** performance, robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/tracing/traceSession.ts:43,135-147`
- **Failure scenario:** `decisionByCorrelation` accumulates one string per correlation ID forever; every poll tick/click/REST/FTP/Telnet action mints a new ID. Trace events evict after 30min/25k, but this set is only cleared by manual "Clear diagnostics". Days-long sessions leak tens of thousands of retained strings invisible to the byte cap.
- **Evidence:** `const decisionByCorrelation = new Set<string>()`; adds on every first request per correlation; no eviction in `evictExpired`/`enforceLimits`.
- **Fix sketch:** Drop entries when their correlated events evict, or use a bounded LRU (clear oldest half at cap).

### HARD9-057 — Trace persistence exceeds sessionStorage quota; size accounting broken after restore
- **Area:** diagnostics · **Severity:** P2 · **Dimensions:** performance, data-loss, correctness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/tracing/traceSession.ts:66-71,277-329`, `src/lib/tracing/traceBridge.ts:64-70`
- **Failure scenario:** (a) `beforeunload` → `persistTracesToSession` stringifies up to 50MB into a ~5MB-quota sessionStorage: QuotaExceeded swallowed → traces silently lost after paying the full synchronous stringify cost during unload. (b) `restoreTracesFromSession` pushes restored events into `events` but never appends `eventSizes`/`totalBytes`; `dropOldest` then shifts misaligned arrays and the 50MB byte cap stops being enforced for restored sessions.
- **Evidence:** Persist = single `JSON.stringify(events)` + `setItem`; restore mutates `events` only; `dropOldest` assumes 1:1 alignment.
- **Fix sketch:** Persist only the newest slice that fits (~2MB); rebuild size accounting after restore (same path as `replaceTraceEvents`).

### HARD9-058 — Fetch trace duplicates full request/response payloads in the hot path
- **Area:** diagnostics · **Severity:** P2 · **Dimensions:** performance · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/lib/c64api/requestRuntime.ts:256-346`, `src/lib/tracing/fetchTrace.ts:62,78`
- **Failure scenario:** Every `/v1/` request is traced: request Blobs/ArrayBuffers are fully copied (`await body.arrayBuffer()` → `new Uint8Array`) just to build a preview — uploading a multi-MB disk image doubles it in memory; every response is `clone()`d and fully read, and for JSON the *entire parsed body* is stored in the trace event, keeping whole config payloads resident in the 25k-event store — inflating HARD9-019/021/057 costs.
- **Evidence:** `inspectRequestPayload` binary branches; `inspectResponsePayload` JSON branch stores full parse; called unconditionally from `executeTracedFetch`.
- **Fix sketch:** Build previews from a bounded prefix (first 4-16KB via `blob.slice()`); store `payloadPreview` + size summary above a threshold.

### HARD9-059 — Smoke-mode localStorage fallback is a self-perpetuating latch in production
- **Area:** state · **Severity:** P2 · **Dimensions:** robustness, security, correctness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/smoke/smokeMode.ts:166-173,242-260`
- **Failure scenario:** `initializeSmokeMode` falls back to `localStorage["c64u_smoke_config"]` unconditionally — the `VITE_ENABLE_TEST_PROBES` gate only covers the *filesystem* source. If that key exists in a production WebView (leftover from a smoke/E2E run on the same device profile, restored app data), the app permanently enters smoke mode: read-only defaults true, debug logging forced, device host overridden — and `writeSmokeConfigToStorage(config)` re-persists on every launch, latching forever with no user-visible way to clear it.
- **Evidence:** `config ??= readSmokeConfigFromStorage();` runs for every platform/build; `cachedSmokeConfig = config; writeSmokeConfigToStorage(config);`.
- **Fix sketch:** Apply the same test-probes gate to the localStorage fallback; stop re-writing the key on every boot.

---

## P3 — Low

### HARD9-060 — Background health probes pass allowDuringError but the state gate ignores it for background intent
- **Area:** transport · **Severity:** P3 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** FIXED (1d16f3de)
- **Files:** `src/lib/diagnostics/healthCheckEngine.ts:188-192,536-543`, `src/lib/deviceInteraction/deviceInteractionManager.ts:548-554`
- **Failure scenario:** While OFFLINE (device state ERROR), the background-maintenance connectivity probe runs with `__c64uAllowDuringError: true`, expecting to run during ERROR. `shouldBlockForState` returns true for background intent before consulting `allowDuringError` (honored only for system intent) — the probe fails with `"Device not ready for requests"` before any I/O. Health UI shows that gate message as the device's health error instead of the actual reachability result; the health check can never observe the 403/"connection refused" that would explain the outage (compounds HARD9-001).
- **Fix sketch:** Honor `allowDuringError` for background intent (the flag is opt-in, set only by probes), or resolve probe intent to "system" for background maintenance.
- **Resolution (1d16f3de):** `shouldBlockForState` now honors `allowDuringError` for both `system` and `background` REST intents while keeping ordinary background traffic blocked in ERROR. Added regression coverage for an explicit background `/v1/info` recovery probe running in ERROR with `allowDuringError: true` and `bypassCircuit: true`.

### HARD9-061 — Second user CTA during a half-open circuit probe hard-fails instead of queueing
- **Area:** transport · **Severity:** P3 · **Dimensions:** ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** FIXED (82492610)
- **Files:** `src/lib/deviceInteraction/deviceInteractionManager.ts:688-699`
- **Failure scenario:** On BALANCED/RELAXED with circuit open, the first tap becomes the single-flight half-open probe; a second tap within its duration throws `"Device circuit probe already in flight"` — a hard CTA failure with an error toast, produced purely by the protection mechanism. Users double-tap exactly when the first tap appears unresponsive.
- **Fix sketch:** Await the in-flight probe's outcome: success → run the second request; failure → reject with the standard circuit-open error (transient-classified per HARD9-024).
- **Resolution (82492610):** Replaced the REST half-open probe boolean flag with the in-flight probe promise. A second user REST request now records a deferred circuit guard and awaits the first probe; if the first probe succeeds, the second request continues through the normal request path, and if the first probe fails, the second request rejects with the standard `"Device circuit open"` error. Added regression coverage for both queued-success and queued-failure double-tap paths.

### HARD9-062 — Startup saved-device fallback commits the selection before verification and keeps it on failure
- **Area:** transport · **Severity:** P3 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** medium · **Effort:** S · **Status:** FIXED (16fc9351)
- **Files:** `src/lib/connection/connectionManager.ts:716-741`
- **Failure scenario:** On startup with the selected device unreachable, `tryReachableSavedDeviceFallback` probes others; on a hit it calls `selectSavedDevice(...)` and applies runtime config *before* `verifyCurrentConnectionTarget`. If verification fails (probe-ok-then-verify-fail is realistic on a flaky c64u), the function returns false and flows to discovery/OFFLINE — but the selection is never rolled back: the user's chosen device has been silently switched to one the app isn't even connected to, and the next startup targets the wrong device.
- **Fix sketch:** Capture the previous `selectedDeviceId` and restore it (plus runtime config) when verification fails, or defer `selectSavedDevice` until after verification.
- **Resolution (16fc9351):** Deferred saved-device selection until after `verifyCurrentConnectionTarget` succeeds for the reachable fallback candidate. The verifier already accepts candidate host/password and applies runtime config only on successful verification, so a probe-ok/verify-fail candidate no longer updates selected saved-device state or runtime config. Updated the saved-device sweep regression to assert no selection/runtime commit on verification failure.

### HARD9-063 — Volume sync wedges after starting a new track from the paused state
- **Area:** playback · **Severity:** P3 · **Dimensions:** correctness, robustness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/playFiles/hooks/useVolumeOverride.ts:1004-1014`, `src/pages/playFiles/hooks/usePlaybackController.ts:1211-1264`
- **Failure scenario:** User pauses (pause-mute sets `pausingFromPauseRef = true`), then starts a different track via Next/row-tap instead of resuming. `playItem → ensureUnmuted` unmutes the SIDs, so Audio Mixer refetches report unmuted values. The device-sync effect then permanently returns at `if (pausingFromPauseRef.current && activeIndices.length) return;` — the flag is only cleared on a muted reading or by the pause/resume paths that were bypassed. Slider stops tracking device-side volume changes until the next pause/resume cycle.
- **Fix sketch:** Clear `pausingFromPauseRef`/`resumingFromPauseRef`/`pauseMuteSnapshotRef` at the start of `playItem`.

### HARD9-064 — Session restore trusts a stale snapshot and revives "playing" UI for a dead device session
- **Area:** playback · **Severity:** P3 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/playFiles/hooks/usePlaybackPersistence.ts:377-443`, `src/pages/PlayFilesPage.tsx:1169`
- **Failure scenario:** User plays a track, navigates away, stops the C64 by other means (Home reset, power cycle) or the track ended hours ago in a suspended WebView. Returning to Play, restore applies `setIsPlaying(true)` with a guard whose `dueAtMs` is long past — the overdue guard fires `handleNext("auto")` on the first tick and launches the next track on a machine the user deliberately stopped. No staleness bound on `pending.updatedAt`, no device-state cross-check.
- **Fix sketch:** Reject/downgrade restores whose `updatedAt`/`dueAtMs` are overdue beyond a threshold: restore position paused instead of auto-launching.

### HARD9-065 — resolveVolumeSyncDecision helper is dead code diverging from the live sync logic
- **Area:** playback · **Severity:** P3 · **Dimensions:** robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/playFiles/playbackGuards.ts:28-38`, `src/pages/PlayFilesPage.tsx:113`, `src/pages/playFiles/hooks/useVolumeOverride.ts:1027-1061`
- **Failure scenario:** Maintenance hazard: PlayFilesPage imports `resolveVolumeSyncDecision` but never calls it; the actual pending-write hold logic is re-implemented inline with subtly different rules (2500ms staleness only in the unmuted branch — a muted pending write that never confirms defers muted-sync indefinitely until the separate 5000ms stale-clear). Two sources of truth invite regressions.
- **Fix sketch:** Use the tested helper in both branches (or delete it) so muted and unmuted pending writes share the same bounded hold.

### HARD9-066 — handlePlaylistSelect carries a bogus dependency
- **Area:** playback · **Severity:** P3 · **Dimensions:** robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/PlayFilesPage.tsx:1386-1399`
- **Failure scenario:** `useCallback((item, selected) => { setSelectedPlaylistIds(...) }, [queueBackgroundDueAtUpdate])` — dep unrelated to the body. No current impact, but it documents an editing accident and masks staleness if the closure grows.
- **Fix sketch:** Change the dependency array to `[]`.

### HARD9-067 — Snapshot restore halts the CIA TOD clocks and can flip interrupt-mask bits (ICR write semantics)
- **Area:** snapshot · **Severity:** P3 · **Dimensions:** correctness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/machine/ciaTimerRegisters.ts:26-35`, `src/lib/machine/ramOperations.ts:360-397`, `src/lib/snapshot/cpu/restoreCart.ts:145-172`
- **Failure scenario:** The CIA skip predicate excludes only $xx04-$xx07 (+mirrors); TOD ($xx08-$xx0B) and ICR ($xx0D) are written on every program-type restore. On the 6526, writing TOD hours stops the TOD clock until a tenths write restarts it — the restore writes ascending (tenths first, hours last), leaving both CIAs' TOD clocks halted after every restore; TOD-timed software breaks silently. ICR is write-mask semantics: a captured read-value like $83 re-enables interrupt sources the program had disabled → spurious NMIs/IRQs.
- **Fix sketch:** Extend the skip predicate to $xx08-$xx0B and $xx0D (+mirrors) in both restore paths.

### HARD9-068 — resolveLocalDiskBlob cross-source fallback can silently mount the wrong same-named disk
- **Area:** disks · **Severity:** P3 · **Dimensions:** correctness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/disks/diskMount.ts:287-298`
- **Failure scenario:** If a disk's `sourceId` no longer resolves (source removed/re-added → new id), the code loops over all local sources and returns the first file whose source-relative path matches `disk.path`. Two folders can both contain `/side-a.d64` — the user mounts library disk X and gets folder Y's different bytes, no warning.
- **Fix sketch:** When the disk has a `sourceId`, don't fall back to other sources (fail with the accurate re-add message); optionally verify `sizeBytes` before accepting a fallback hit.

### HARD9-069 — Snapshot store silently drops the oldest snapshot at the 100 cap
- **Area:** snapshot · **Severity:** P3 · **Dimensions:** data-loss, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/snapshot/snapshotStore.ts:103-116`, `src/lib/snapshot/snapshotTypes.ts:192`
- **Failure scenario:** `saveSnapshotToStore` unshifts and `splice(MAX_SNAPSHOTS)` discards the oldest without notice or export prompt. The oldest saved game state disappears at snapshot #101; nothing mentions eviction.
- **Fix sketch:** Toast a warning naming the dropped snapshot, or refuse the save with "library full — delete or export".

### HARD9-070 — FTP control encoding never set — non-ASCII filenames garble and become unfetchable
- **Area:** native · **Severity:** P3 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../FtpClientPlugin.kt:180-196,394-410`
- **Failure scenario:** commons-net defaults to ISO-8859-1 and no UTF-8 autodetect. A USB stick with UTF-8 filenames (accented scene names) lists as mojibake; the RETR with the re-encoded path 550s — visible but never playable.
- **Fix sketch:** `client.autodetectUTF8 = true` (and/or `controlEncoding = "UTF-8"`) in a shared setup helper before `connect()`.

### HARD9-071 — Mock C64U HTTP + FTP servers ship in release builds and are registered unconditionally
- **Area:** native · **Severity:** P3 · **Dimensions:** security, robustness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `android/.../MainActivity.kt:104`, `android/.../MockFtpServer.kt:260,319-326`, `android/.../MockC64UServer.kt:636-645`
- **Failure scenario:** `registerPlugin(MockC64UPlugin::class.java)` runs in every build type. Production users triggering demo mode run two loopback servers reachable by *any* app on the device: an unauthenticated HTTP API with `Access-Control-Allow-Origin: *`, and an FTP server whose path-containment check `canonicalTarget.path.startsWith(canonicalRoot.path)` lacks a trailing-separator check (sibling `mock-ftp-rootX` passes). `withDataSocket`'s `accept()` has no soTimeout — a PASV+LIST client that never connects parks a pool thread forever.
- **Fix sketch:** Move Mock* registration behind `BuildConfig.DEBUG`/a debug source set; fix the prefix check to `startsWith(root + File.separator)`; set an accept timeout.

### HARD9-072 — TelnetSocket state read/written across threads without synchronization
- **Area:** native · **Severity:** P3 · **Dimensions:** correctness, robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../TelnetSocketPlugin.kt:36-38,184-189,275-283`
- **Failure scenario:** `socket`/`inputStream`/`outputStream` are plain vars written on the single-thread executor but `isConnected` reads them on the Capacitor plugin thread (no volatile/lock) — stale state possible; `handleOnDestroy` calls `closeSocket()` off-executor while a queued read/send may touch the same streams. JS polling `isConnected` after `connect()` can see `connected=false` and tear down a healthy session.
- **Fix sketch:** Mark fields `@Volatile` (or route `isConnected` through the executor); `handleOnDestroy` should `shutdownNow()` then close without interleaving.

### HARD9-073 — cancelRead after completion leaves permanent entries in cancelledReads
- **Area:** native · **Severity:** P3 · **Dimensions:** correctness, performance · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../FtpClientPlugin.kt:390-393,483-487,515-537`
- **Failure scenario:** `readFile`'s finally removes the requestId from `cancelledReads`; if the JS AbortSignal fires just after (abort racing natural completion — routine on navigate-away), `cancelRead` re-adds the id and nothing removes it. Unbounded growth over long sessions; and since a pre-registered id instantly rejects any future read with that id, requestId reuse (JS counter resets on WebView reload while native survives) yields spurious "FTP read aborted" failures.
- **Fix sketch:** In `cancelRead`, only flag if `activeReadStreams` contains the id (close-and-flag atomically); otherwise no-op.

### HARD9-074 — 7-Zip probe subprocess has no timeout/cancellation — a wedged probe bricks ingestion until restart
- **Area:** native · **Severity:** P3 · **Dimensions:** robustness, ux-responsiveness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../hvsc/HvscArchiveExtractor.kt:192-298`, `android/.../HvscIngestionPlugin.kt:396-399`
- **Failure scenario:** `extractSevenZipToRawTree` has a cancellation-monitor thread, but `probeSevenZipArchive` (`7zz l -slt`) has none: `useLines`/`waitFor` block indefinitely on a pathological archive. `cancelIngestion` sets the token but nothing kills the probe; every retry rejects with "HVSC ingestion already running" until force-stop.
- **Fix sketch:** Reuse the extract-path cancellation monitor for the probe (poll token, `destroyForcibly`), or `waitFor(timeout)` with destroy on expiry.

### HARD9-075 — queryAllSongs materializes the full 50k-row index on the shared Capacitor plugin thread
- **Area:** native · **Severity:** P3 · **Dimensions:** performance, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../HvscIngestionPlugin.kt:840-896`
- **Failure scenario:** Unlike `ingestHvsc` (coroutine), `queryAllSongs` runs synchronously on Capacitor's single plugin handler thread: scans the entire ~50k-row index, builds a giant JSArray (tens of MB with bridge JSON), and blocks ALL other native plugin dispatch (FTP, telnet, background-execution start/stop, secure storage) for its duration — multi-second stalls in playback controls right after an HVSC install.
- **Fix sketch:** Run on `Dispatchers.IO` (resolving via NonCancellable main); page the query (limit/offset) to bound bridge payloads.

### HARD9-076 — Device-discovery probe leaks HttpURLConnection when the /v1/info body read fails
- **Area:** native · **Severity:** P3 · **Dimensions:** robustness, performance · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../DeviceDiscoveryPlugin.kt:219-307`
- **Failure scenario:** `probeTarget` only calls `connection.disconnect()` on explicit success/4xx paths. If the `inputStream` read throws mid-body (device drops under load), the catch swallows and returns null without disconnecting — sockets/FDs accumulate during repeated rediscovery against a flaky device.
- **Fix sketch:** `try { ... } finally { connection.disconnect() }` around the probe body.

### HARD9-077 — MainActivity.onCreate performs synchronous filesystem repair on the main thread
- **Area:** native · **Severity:** P3 · **Dimensions:** ux-responsiveness, performance · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../MainActivity.kt:24-71,97-99`
- **Failure scenario:** `ensureCapacitorPluginAssetPath()` runs first in `onCreate` on the UI thread: stat, potential `deleteRecursively()` of an arbitrarily large stray directory, mkdirs, writeText. On slow/contended flash this stalls cold start toward the ANR threshold; the deliberate `throw` converts a repairable disk hiccup into a startup crash loop.
- **Fix sketch:** Keep the fast `isFile` happy path on-thread; move delete/rewrite repair off-thread (complete before bridge first use); log + best-effort continue instead of throwing.

### HARD9-078 — Recursive FTP listing's timed_out flag is dropped by the JS contract
- **Area:** native · **Severity:** P3 · **Dimensions:** correctness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `android/.../FtpClientPlugin.kt:269-294,331`, `src/lib/native/ftpClient.ts:86-88`, `src/lib/ftp/ftpClient.ts:193-218`
- **Failure scenario:** Native resolves `{ entries, partialFailures, timed_out }` (snake_case) but the TS type declares only `entries`/`partialFailures`, and no caller reads either spelling — the "walk aborted early because device FTP is wedging" signal is invisible: a silently truncated recursive listing presents as complete.
- **Fix sketch:** Rename to `timedOut`, add to the TS types and `FtpRecursiveListResult`, surface "listing incomplete — device FTP timed out".

### HARD9-079 — Native CommoServe transport ignores AbortSignal — Cancel doesn't cancel
- **Area:** sources · **Severity:** P3 · **Dimensions:** robustness, performance, ux-responsiveness · **Confidence:** high · **Effort:** M · **Status:** OPEN
- **Files:** `src/lib/archive/client.ts:183-214`, `src/hooks/useOnlineArchive.ts:199-223`
- **Failure scenario:** On native, `requestWithTransport` routes through `CapacitorHttp.request` and never wires `options.signal`; `cancel()` rolls the UI back but the search/entries/binary download (up to 30s) keeps transferring. Cancel + new search stacks concurrent native requests against a slow archive host; on metered connections the cancelled download completes anyway.
- **Fix sketch:** Reject early when `signal.aborted`; race the request promise against a signal-abort promise (drop the result).

### HARD9-080 — Shared preset-refresh promise turns unmount-abort into an unhandled rejection and a stuck "pending" status
- **Area:** sources · **Severity:** P3 · **Dimensions:** robustness, correctness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/hooks/useOnlineArchive.ts:225-272`
- **Failure scenario:** Open the Add Items dialog on the CommoServe tab and close within the 10s preset fetch: cleanup aborts; the `.catch` rethrows for the aborted case; the consumer chain (`void refreshPromise.then(...).finally(...)`, no `.catch`) rejects unhandled — surfacing in global error reporting. `presetRefreshStatus` stays "pending", so the next mount briefly reports loading for a refresh that isn't running.
- **Fix sketch:** Don't rethrow on abort (resolve to cached/seeded presets, delete status); attach `.catch(() => {})` to the consumer chain; use a detached signal for the shared refresh.

### HARD9-081 — Web FTP recursive scan is unbounded while native caps at depth 8 / 5000 entries
- **Area:** sources · **Severity:** P3 · **Dimensions:** robustness, performance, correctness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/sourceNavigation/ftpSourceAdapter.ts:31-32,146-157,172-245`
- **Failure scenario:** "Add folder" on a large USB root: native stops at 8 levels/5000 entries (silently truncating — user believes everything was added), while web walks the entire tree with no cap — tens of thousands of LIST round-trips, minutes of scan; inconsistent results between platforms.
- **Fix sketch:** Apply the same caps in the web BFS; on both paths surface truncation (`partialFailures`/`truncated`) so the user knows the scan was cut short.

### HARD9-082 — Refresh clears only the exact current path — recursive adds and re-entry serve a 10-minute-stale FTP cache
- **Area:** sources · **Severity:** P3 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/sourceNavigation/ftpSourceAdapter.ts:29,97-120,255-260`, `src/lib/sourceNavigation/useSourceNavigator.ts:190-194`
- **Failure scenario:** User saves a new file onto the C64U from the device side, taps Refresh (current folder fresh), then "Add folder" on the parent: the recursive BFS resolves every child via `getCachedEntries` (10-min TTL) — new files missing, deleted files still offered, no staleness indication.
- **Fix sketch:** Bypass (or prefix-invalidate) the cache for recursive scans; clear all keys under the current path prefix on Refresh.

### HARD9-083 — Pre-aborted or early-aborted FTP read still performs the full transfer
- **Area:** sources · **Severity:** P3 · **Dimensions:** robustness, performance · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/ftp/ftpClient.ts:300-329`
- **Failure scenario:** A caller aborts a queued FTP read before the native call starts (user cancels a bulk import): `executeFtpRead` sees `signal.aborted`, fires `cancelRead` (no-op — read not registered yet), then proceeds to `readFile(...)` anyway, downloading the whole file.
- **Fix sketch:** Throw `AbortError` immediately when pre-aborted; have native remember cancelled requestIds briefly so cancel-before-start wins (see HARD9-073 for the flip side).

### HARD9-084 — HVSC ingestion cancellation unchecked during the deletion pass and index finalize
- **Area:** hvsc · **Severity:** P3 · **Dimensions:** ux-responsiveness, robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/lib/hvsc/hvscIngestionRuntime.ts:499-532,538-598,1265-1289`
- **Failure scenario:** Cancel just as extraction completes on a large update: `ensureNotCancelledLocal` is only consulted inside `onEntry`, so the deletion loop (thousands of `deleteLibraryFile` round-trips), `promoteLibraryStagingDir`, songlengths reload, and `finalize()` all run after the cancel — the "Cancelled" UI state coexists with an ingest that keeps mutating the library and then flips state to "ready" via `applyIngestionSuccess`.
- **Fix sketch:** Check the token at each stage boundary and inside the deletion loop; have `applyIngestionSuccess` refuse to overwrite a cancelled state for the same ingestion id.

### HARD9-085 — CategorySection disables every row while any single write is pending
- **Area:** config · **Severity:** P3 · **Dimensions:** ux-responsiveness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/ConfigBrowserPage.tsx:186,838-841`
- **Failure scenario:** `isLoading={setConfig.isPending || ...}` uses the section's shared mutation state: while one item's PUT is in flight (spaced by the write throttle), every other row in the category renders disabled — the second control appears dead until the first write settles.
- **Fix sketch:** Drop `setConfig.isPending` from row-level `isLoading`; rely on per-item `authoritativeValues.pending[key]`.

### HARD9-086 — Optimistic rollback can resurrect a stale pin when two rapid writes to the same item race
- **Area:** config · **Severity:** P3 · **Dimensions:** correctness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/home/hooks/useConfigActions.ts:37-61`, `src/pages/config/useConfigLeafWrite.ts:29-46`, `src/pages/ConfigBrowserPage.tsx:461-487`
- **Failure scenario:** Pick value A (pin A, write A), quickly pick B (previousEntry_B={A}, pin B, write B queued). Write A fails → `restoreEntry(key, undefined)` deletes the pin (UI flips to stale device value while B in flight); if B also fails, `restoreEntry(key, {A})` re-pins A — a value the device never accepted — latched until an accidental echo or remount.
- **Fix sketch:** Only restore if the store's current entry still equals the value this write pinned; otherwise leave the newer pin intact.

### HARD9-087 — useInteractiveConfigWrite pending/burst flags are wrong under concurrent writes
- **Area:** config · **Severity:** P3 · **Dimensions:** correctness, ux-responsiveness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/hooks/useInteractiveConfigWrite.ts:150-186`
- **Failure scenario:** Two overlapping writes on one lane: the first to settle runs `finally: writeBurstActiveRef.current = false; setIsPending(false)` while the second is still in flight — `isPending` reads false during an active write; a third write sees `burst=false` → `quietUntil=0`, skipping the 400ms coalescing window.
- **Fix sketch:** In-flight counter (`pendingCountRef`); derive `isPending`/burst from `count > 0`.

### HARD9-088 — Failed throttled preview snaps the slider thumb back mid-drag
- **Area:** config · **Severity:** P3 · **Dimensions:** ux-responsiveness, robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/hooks/useDeviceBoundSlider.ts:224-233`
- **Failure scenario:** While dragging a lighting/pan slider, one throttled preview write fails transiently. `handlePreviewError` calls `setDraftSliderValue(null)` even though `isDraggingRef.current` is true — the thumb jumps back to the device value under the user's finger until the next drag tick. Reads as the app fighting the user.
- **Fix sketch:** Skip `setDraftSliderValue(null)` while dragging (keep the error callback).

### HARD9-089 — Category Refresh drops optimistic pins even when the refetch failed, silently masking a dead re-sync
- **Area:** config · **Severity:** P3 · **Dimensions:** robustness, correctness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/ConfigBrowserPage.tsx:663-691`
- **Failure scenario:** Refresh while the device is momentarily unreachable: react-query `refetch()` resolves with the error embedded, so `clearMatching(...)` still drops every pending pin and the Audio Mixer re-sync reads the STALE previous data as device truth. No failure indication — old values shown, in-flight write pins gone.
- **Fix sketch:** Check `refreshed?.isSuccess` before clearing pins/re-syncing; toast on explicit-refresh failure.

### HARD9-090 — Duplicate "Automatic Demo Mode" control with duplicate DOM id
- **Area:** settings · **Severity:** P3 · **Dimensions:** a11y, correctness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/SettingsPage.tsx:1312-1334,1785-1821`
- **Failure scenario:** With `demo_mode_enabled` on, both the Connection card and the Config card render `<Checkbox id="demo-mode-enabled">` + matching Label. Clicking the second card's label activates the first card's checkbox (first-id-wins); screen readers mis-associate; two identical settings ship with no hint they're the same switch.
- **Fix sketch:** Delete the leftover duplicate (Connection card is canonical), or give it a unique id.

### HARD9-091 — Notification-duration slider persists to storage on every drag tick
- **Area:** settings · **Severity:** P3 · **Dimensions:** performance, robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/SettingsPage.tsx:2570-2583`
- **Failure scenario:** `onValueChange={([v]) => { setNotificationDurationMs(v); saveNotificationDurationMs(v); }}` persists + broadcasts `c64u-app-settings-updated` on every pointermove tick — dozens of synchronous localStorage writes re-running every settings listener mid-gesture. Every other numeric setting commits on blur/Enter.
- **Fix sketch:** Keep `onValueChange` for local state; move the save into `onValueCommit`.

### HARD9-092 — Orientation lock re-applied on every SettingsPage mount (including swipe transits)
- **Area:** settings · **Severity:** P3 · **Dimensions:** robustness, performance · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/pages/SettingsPage.tsx:890-894`, `src/components/SwipeNavigationLayer.tsx:429-481`, `src/main.tsx:79`
- **Failure scenario:** `useEffect(() => { void applyScreenOrientationMode(mode); }, [mode])` fires on mount — and SettingsPage is transiently mounted by the swipe runway whenever Settings becomes an adjacent panel during a transition. Every swipe brushing past Settings issues a native `ScreenOrientation.lock()/unlock()` mid-animation, duplicating the startup apply. This is the documented "app re-applies stored orientation" trap generalized; the redundant plugin round-trips land in the most jank-sensitive frame window.
- **Fix sketch:** Apply inside `commitScreenOrientationMode` and delete the effect; startup application already exists in main.tsx.

### HARD9-093 — Mouse-drag gesture state stranded by a missed pointerup before intent lock
- **Area:** shell · **Severity:** P3 · **Dimensions:** robustness, ux-responsiveness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/hooks/useSwipeGesture.ts:139-182,226-232,250-298`
- **Failure scenario:** Pointer capture is deferred until intent is "navigating". A mouse drag staying under the 10px threshold (or classified "locked") has no capture; releasing outside the window means the container never gets `pointerup`, `state.active` stays true, and the next `pointerdown` is swallowed — one full press-drag interaction lost. Desktop/web only (touch has implicit capture).
- **Fix sketch:** Listen for `pointerup`/`pointercancel` on `window` (or reset on a fresh `pointerdown` from the same pointerId).

### HARD9-094 — Deferred startup bootstrap never runs if the app launches hidden
- **Area:** state · **Severity:** P3 · **Dimensions:** robustness, correctness · **Confidence:** medium · **Effort:** S · **Status:** OPEN
- **Files:** `src/main.tsx:26-81`
- **Failure scenario:** `scheduleAfterFirstPaint` gates the deferred bootstrap on double `requestAnimationFrame`; rAF doesn't fire while hidden. An app launched in the background (intent, restored session, screen off) never installs async-context propagation, fetch tracing, the trace bridge, interaction capture, or secure-storage priming until first becoming visible — requests made meanwhile are untraced; diagnostics for exactly the hard-to-reproduce background-startup bug class are missing.
- **Fix sketch:** `document.hidden` check falling back to `setTimeout(work, 0)` (or run once on `visibilitychange`).

### HARD9-095 — Module-scope import.meta.env read in App.tsx (Playwright collection tripwire)
- **Area:** state · **Severity:** P3 · **Dimensions:** robustness · **Confidence:** high · **Effort:** S · **Status:** OPEN
- **Files:** `src/App.tsx:76-79`
- **Failure scenario:** `const coverageProbeModulesAvailable = shouldBundleCoverageProbeModules();` executes `import.meta.env.VITE_ENABLE_TEST_PROBES`/`PROD` reads at module-evaluation time. Per the documented project failure class, any spec/config that transitively imports this module crashes Playwright `--list` (Node) collection for all shards. App.tsx exports test-oriented helpers that are natural import targets. (The probe pages themselves are correctly excluded from production builds.)
- **Evidence:** Reported independently by two reviewers; the codebase pattern elsewhere (traceBridge.ts:35-43, smokeMode.ts:168) reads the env lazily.
- **Fix sketch:** Compute lazily (memoized function) where the lazy `import()`s are declared; no env read at module scope.

---

## Carried-over verification (from hardening/5)

Verified **fixed** in current code (do not re-fix):

- **P0-1** circuit snapshot never recomputing after expiry → fixed: `circuitExpiryTimer` + read-time recompute (`deviceStateStore.ts:95-111`). *(Independently re-verified during this review.)*
- **P0-3 / P2-15** user-intent requests without timeout → fixed: `timeoutMs ?? resolveDefaultRestRequestTimeoutMs(intent)` (`c64api.ts:1305`).
- **P1-1** promotion resets losing queued user work / cancellations toasting → fixed (`InteractionCancelledError.isCancellation` honored, `fileValidation.ts:390-393`).
- **P1-2** UNKNOWN state blocking user intent → fixed (`deviceInteractionManager.ts:544-546`).
- **P2-4** probeInFlight leak → fixed (try/catch/finally).
- **P2-7** inflight generation tags → fixed.
- **P2-8** invalidateForSavedDeviceSwitch on failure paths → fixed.
- **P2-2** failure classification → substantially fixed (structured `c64uRestFailureKind`, timeout weight 0.5, caller-aborts excluded).

Still present, reduced severity: hardening/5 **P0-2** → now **HARD9-022**.

---

## Suggested fix batches

Batches group findings that touch the same files so one session can fix and test them together.
Within each batch, fix in the listed order.

1. **Auth & password UX** (unbreaks the worst dead-end): HARD9-001, 004, 025, 028, 043. Touches connectionManager/probe layer, SettingsPage password flow, SecureStoragePlugin.
2. **Native request lane & circuit UX**: HARD9-002, 023, 022, 024, 061, 060, 062. All in c64api.ts + deviceInteractionManager.ts + uiErrors.ts.
3. **Playback duration/songlengths**: HARD9-005, 006, 008, 064. PlayFilesPage + playFilesUtils + useSonglengths.
4. **Playback lifecycle**: HARD9-029, 030, 031 (L — do last), 033, 063; then 007 (shuffle layer, M).
5. **Playback perf**: HARD9-032, 034, 065, 066.
6. **Diagnostics hot path**: HARD9-019, 020, 021, 055, 056, 057, 058. traceSession/logging/overlay/use-toast.
7. **Disks**: HARD9-010, 012, 011, 037, 038, 068, 048.
8. **Snapshot**: HARD9-009, 035, 036, 039, 067, 069.
9. **HVSC chain**: HARD9-013, 014, 015, 040, 046, 074, 084, 075.
10. **Config write integrity**: HARD9-016, 017, 018, 050, 051, 052, 053, 054, 085, 086, 087, 088, 089.
11. **Sources/FTP**: HARD9-045, 047, 049, 070, 073, 078, 079, 080, 081, 082, 083, 076.
12. **Shell/settings polish**: HARD9-003 (do early — HIL-proven UX blocker), 026, 027, 090, 091, 092, 093.
13. **Background execution service**: HARD9-041, 042 (+ regression-test BUG-025/040 fixtures).
14. **Startup/state**: HARD9-044, 059, 071, 072, 077, 094, 095.

## Appendix — method notes

- Reviews executed 2026-07-01/02 as eight parallel subsystem agents over commit `afb6ea72`, each
  limited to production-reachable defects with concrete failure scenarios; known-intentional designs
  were pre-briefed and excluded. Findings were then merged, deduplicated (the App.tsx env read was
  reported twice; the runtime-file loss pattern appears as two distinct findings 011/047 by design),
  and re-ranked.
- Eight of the highest-severity claims were independently re-verified line-by-line before inclusion
  (marked **[verified]**). Two findings reproduce behavior observed live on a Pixel 4 + c64u
  (fw 1.1.0) the same night (marked **[HIL]**): the gesture-zone tap loss (HARD9-003) and the
  wrong-password → generic-OFFLINE dead-end (HARD9-001/004: a stray `t` appended to the saved
  password by a mis-aimed tap was silently persisted; the app then showed only `OFFLINE ○` while
  logcat showed `X-Password: pwdt` failing).
- `npx tsc --noEmit` and `npx eslint src --quiet` are clean at this commit.
- Line numbers reference `afb6ea72` and will drift; anchor on quoted identifiers when fixing.
