# Intense HIL testing of the 0.9.4 features — handover, 2026-07-29

Your job is to keep hunting real defects in the features **new since 0.9.3** by driving the app on
the physical Pixel 4 against real hardware, and to fix what you find. This is not a regression
sweep against a checklist — the checklist has already passed. It is an open-ended hunt for the
things that only appear when a real person uses the app in ways nobody wrote a test for.

Work on branch `fix/rc4-hil-hardening` (PR #326, `OPEN`/`MERGEABLE`, **33 CI checks green** at
`00526a15`) or on a fresh branch off it. Do not stop until the outstanding work is done and the PR
is merge-ready.

> **One machine only: the c64u.** The u64 is in use by the owner and must not be touched at all —
> this overrides the standing Ralph prompt's u64-as-fallback permission. If the c64u is unavailable,
> stop and report rather than reaching for the other machine. Full rule in §6.

---

## 1. Where things stand

`0.9.4-rc4` is tagged and released as a pre-release. PR #326 carries the hardening that came out of
two rounds of HIL against it. Seven defects were found on hardware and fixed, each with a
regression test verified to fail without its fix:

| Area | Defect |
| --- | --- |
| Playback | The seek gate (`seekPending`) latched shut on a lost or superseded `seeked` reply, silencing every following tune. |
| Playback | The watchdog judged seeks and opens, which each already have their own bound — so hold-to-seek killed a healthy worker. |
| Playback | A new tune's `open` queued behind the abandoned tune's renders and seeks. |
| Playback | The one seek already *running* still blocked a new tune, so a new tune now starts on a fresh worker. |
| Playback | A timed-out open lost the track permanently; it is transient, so it is now retried once. |
| UI | The toast viewport swallowed taps on the Play transport, so **any** error killed Play/Pause/Next. |
| Diagnostics | The compact-index downgrade was logged every 5 s, taking 313 of the log's 500 entries. |

Plus: the keypad edition now ships HVSC (`hvsc_enabled` was `false` since PR #303, which left SID
Radio offering stations with no library behind them).

**Read `docs/agentic/hil-rc4/FINDINGS.md` before you start.** It has the full evidence, the two
rounds of method, and — most usefully — the things that looked like defects and were not.

---

## 2. What to test

74 `feat`/`perf` commits landed between `0.9.3` and rc4. The ones worth hunting in, roughly in
order of how much new surface they added:

1. **On-device SID playback** (`libsidplayfp` WASM, reSIDfp vs SIDLite, ROMs read from the
   Ultimate). The engine is the newest and most stateful thing in the app.
2. **Seeking** — tap the progress bar, hold Previous/Next, live scrub feedback, seeks served from
   the pre-render cache. Every one of the five playback defects above came from here.
3. **SID Radio** — song stations, category/style stations, station sizing and retiring empty ones,
   the ♥/✕ ranking that feeds them, persistence and resume.
4. **"Listen on: C64 / Both / This device"** and the volume that follows it — the routing decision
   that owns two audio sinks at once.
5. **Live View** — screen palette, the tone & colour ladder, the analysers, the Wi‑Fi audio route
   (developer-mode only; see the trap in §5).
6. **Content Explorer** and the HVSC browse/search path at 61k songs.

Cross-feature combinations are where the remaining defects will be. Everything above has been
exercised in isolation; the interesting cases are two of them at once, interrupted.

---

## 3. The infrastructure

### 3.1 The autonomous loop

`.github/prompts/ralph.prompt.md` is the renewable release-hardening loop; the unit of progress is
**one complete probe pack for a control family**, not one control. `.github/prompts/agentic-test.prompt.md`
is the narrower "drive the device and produce evidence" prompt. Loop state lives in `docs/agentic/`
(git-ignored apart from its `README.md`): `STATE_DIGEST.md`, `BUGS_FOUND.md`, `LESSONS.md`,
`CTA_LEDGER.md`, the incident logs, and `artifacts/iterN/`. `PLANS.md` and `WORKLOG.md` stay at the
repo root.

