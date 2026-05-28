# Prod-Hardening-5 Feature-Surface Audit

Page-by-page risk audit, grounded in `docs/features-by-page.md` and current source.
Each page is rated against the deterministic priority taxonomy from the analysis
prompt (release blocker / high / medium / low / evidence gap / no action).

## 1. Home

- Production relevance: high — primary control surface.
- High-frequency interactions: lighting brightness/colour slider, drive/printer/SID
  toggles, SID mixer sliders, machine action taps.
- Long-running operations: RAM save/restore via SAF, REU snapshot via FTP+Telnet, app
  config save/load.
- REST/FTP/Telnet/native traffic: REST machine + config + drive + stream endpoints;
  Telnet REU/config/printer/drive/power workflows (all behind `withTelnetInteraction`
  with `user` intent for explicit user-pressed actions); native folder picker for RAM
  dump folder.
- Stale-state risks: drive/path/status cards rely on a mix of optimistic overrides
  and refetches; PH3 phase 4 documented reconciliation. No specific PH5 finding.
- Cancellation/supersession risks: REU/RAM long-running workflows are not user-cancelable
  mid-stream; failure is logged with context and surfaced.
- Optimistic UI risks: drive mount optimistic overrides documented and accepted.
- Testing status: Playwright + unit coverage marked Full/Partial in features-by-page.
- Missing regression tests: explicit "saved-device verification fails ⇒ runtime config
  not advanced silently" (covered by PH5-02 candidate).
- Candidate PH5 findings:
  - PH5-02-RESET-CYCLE-ON-RUNTIME-CONFIG-CHANGE (medium; cross-page) — saved-device
    flows touched from Settings affect Home immediately because Home shares the
    runtime base URL.

Page rating: medium (no release blocker, evidence-gap follow-up for runtime
config truthfulness).

## 2. Play

- Production relevance: critical — most user time spent here.
- High-frequency interactions: volume slider (latest-intent lane), playback transport
  taps (single-flight + coalesced Next/Previous), progress polling, search filter
  (repository-backed).
- Long-running operations: HVSC download/extract/index, recursive import enumeration,
  disk mount + autostart, cross-device disk origin upload.
- REST/FTP/Telnet/native: REST runners, config writes for volume, drive mount, FTP
  reads for cross-device origin and SID metadata, native BackgroundExecution plugin
  for due-time callback.
- Stale-state risks:
  - Late native FTP results after import cancel or saved-device switch could mutate
    the playlist if not gated by a generation token (PH5-04 candidate).
  - Playback state ownership is single-source via `pendingUserSkipRef` and the
    auto-advance guard; auto-advance and user transport are correctly separated.
- Cancellation/supersession risks:
  - Recursive import accepts AbortSignal at the JS layer; native enumeration is
    bounded by check-between-listings (PH1-PH14 partial).
  - Background auto-skip listener is once-only on mount (PH4-F3 verified) — PH5-05
    pure proof.
- Optimistic UI risks: playback transport advances visible index immediately while
  debouncing device launch (PH4-F2).
- Testing status: extensive Playwright + unit + Maestro coverage.
- Missing regression tests:
  - PH5-04-IMPORT-CANCEL-GENERATION (medium): native callback delivered post-switch
    must not append to active playlist.
  - PH5-05-NATIVE-LISTENER-ONCE-PROOF (low): explicit add/remove counter test for
    `backgroundAutoSkipDue` across state churn.
  - PH5-08-PLAY-START-CONNECTION-FIRST-PROOF (low): playback start ordering.
- Candidate PH5 findings: PH5-04, PH5-05, PH5-08.

Page rating: medium (PH3/PH4 cleared the high-severity surface; remaining items are
test-uplift and one stale-result generation guard).

## 3. Disks

- Production relevance: high — drive/disk control.
- High-frequency interactions: mount, eject, drive reset, group rotation.
- Long-running operations: local SAF blob upload, recursive disk import.
- REST/FTP/Telnet/native: REST `/v1/drives` endpoints, FTP browse for C64U disk
  import, native SAF readers.
- Stale-state risks: mounted-drive optimistic overrides reconcile after `drives`
  query refetch; PH3 phase 4 added explicit handling.
- Cancellation/supersession risks: removing a mounted disk now stops on eject failure
  (PH3 done). Late native results after switch — same generation concern as Play
  (PH5-04 candidate is shared across Play and Disks).
- Testing status: strong Playwright + unit; Maestro thin.
- Missing regression tests: covered by PH5-04 (same as Play).
- Candidate PH5 findings: PH5-04 (shared).

Page rating: medium.

## 4. Config

- Production relevance: high — exposes full device config tree.
- High-frequency interactions: ConfigItemRow sliders (latest-intent lane, PH2-WI-10).
- Long-running operations: audio mixer solo restore via sessionStorage.
- REST/FTP/Telnet/native: REST config endpoints only.
- Stale-state risks: writes are immediate; PH3 phase 1/2 verified the latest-intent
  lane.
- Cancellation/supersession risks: latest-intent lane supersedes stale jobs.
- Testing status: full Playwright + unit coverage.
- Missing regression tests: none required for new behavior.
- Candidate PH5 findings: none.

Page rating: low (verified fixed).

## 5. Settings

