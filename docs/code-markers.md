<!--
  Generated index of the issue markers referenced in code comments.
  Regenerate after a hardening/bug-hunt cycle: see "How this file is maintained" below.
-->

# Code markers (`HARDxx-NNN`, `BUG-NNN`)

Throughout the codebase, comments tag a fix with a marker such as `HARD19-022:` or
`BUG-066:`. Each marker is one finding from a review-and-harden cycle (`HARDxx-*`) or an
exploratory bug-hunt (`BUG-*`). The authoritative per-finding write-ups (failure scenario,
code anchors, fix sketch, regression-test strategy) live in the working docs under
`docs/plans/hardening/<cycle>/review.md` and `docs/agentic/BUGS_FOUND.md`, which are
intentionally **git-ignored** (large, process-internal, and superseded each cycle).

This file exists so a marker in the code is never a dangling reference: every marker that
appears in a committed source comment is listed below with its one-line finding title, so a
developer has enough context to understand what a comment refers to. For the full detail of
any fix, use `git log --grep=HARD19-022` (each fix commit carries its marker + summary) or,
if present locally, the working doc for that cycle.

## How this file is maintained

Regenerate the lists from the (local, git-ignored) working docs so it stays in sync with the
markers actually referenced in committed code — titles from each cycle's `review.md` findings
index table and from `docs/agentic/BUGS_FOUND.md`. Only markers referenced in `src/` or
`android/` are included (this is a reference for code comments, not a full backlog).

## Hardening findings

### HARD9