Launch a loop with `ralph-robin -f <prompt-file>`; it rotates across providers and suspends the
machine until a quota window renews rather than idling. `--max-iterations 1` for a single shot.

### 3.2 Tooling

- **droidmind** — device input. Note the physical-coordinate scale (×2.755/2.75) and that
  `KEYCODE_MENU` is swallowed.
- **c64bridge** — register-level truth on the machine: `$DC00` for the joystick (port 2,
  active-low), `read_screen`/`$0400` for screen codes, `read_menu_screen`. Beats logcat when the
  build does not log what you need.
- **c64scope** — capture/assert/session harness for streams.
- **CDP over the WebView debug socket** — the only way to observe app state directly. `adb forward
  tcp:9333 localabstract:webview_devtools_remote_<pid>`, then `node scripts/bughunt-cdp.mjs eval
  '<js>'` (tracked, so it survives a fresh clone).

**The app's REST goes through native CapacitorHttp**, so it never appears in CDP Network, and
release builds log nothing to logcat. The in-app Diagnostics log is the authoritative source.

### 3.3 The rc4 campaign harness

Under `docs/agentic/hil-rc4/` on this machine (git-ignored — it will not survive a fresh clone, so
copy it forward or rebuild it):

| Script | What it does |
| --- | --- |
| `taptid.sh <testid>` | Tap by `data-testid`, scrolling it into the interactive band first and **hit-testing with `elementFromPoint`** so an overlay can never silently eat the tap. `--check` hit-tests only; `--noscroll` for fixed elements. |
| `snap.sh <case>` | Screenshot + CDP DOM inventory for a route. |
| `campaign/probe.sh` | One JSON line of transport state + the app log, read without touching the UI. |
| `campaign/report.py <capture> <watermark>` | What is new since a watermark; exit status is the new-error count. |
| `campaign/scrub-stress.sh <rounds>` | The seek storm that found five defects: a seek every 200 ms, full-width sweeps, fast flicks, a track change every other round. |
| `campaign/explore.sh <scenario>` | Named scenarios: `pause-seek`, `engine-flip`, `radio-churn`, `radio-rank`, `tab-churn`, `liveview-toggle`, `realistic`. |
| `campaign/soak.sh <laps>` | All scenarios in rotation with playback and the mirror both running. |

Build and deploy with `./build --skip-tests --install-apk` (single variant, default) or
`node scripts/build-android-apks.mjs --variant all|remote|commander` for both editions.

---

## 4. Rig

- Pixel 4, serial `9B081FFAZ001WX`. DPR 2.75, viewport 392×829 CSS, physical = css × 2.75, no
  offset, full-screen WebView.
- **`c64u` at `192.168.1.148` (fw 1.2.0) is the only machine you may touch.** See §6.
- **Always re-read `/etc/hosts`** — the IPs are DHCP-volatile and a stale one looks exactly like a
  device dropout.
- The app's startup discovery lists every machine on the network, so the wrong one is one tap away.
  Match on the device id, not on position: **`5d0464` is the c64u** (the one to use), `38c1ba` is
  the u64, `f13e69` is the u2. The testids are `startup-use-discovered-device-id:<id>`.
- Currently installed: `uk.gleissner.c64commander` at `0.9.4-rc4-40758`, `uk.gleissner.c64uremote`
  at `0.9.4-rc4-00526`. Both have HVSC v85 installed (61,157 songs).
- The Callback 8020 **does not exist**; the Pixel 4 stands in for every phone. Never gate a task
  on it.

---

## 5. Traps that cost real time this session

**The toast viewport used to swallow transport taps** — fixed, but the lesson stands: when a
visible, enabled button "does nothing", hit-test it (`taptid.sh --check`) before blaming the
handler. A CDP `element.click()` bypasses overlays and tells you instantly whether the handler is
fine. I raised two false "button does nothing" findings before adopting this.