- Production relevance: high — connection lifecycle, diagnostics, safety mode.
- High-frequency interactions: saved-device switch via app-bar long press, safety
  mode toggle (relaxed-mode confirm gate).
- Long-running operations: discovery, settings transfer, diagnostics export.
- REST/FTP/Telnet/native: REST probes for device verification, native secure storage
  for passwords, native share intents for diagnostics ZIPs.
- Stale-state risks:
  - PH5-02: after `useSavedDeviceSwitching` applies the new runtime config and the
    follow-up `verifyCurrentConnectionTarget` returns offline/error, the runtime is
    already pointing at the new target. Subsequent user actions can fail silently
    until the user retries discovery. The UI shows a failure toast, but no automatic
    cancellation/revert is performed.
- Cancellation/supersession risks: device-switch cancels old-device queries and
  scheduler queues (PH3 phase 1 done).
- Testing status: partial unit; diagnostics dialog has dedicated unit tests.
- Missing regression tests: explicit "verification failure leaves recoverable state"
  — see PH5-02.
- Candidate PH5 findings: PH5-02.

Page rating: medium (PH5-02 is a truthfulness/recoverability concern, not a release
blocker, because the failure is surfaced through a toast).

## 6. Docs

- Production relevance: low — static content.
- High-frequency interactions: none.
- Long-running operations: none.
- REST/FTP/Telnet/native: none.
- Testing status: partial Playwright.
- Candidate PH5 findings: none.

Page rating: no action.

## 7. Open Source Licenses

- Production relevance: low — static bundled notice viewer.
- High-frequency interactions: none.
- Long-running operations: initial bundled fetch.
- REST/FTP/Telnet/native: same-origin static asset fetch only; not a device call.
- Stale-state risks: `cache: "no-store"` — every overlay open re-fetches; on native
  Android the Capacitor WebView serves `http://localhost/THIRD_PARTY_NOTICES.md`,
  bundled inside the APK.
- Cancellation/supersession risks: `cancelled` flag guards setState after unmount.
- Testing status: 6 unit tests in `tests/unit/pages/OpenSourceLicensesPage.test.tsx`
  including a load-failure case.
- Missing regression tests: failure paths covered. No additional tests required.
- Candidate PH5 findings: PH5-03 (low) — confirm bundled asset resolves on native
  through static testing, since the production native fetch is a Capacitor-served
  bundled resource rather than a runtime network call. Treat as informational
  coverage uplift, not a blocker.

Page rating: low.

## 8. Coverage Probe

- Production relevance: none (test-only route).
- Candidate PH5 findings: none.

Page rating: no action.

## 9. Not Found

- Production relevance: none (fallback route).
- Candidate PH5 findings: none.

Page rating: no action.

## 10. Music Player (legacy, unrouted)

- Production relevance: zero — not mounted by `App.tsx`.
- Candidate PH5 findings: none; legacy code is left as-is.

Page rating: no action.

## Cross-page concerns

### Connection lifecycle (Settings + Home + Play + Disks)

- PH5-02 is cross-page: the runtime base URL change affects every page consuming
  `useC64Connection`. The recoverability requirement is global.

### Playlist + disk-library + native I/O (Play + Disks)

- PH5-04 generation guard applies to both Play import and Disk library import,
  because both flows use `addFileSelections` / source adapters and both can be
  superseded by a saved-device switch.

### Diagnostics overlay

- No new finding; PH2-WI-2 verified `validateTarget` goes through the gateway.

### Background and visibility

- All known background paths are visibility-gated (`isAppVisibleForRediscovery`,
  `isDocumentHidden`, the `visibilitychange` listeners enumerated in WORKLOG).
- The web `visibilitychange` strategy works on Android Chromium WebViews — PH4
  research §3 verified this on Pixel 4.

## Summary of PH5 candidates ranked by deterministic priority

| Rank | PH5 ID | Page anchor | Class | Severity |
| ---- | ------ | ----------- | ----- | -------- |
| 1 | PH5-04-IMPORT-CANCEL-GENERATION | Play, Disks | Stale-result isolation | Medium |
| 2 | PH5-02-RESET-CYCLE-ON-RUNTIME-CONFIG-CHANGE | Settings (cross-page) | Recoverability/truthfulness | Medium |
| 3 | PH5-05-NATIVE-LISTENER-ONCE-PROOF | Play | Test uplift | Low |
| 4 | PH5-08-PLAY-START-CONNECTION-FIRST-PROOF | Play | Test uplift | Low |
| 5 | PH5-06-IDB-CONSOLE-WARN-ROUTING | global | Production log discipline | Low |
| 6 | PH5-01-CONCURRENT-WORKTREE-LANDING | global | Process hygiene | Low (process) |
| 7 | PH5-07-KOTLIN-PLUGIN-CONTEXT-FALLBACK | Android plugins | Exception discipline | Low |
| 8 | PH5-03-OPEN-SOURCE-LICENSES-NATIVE-FETCH | Open Source Licenses | Test uplift | Low |

Items 1-7 will be admitted to `prompt.md`. Item 8 (PH5-03) is recorded but kept out
of `prompt.md` because the existing 6 unit tests already cover the failure path, the
production native deploy was validated in PH3/PH4, and no current-code evidence shows
a defect — admitting it would be speculative.