- `HARD9-001` — Wrong/changed device password strands app in OFFLINE with no prompt
- `HARD9-004` — Saved-password editor silently mutates and persists the secret
- `HARD9-005` — Duration slider clobbers every playlist item's resolved duration
- `HARD9-006` — Mid-track duration change never re-arms auto-advance guard
- `HARD9-007` — Shuffle doesn't shuffle; Reshuffle irreversibly destroys order
- `HARD9-008` — Songlengths cache cleared on every playlist change → repeated multi-MB re-parses
- `HARD9-009` — Full-range custom snapshot silently saves empty (u16 truncation)
- `HARD9-010` — Mount/eject success judged by HTTP status; firmware in-body errors discarded
- `HARD9-011` — CommoServe-imported disks permanently unmountable after remount
- `HARD9-012` — Disks page hardcodes read-only mounts, breaking in-game saves
- `HARD9-013` — HVSC ingest promise never settles after cancel (reject in cancelled coroutine)
- `HARD9-014` — Stale "update applied" records survive HVSC reset, block updates forever
- `HARD9-015` — Poisoned empty browse snapshot → recursive HVSC add returns zero songs
- `HARD9-016` — Latest-intent write lane drops committed writes to a different config item
- `HARD9-017` — Profile load/revert/flash-load never invalidate `c64-config-items`
- `HARD9-018` — Save-to-App / revert baseline / verification read a stale persistent cache
- `HARD9-019` — Full trace ZIP exported on every recorded error
- `HARD9-020` — Unguarded localStorage log writes; O(n) parse/stringify per log line
- `HARD9-021` — Closed diagnostics overlay copies full trace/log stores on every event
- `HARD9-025` — Password field write race between connection state and secure-storage load
- `HARD9-026` — 600ms drag-settle timer collapses a held swipe mid-gesture
- `HARD9-027` — Diagnostics overlay scroll save/restore targets the wrong scroller (dead code)
- `HARD9-028` — Saved-device switch reports auth failure as "offline"
- `HARD9-029` — Playing a new track while machine paused leaves C64 frozen, UI "playing"
- `HARD9-030` — Deleting the playing item resets UI but device keeps playing; watchdog armed
- `HARD9-032` — Playlist rows rebuilt on every 1s timeline tick (memoization defeated)
- `HARD9-033` — Cancel during add-items can throw inside a React state updater
- `HARD9-034` — Concurrent playlist repository commits can persist a stale snapshot
- `HARD9-035` — CPU snapshot "saved" toast while C64 left frozen (resume failure swallowed)
- `HARD9-036` — CPU restore failure strands machine in restore cart; no RAM-only fallback
- `HARD9-037` — Mount sheet permits concurrent mounts to the same drive
- `HARD9-038` — Local-disk rotation/eject-before-delete break after first drives poll
- `HARD9-039` — Capture-timeout rollback can corrupt safe region while CPU executes it
- `HARD9-040` — Failed HVSC baseline promotion can delete the only library copy
- `HARD9-041` — Late setDueAtMs resurrects phantom FGS + wake lock after Stop
- `HARD9-042` — Stale-generation FGS start intent never calls startForeground (crash risk)
- `HARD9-044` — FTP/SAF readFile buffers whole file ×3.3 in heap — OOM on large files
- `HARD9-045` — normalizeSourcePath collapses internal whitespace, corrupting paths
- `HARD9-046` — Ingestion finalize overwrites songlengths projection with duration-less records
- `HARD9-047` — Web local sources list files after reload that can no longer be opened
- `HARD9-048` — Disk library save effect writes stale/empty state before load settles
- `HARD9-049` — Archive entries with a dot in the name rejected despite byte detection
- `HARD9-050` — Throttled-preview sliders leave device at intermediate value on return-to-start
- `HARD9-051` — Home quick-config writes never set hasChanges → Revert stays disabled
- `HARD9-052` — Home optimistic pins: no routing-epoch clear, no watchdog
- `HARD9-054` — Audio Mixer solo routing bypasses mutation layer; stale snapshot restore
- `HARD9-055` — Error-toast eviction + sliding dedup window silently hide persistent failures
- `HARD9-056` — Backend-decision correlation set grows unbounded
- `HARD9-057` — Trace persistence exceeds sessionStorage quota; size accounting broken on restore
- `HARD9-058` — Fetch trace duplicates full request/response payloads in the hot path
- `HARD9-059` — Smoke-mode localStorage fallback is a self-perpetuating latch in prod
- `HARD9-063` — Volume sync wedges after starting a new track from paused state
- `HARD9-064` — Session restore revives "playing" UI for a dead device session
- `HARD9-067` — Snapshot restore halts CIA TOD clocks / flips ICR mask bits
- `HARD9-068` — resolveLocalDiskBlob cross-source fallback can mount the wrong disk
- `HARD9-069` — Snapshot store silently drops oldest snapshot at the 100 cap
- `HARD9-070` — FTP control encoding never set — non-ASCII filenames unfetchable
- `HARD9-071` — Mock C64U HTTP+FTP servers ship in release builds, registered unconditionally
- `HARD9-072` — TelnetSocket state read/written across threads without synchronization
- `HARD9-073` — cancelRead after completion leaves permanent entries in cancelledReads
- `HARD9-074` — 7-Zip probe subprocess has no timeout — wedged probe bricks ingestion
- `HARD9-076` — Device-discovery probe leaks HttpURLConnection on body-read failure
- `HARD9-077` — MainActivity.onCreate does synchronous filesystem repair on main thread
- `HARD9-078` — Recursive FTP listing's timed_out flag dropped by the JS contract
- `HARD9-079` — Native CommoServe transport ignores AbortSignal — Cancel doesn't cancel
- `HARD9-080` — Shared preset-refresh promise: unmount-abort → unhandled rejection, stuck status
- `HARD9-081` — Web FTP recursive scan unbounded while native caps at depth 8 / 5000
- `HARD9-082` — Refresh clears only the exact current path; recursive adds serve 10-min-stale cache
- `HARD9-083` — Pre-aborted FTP read still performs the full transfer
- `HARD9-084` — HVSC cancellation unchecked during deletion pass and finalize
- `HARD9-085` — CategorySection disables every row while any single write is pending
- `HARD9-086` — Optimistic rollback can resurrect a stale pin on racing writes
- `HARD9-087` — useInteractiveConfigWrite pending/burst flags wrong under concurrent writes
- `HARD9-088` — Failed throttled preview snaps the slider thumb back mid-drag
- `HARD9-089` — Category Refresh drops optimistic pins even when the refetch failed