**The diagnostics log is newest-first, and clearing it does not stick** — an in-memory cache writes
the whole array back on the next entry. Filter by a timestamp watermark instead, and take that
watermark from the **device** clock via CDP: it is hours away from the host's.

**Verify a fix is load-bearing by removing it**, and make sure your removal actually applies. I
"proved" a fix twice with a `python replace` whose pattern silently did not match, which passes for
the wrong reason. Assert the substring exists before replacing.

**The Pixel can drop into MIDI USB mode.** `adb devices` shows nothing while `lsusb` still lists
the phone; `lsusb -v -d 18d1:4eea` shows only a MIDI interface. Only a physical replug or USB-mode
change fixes it, so ask — do not burn the session diagnosing it. The user usually cannot power-cycle
hardware on demand; treat physical asks as rare and batch them.

**Never `git add -A`.** A local build rewrites `package-lock.json`, `c64scope/package-lock.json`
and `THIRD_PARTY_NOTICES.md`; sweeping that churn into a commit has broken CI here before. Add
explicit paths and `git checkout --` the churn before pushing.

**`wifi=true` on `audio:start` returns HTTP 400** and is *not* a bug — that route is the unreleased
firmware path and is developer-mode-only. If you enable developer mode to reach the SID Radio
settings, remember to turn it off before judging Live View.

**The c64u reported "unhealthy" is usually the app, not the device.** Under heavy tab churn the JS
thread starves and the app's own 3 s health poll times out while the c64u answers the *host* in
13 ms. Check from the host before believing the badge. The health state machine rides these out.

**Do not run two drivers at once.** An orphaned scenario script competing with a new one corrupts
both runs. Kill by explicit PID — `pgrep -f <pattern>` matches its own shell and has killed the
agent's own bash here (exit 144).

**Before amending a failing test, ask whether the new behaviour makes sense to a user.** If not, it
is a regression and the production code is wrong. Two tests were legitimately amended this session
(the open now retries once; HVSC is on by default in the keypad edition) — both because the new
behaviour is better for the user, and both say so in a comment.

---

## 6. Rules

- **The u64 is off limits for this campaign. Use the c64u and nothing else.** The owner needs the
  u64 for other work, so it must be left completely alone: no REST, no FTP, no Telnet, no streams,
  no config reads, no "just checking it is up". This **overrides the standing Ralph prompt**, which
  permits the u64 as a fallback when the c64u is unreachable (`ralph.prompt.md`, HARD RULES §6) —
  that permission does not apply here.
  - If the c64u is unreachable or wedged, **stop and report the blocker**. Do not fall back, and do
    not treat "isolating app logic" as a reason to reach for the other machine.
  - The c64u drops out intermittently when overloaded; that is not a regression. Wait for it, or
    hand off. Re-probe it right before any cross-device claim.
  - Anything that enumerates peers — startup discovery in the app, `c64scope` lab-readiness or
    peer-health calls — will surface the u64. Seeing it listed is fine; acting on it is not.
- **Do not tag a release** unless every main workflow concluded `success` or `skipped`.
- Every fix gets a regression test, and you must **watch it fail without the fix**.
- Reproduce on the device before fixing. Where a failure might be self-inflicted, re-run against an
  **unmodified rc4 debug build installed over the same app data** (`adb install -r -d` keeps the
  signing key, so HVSC, devices and collection survive and both builds see identical state).
- Record defects in `docs/agentic/BUGS_FOUND.md` with severity, repro, evidence, root cause and
  status; durable lessons in `docs/agentic/LESSONS.md`.
- Keep the PR body current — it is the artifact the owner reads.

---

## 7. Known-open

~17 KB of demo-mode assets still ship in the keypad edition, where demo mode is permanently off.
AGP has no clean per-variant asset exclusion without product flavors, which is a larger change than
the saving justifies. Flagged in the PR body under "Left open, deliberately".

One question for the owner rather than a task: HVSC was disabled for the keypad edition in PR #303
and has now been re-enabled on request. If that was originally about storage on the target handset
(85 MB archive, ~372 MB extracted), the constraint still applies and this change does not address
it.