### HARD10

- `HARD10-002` — CommoServe-imported disks lose their bytes and cannot be re-mounted
- `HARD10-003` — Mock C64U **HTTP** server: unbounded reads, no socket timeout, unbounded thread pool
- `HARD10-004` — Mock FTP **command** socket has no read timeout; both mock pools unbounded
- `HARD10-005` — Mock C64U loopback surface is unauthenticated (blank FTP password, no HTTP token)
- `HARD10-007` — No AUTH-distinct connection badge state; wrong password reads as generic OFFLINE
- `HARD10-008` — Eager `?raw` asset import in c64PreviewLayout trips Playwright Node collection
- `HARD10-009` — IndexedDB `track:*` records are never garbage-collected (unbounded row growth)

### HARD11

- `HARD11-001` — Settings import applies developer-only/hidden feature-flag overrides without developer mode or confirmation
- `HARD11-002` — Saved-device switch during active playback re-targets transport controls and auto-advance at the wrong C64
- `HARD11-003` — Playlist end leaves the C64 audibly playing with no Stop affordance (button flips to Play)
- `HARD11-004` — Subsong switching keeps the previous subsong's duration; auto-advance fires at the wrong time
- `HARD11-005` — Background-playback foreground-service notification hardcodes "C64 Commander" — brands C64U Remote wrongly

### HARD12

- `HARD12-002` — Settings import silently wipes existing hidden/developer-only feature-flag overrides (HARD11-001 residual)
- `HARD12-003` — Saved-device switch failure between selection flip and API config application leaves a lasting half-switched state
- `HARD12-004` — Lighting Studio engine runs ungated by its feature flag: user-lane LED config reads on every main-tab visit in both variants, and a flag-independent device write path
- `HARD12-005` — Next/Previous transport buttons disabled by linear-order logic while shuffle traversal still has tracks
- `HARD12-006` — Volume-override session is lost on Play remount, so Stop after tab-away never restores the device mixer
- `HARD12-007` — Playlist "Remaining" total is wrong from track 2 onward: playItem resets the cumulative played clock on every track start
- `HARD12-008` — Kernal-mode disk autostart writes 16 bytes into the C64's 10-byte keyboard buffer, scribbling OS variables ($0281-$0286)
- `HARD12-009` — DMA disk autostart misclassifies large/nonstandard tokenised BASIC as machine code and SYSes into the program header
- `HARD12-010` — Interactive config write lane reports false success for merged earlier writes when the batch fails
- `HARD12-011` — Late /v1/info success from the previous device can stamp its identity onto the newly selected saved device
- `HARD12-012` — Legacy default password bleeds to every saved device without its own entry and is silently migrated + transmitted to other hosts
- `HARD12-013` — Every local disk mount hashes the full disk image (up to 64 MB) for a debug log line even with debug logging disabled
- `HARD12-014` — Non-recursive folder add still walks the whole folder tree recursively (FTP on c64u) for songlengths discovery
- `HARD12-015` — Per-file O(n²) rebuild of the prefetched config-candidate map during playlist adds
- `HARD12-017` — Feature: remote keyboard/joystick input sheet on Home, using `machine:input` when the firmware offers it (absent in documented 1.1.0 API) with kernal keyboard-buffer fallback
- `HARD12-018` — Foreground service + partial wake lock retained indefinitely after a song playlist auto-ends (nothing left to schedule)
- `HARD12-019` — Discovery save can silently retarget an existing saved device when two devices share a factory hostname
- `HARD12-020` — Home's page-local machine pause state desyncs from Play's pause; resuming from Home leaves playback muted
- `HARD12-021` — SID SSL upload writes the duration at subsong-1's slot regardless of songnr, so device-side songlength propagation is wrong for every other subsong
- `HARD12-022` — Every tab transition fully mounts adjacent pages (the documented root of the transient-instance bug class), and E2E probe mode disables exactly that behavior

### HARD13

- `HARD13-001` — Capability-downgrade/close release-all is inert once the tier has already downgraded — held inputs stranded on the device
- `HARD13-002` — A coalesced+throttled input send can dispatch *after* an immediate release-all/port-swap, re-asserting a released input (stuck held input)

### HARD15

- `HARD15-001` — Kernal-fallback typing races: concurrent unserialized keyboard-buffer injections garble input and burst-load the c64u
- `HARD15-002` — machine:input probe caches transient errors forever — one timeout permanently downgrades a capable U64 to keyboard-only
- `HARD15-004` — Owed-release signal derived from the wrong state in `setPort` and the tier-downgrade effect (40 ms strand window)
- `HARD15-005` — Movement-style switch while a direction is held strands the direction pressed on the device (unbounded window)
- `HARD15-006` — Transient connection blip bounces the sheet from Joystick to Keys mode and never bounces back
- `HARD15-007` — Send-failure recovery assumes the failed batch was not applied; a timed-out-but-applied press can never be released by the UI

### HARD16

- `HARD16-001` — Startup saved-device sweep stamps the reachable device's identity onto the still-selected unreachable device (and skips port application)
- `HARD16-002` — "resume" recovery policy is dead code — a foregrounded app never runs the saved-device sweep/discovery and can stay OFFLINE while a saved device is reachable
- `HARD16-003` — Cursor hold-repeat outruns the serialized kernal-fallback injector — runaway cursor after release + sustained wedge-class load on c64u
- `HARD16-004` — Enrichment-namespace flip migrates the previous identity's cached items into the new namespace — firmware upgrades / same-host swaps durably serve stale option enums
- `HARD16-005` — Model-absent config items re-interrogated on every Home/Disks mount — absence never negatively cached
- `HARD16-006` — Quick-keys RUN/STOP lacks its caution affordance and sits beside RETURN — destructive mis-tap primed, inconsistent with the Keys tab
- `HARD16-007` — Compact/medium keyboard grid re-flows C64 rows at fixed columns, splitting QWERTY rows; letters below the fold on compact
- `HARD16-008` — Sheet visual-consistency cluster: dual toggle patterns, body gutter, expanded dead space, REST. label
- `HARD16-009` — `invalidateForRouteChange` dead code + route-scoped switch invalidation leaves `c64-drives`/`c64-all-config` without identity protection (impact currently bounded)
- `HARD16-010` — Single-slot pre-switch release registry displaced-then-nulled by transient adjacent-page mounts — E1/HARD13-001 safety net silently disabled after an aborted Home↔Play swipe
- `HARD16-011` — Dynamic-config fallback doctrine applied inconsistently — printer/drive controls still offer fabricated hard-coded option lists pre-discovery

### HARD18

- `HARD18-001` — Queued input batch survives failure-recovery reset, strands held input on device
- `HARD18-002` — SHIFT LOCK indicator stale after releaseAll (background/panic); typing goes unshifted
- `HARD18-003` — Aborted health-check run skips CONFIG pulse revert; LED/volume setting left changed
- `HARD18-004` — Sheet close leaves stale physical-key contribution set; later touch-held input wrongly released
- `HARD18-005` — Remote input relay funneled through shared single-slot REST scheduler; slow REST freezes joystick relay
- `HARD18-006` — Write-path backoff/cooldown sleeps hold exclusive REST slot; forced health probes stall behind them
- `HARD18-007` — Manual/background reconnect never escalates to saved-device sweep or LAN discovery; IP change strands app offline
- `HARD18-008` — Device Switcher re-pulses CONFIG write on every saved device every 10s; close aborts mid-pulse leaving values changed
- `HARD18-009` — Stop during in-flight track transition silently overridden; queued playItem re-asserts isPlaying
- `HARD18-010` — Load-from-flash/Reset-to-default never invalidate per-item config queries; controls stay stale indefinitely
- `HARD18-011` — Device switch while Play unmounted orphans background-execution session; wake lock unstoppable until process death
- `HARD18-012` — Telnet execution lacks discovery's polling pause; power-cycle outage trips circuit breaker into false-offline
- `HARD18-014` — REU "Preload on Startup" armed against volatile /Temp ramdisk; can never fire after a power cycle
- `HARD18-015` — Snapshot save while user-paused silently resumes machine and strands SID mixer muted
- `HARD18-016` — Developer-only flag overrides stay applied after developer-mode exit; hidden features stuck on/off invisibly
- `HARD18-017` — Deleting a mounted disk ghost-mounts: bare unmount + deleted override leaves stale drive card until next poll
- `HARD18-018` — Pause-mute/resume/Home restore ignore firmware Vol Master (U64 3.15+); multi-item POST bursts where one PUT suffices
- `HARD18-019` — Lighting Studio reconciler: full multi-item POST payloads + unbounded failure retry via 60s tick; auto-applies across device switch
- `HARD18-020` — Lighting preview: no case/keyboard light mixing in key areas; mode Off/zero intensity still glows (alpha floor)
- `HARD18-021` — Health-check CONFIG pulse revert clobbers concurrent user mixer/lighting writes inside the pulse window
- `HARD18-022` — Home reboot/power-cycle leaves playback session armed; auto-advance relaunches content on the cleared machine
- `HARD18-023` — CommoServe Run/Mount&run bypasses playback session; armed auto-advance later reboots machine mid-game
- `HARD18-024` — REU save downloads /Temp file on first change with no size-stability/sanity check; truncated snapshot + false success
- `HARD18-025` — Writable upload-mounts silently discard C64 disk writes; in-game saves lost on remount, no warning/write-back
- `HARD18-026` — All telnet sessions outside useTelnetActions (config refs per track, REU/config workflows) overlap REST polling; central pause missing
- `HARD18-027` — Diagnostics Retry-connection builds host:port:80 for custom-port devices; recovery CTA always fails with false evidence
- `HARD18-028` — Native HVSC updates never remove deleted/moved songs from the browse index; dead+duplicate entries accumulate per update

### HARD19

- `HARD19-001` — Kernal-fallback tier: merged CRSR keys can never send cursor up/left
- `HARD19-002` — DirectionPadButton lacks drag-off ref reset, swallows next keypad activation
- `HARD19-003` — VirtualDPad shared axes without contribution tracking drop held direction
- `HARD19-004` — Manual health check permanently pins global health badge (no staleness bound)
- `HARD19-005` — Disk write-back lacks device affinity: eject after device switch can corrupt local disk image
- `HARD19-006` — Write-back tracking memory-only: process death + eject silently discards in-game saves
- `HARD19-007` — Materialized mounts break drive-card identity (label, rotation, delete-protection)
- `HARD19-008` — Play-page disk mounts silently discard Home's pending write-back saves
- `HARD19-009` — Home Pause doesn't suspend Play timeline; auto-advance launches on paused machine
- `HARD19-010` — Home Pause doesn't mute SID mixer: frozen SID drone during pause
- `HARD19-011` — Snapshot restore doesn't publish machine takeover; auto-advance launches over restored session
- `HARD19-012` — Reachable-saved-device fallback bypasses all device-switch hygiene fixes
- `HARD19-013` — Kernal-fallback tier: failed injection pins indicator on "Reconnecting…" forever
- `HARD19-014` — CommoServe disk write-back persists into 10-min in-memory LRU; saves evaporate silently
- `HARD19-015` — Native SAF writeFileToTree delete-then-create overwrite can destroy the original file
- `HARD19-016` — HVSC songlengths forced post-ingestion reload swallowed by in-flight load coalescing
- `HARD19-017` — Kernal-fallback injection queue survives device switch: PETSCII typed into the new device
- `HARD19-018` — Playback autostart injections bypass the keyboard-buffer serialization queue
- `HARD19-019` — HVSC reset mid-hydration: zombie hydrator resurrects deleted index, can clobber reinstall
- `HARD19-020` — Diagnostics "Clear all" leaves the pinned health-check result driving the badge
- `HARD19-021` — playItem bakes fallback duration without the "default" marker: wrong 3:00 pinned forever
- `HARD19-022` — Disk autoplay silently, permanently reconfigures physical drive mode with no restore
- `HARD19-023` — Partial config snapshot silently accepted: incomplete Save-to-App profile and permanent partial revert baseline
- `HARD19-024` — Revert verification counts an unreadable category as N false mismatches
- `HARD19-025` — Save/Load-flash and Reset-defaults ignore firmware errors array: false success toast
- `HARD19-026` — useHvscLibrary lifecycle runs regardless of hvsc_enabled: disabled HVSC still does background native I/O (C64U Remote)
- `HARD19-027` — Health rollup: unreachable optional FTP/Telnet marks a REST-perfect device whole-device Unhealthy
- `HARD19-028` — Dismissing startup discovery picker permanently disables all automatic reconnection for the session
- `HARD19-029` — Settings export/import silently drops REST max concurrency + machine-input cooldown
- `HARD19-030` — Imported screen-orientation neither applied nor shown until next app launch
- `HARD19-031` — Home Reset and Power Off never publish machine takeover: playlist auto-advances over reset/powered-off machine
- `HARD19-032` — Reset-family success wipes pause-mute restore flag: reset-while-paused strands SID mixer muted
- `HARD19-033` — Tab-page crash fallback has no recovery action; working retry boundary is dead code; shared i18n key
- `HARD19-034` — Saved-device background health maintenance never runs (enabled flag false in exactly that mode)
- `HARD19-035` — C64U Remote settings export hardcodes the other product's filename; payload carries no variant marker
- `HARD19-036` — IP-rescue scan queues unbounded behind in-flight discovery on native single-thread executor: ~20s frozen Save
- `HARD19-037` — Persistent error toasts auto-dismiss after notice duration: Radix provider duration applies to destructive toasts

## Bug-hunt findings

- `BUG-010` — H2 CPU Speed quick-config change left u64 unreachable before restore
- `BUG-025` — Background-execution wake lock leaks after Stop once the Play page has been remounted while playing (BUG-024-class symptom, new JS root cause)
- `BUG-026` — Config Audio Mixer volume slider DRAG desyncs UI vs device AND floods c64u into REST-unresponsive (High)
- `BUG-027` — Android hardware Back navigates the route instead of dismissing an open non-modal overlay (dropdown menu / select / popover) (Medium)
- `BUG-028` — Android Back globally trapped at tab roots after the BUG-027 fix (non-modal back-dismiss listener leak) (Medium)
- `BUG-031` — Settings appearance control actuation incomplete: theme fixed (#42), auto-rotation/all checkboxes fixed (#43) (Medium)
- `BUG-032` — Diagnostics overflow "Views" menu not a dismissal-layer participant: Android Back over-dismisses the whole dialog + outside-tap falls through (Medium)
- `BUG-033` — Config slider shows stale committed value after an external change (Audio Mixer Reset); Refresh does not reconcile (Medium)
- `BUG-034` — Config Drift diagnostics view issues a DESTRUCTIVE `PUT /v1/configs:load_from_flash` on open (silently reverts unsaved runtime config) + unpaced request burst trips c64u "Connection reset" (High)
- `BUG-036` — Stale/wrong-target health attribution after switching active device (badge + Diagnostics health card show previous target's Healthy)
- `BUG-040` — Background-execution guard (wake lock + foreground service) is released when leaving the Play tab while playing, leaving playback unprotected if then backgrounded/locked from another route (Medium)
- `BUG-061` — Fresh-data startup sends default c64u Home requests during discovery and contaminates diagnostics/badge after U64 selection
- `BUG-064` — CPU Speed slider on Home silently fails for single-digit speeds: app sends unpadded value the firmware rejects (FIXED #127)
- `BUG-066` — Home Quick Config bottom controls can overlap the TabBar hit area and misroute taps
- `BUG-069` — Background-aborted Home config read is logged as unexpected "Host unreachable" and degrades a healthy U64
- `BUG-072` — Play page filter checkboxes obscured by the bottom TabBar overlay

