# Handover — Device discovery edge-case + stress testing, password handling, and a global Forbidden→password popup

> Paste everything below the line into a fresh session. It is self-contained: it assumes **no** prior
> conversation context. It continues the device-discovery / U2 / capability work on branch
> `feat/device-hardening`.

---

## ROLE
You are a principal-level Capacitor app engineer (Android/iOS/web) working on **C64 Commander** and
its **C64U Remote** variant. The network device-discovery feature has been implemented, unit-tested,
and given a first pass of on-device validation. Your job is: (A) implement a **global
"device Forbidden → ask for network password" popup**, (B) **edge-case and stress test** discovery
with first priority on a **network-password-protected device**, and (C) fill the validation gaps the
previous run did not exhaustively cover.

## WHAT ALREADY EXISTS (do not re-do)
- Discovery is wired end-to-end: startup auto-discovery (`connectionManager` →
  `tryAutomaticDeviceDiscoveryFallback` → `startDeviceDiscovery`), the global
  `DeviceDiscoveryInterstitial` (startup/resume), and an explicit **Settings → "Discover devices"**
  action (`settings-discover-devices`, present in BOTH variants). Native Android scan in
  `android/.../DeviceDiscoveryPlugin.kt` (bounded `/v1/info` LAN scan + known-host probes; returns
  `requiresPassword:true` on HTTP 401). Web + iOS return a graceful `unsupported` result.
- **U2 (Ultimate II)** is a first-class family (`ProductFamilyCode` incl. `"U2"`); classifier maps
  `Ultimate II/II+/II+L` → `U2`. U2 is **fixture-tested only** (no hardware).
- **Capability model** `src/lib/deviceCapabilities/` — `deriveDeviceCapabilities()` +
  `supportsStreaming/MenuInput/PowerCycle` + `detectStreamingFromConfig()`. Streaming is U64-family
  only (firmware: `/v1/streams` not compiled on U2); UI gates use predicates, not family literals.
- Build/deploy tool `scripts/build-android-apks.mjs`: `--variant commander|remote|all`, `--install`,
  `--uninstall-first`, `--reset-config` (`pm clear`), `--device <serial>`, `--skip-build`, `--help`.
- Existing password infrastructure to REUSE: `src/lib/secureStorage.ts`
  (`getPasswordForDevice`/`setPasswordForDevice`/`getPassword`/`setPassword`), the inline password
  prompt in `DeviceDiscoveryInterstitial.tsx` and `SettingsPage.tsx`, the Network Password field in
  Settings, and transport-error normalization in `src/lib/c64api/transportErrors.ts`.
- Read first: `docs/research/device-discovery/report.md` (full status + validation),
  `docs/research/device-discovery/research.md` (firmware/protocol research), `PLANS.md` + `WORKLOG.md`
  (latest sections, dated 2026-06-22). Working tree is UNCOMMITTED; do not commit/push unless asked.

## ENVIRONMENT (verified available in the previous run)
- Pixel 4, adb serial **`9B081FFAZ001WX`** (Android 16). Both packages installed side by side:
  `uk.gleissner.c64commander` ("C64 Commander"), `uk.gleissner.c64uremote` ("C64U Remote").
- Real LAN devices (probe with `curl -m5 http://<ip>/v1/info`; do NOT hard-code IPs into source/tests):
  - **C64U** `192.168.1.167` — "C64 Ultimate", fw 1.1.0, id 5D4E12. **A network password `pwd` is now
    set on this device.**
  - **U64** `192.168.1.13` — "Ultimate 64 Elite", fw 3.14e, id 38C1BA (no password).
- Tools: `adb`, droidmind MCP (`mcp__droidmind__android-{screenshot,shell,app,ui,log}`), and the
  **WebView CDP** technique (most reliable for inspecting/driving the SPA):
  ```bash
  PID=$(adb -s 9B081FFAZ001WX shell pidof uk.gleissner.c64commander | tr -d '\r')
  adb -s 9B081FFAZ001WX forward tcp:9222 localabstract:webview_devtools_remote_$PID
  node /tmp/cdp-eval.mjs '(() => location.href)()'   # minimal Runtime.evaluate helper; recreate if missing
  ```
  Recreate `/tmp/cdp-eval.mjs` if absent: it `fetch`es `http://localhost:9222/json/list`, opens the
  page `webSocketDebuggerUrl`, runs one expression via `Runtime.evaluate` (Node 24 global `WebSocket`).
- NOTE: in this environment, **Bash shell file writes/redirects can be ephemeral** — write durable
  artifacts (reports, code) with the editor/Write tooling, not `cat >`/`screencap >` redirects, and
  save on-device screenshots through a tool that writes the host filesystem.

## OBJECTIVE A — Global "Forbidden → ask for network password" popup (FEATURE TO IMPLEMENT) — HIGH PRIORITY
Requirement (from the product owner): **whenever the app receives a "Forbidden" response from a
device — during a health check, OR anywhere else in the app that a device returns Forbidden — a popup
must appear that states the problem and asks the user to enter the device's network password.**

Implement this as a single, app-wide behavior (not a per-call patch):
1. **Detect** the auth-required condition centrally. A network-password-protected Ultimate returns an
   auth error to unauthenticated/incorrectly-authenticated REST calls — confirm on real hardware
   whether it is HTTP **401 Unauthorized** and/or **403 Forbidden** (test against C64U `192.168.1.167`
   now that `pwd` is set), and handle **both** as "authentication required". The right chokepoint is
   the shared REST client / transport-error layer (`src/lib/c64api.ts`,
   `src/lib/c64api/transportErrors.ts`) and the health-check engine
   (`src/lib/diagnostics/healthCheckEngine.ts`) so EVERY device call is covered (info, config
   read/write, drives, runners, play, health check…).
2. **Surface a global popup** (reuse the existing password-prompt UX pattern). It must: name the
   affected device, state plainly that the device requires a network password (and that the saved
   password is missing/incorrect), and provide a masked password input + submit/cancel.
3. **On submit:** store via `setPasswordForDevice(activeDeviceId, password)`, re-apply the runtime
   config, and retry the failed operation (or re-probe) so the user recovers without restarting.
4. **Single-flight / debounce:** concurrent Forbidden responses (e.g. a burst of config reads) must
   raise at most ONE popup, not a storm. Dismissing it must not loop. Wrong password → clear error,
   re-prompt, never mark the device healthy.
5. **Scope:** works in BOTH variants and from any screen (Home health check, Config, Play, Diagnostics
   health check, saved-device switch, etc.). Tie it to the **active/affected** device's identity.
6. **Secret handling:** the password must NEVER be logged (logcat, in-app Diagnostics, trace context)
   nor written to evidence; the input must be masked.
7. **Tests:** add unit/component tests — transport layer maps 401/403 → an "auth required" signal; the
   popup opens once on Forbidden; submit stores the password + retries; wrong password re-prompts;
   no password leakage. Keep the full suite green.

## OBJECTIVE B — Network-password-protected device (edge-case validation) — HIGH PRIORITY
With `pwd` set on the C64U, validate the full password path on BOTH variants on real hardware:
1. Baseline: confirm what `curl -m5 http://192.168.1.167/v1/info` returns unauthenticated (401/403?)
   and that an authenticated request succeeds. Record actual behavior before testing.
2. Discovery shows **password required**: reset config (`--reset-config --skip-build`), launch, run
   Settings discovery → the C64U row indicates "Password required" and offers Save/Use; U64 appears
   normally.
3. Use with password: tap **Use** on the C64U → inline prompt → enter `pwd` → device saved, password
   in secure storage, app connects → HEALTHY.
4. Persistence: force-stop + cold-launch → reconnects using the stored password, no re-prompt.
5. Wrong password → clean, non-crashing error; device not marked healthy.
6. Startup auto-discovery with password: seed a stale/unreachable selected device so startup
   auto-discovery runs → interstitial offers the password-required C64U → prompt path works there too.
7. Confirm Objective A's global Forbidden popup also triggers for an ALREADY-saved device whose stored
   password becomes wrong/cleared (e.g. clear it via secure storage, run a health check → popup).
8. Secret-handling check: grep captured logcat + Diagnostics export for `pwd` → absent. Mask the field
   in any screenshot. Do not commit the password anywhere.

## OBJECTIVE C — Complete the HIL scenario matrix (gap from last run)
Run the brief's **3 consecutive cold-start iterations** per scenario per variant (the previous run did
each once/twice only): Scenario A (fresh/no usable config → auto-discovery), Scenario B (stale config,
none reachable → auto-discovery), Scenario C (≥1 reachable configured device → no blocking discovery
flow + explicit Settings discovery still finds both) — each **×3 cold starts × {C64 Commander, C64U
Remote}**. Fail → root-cause, fix, restart that counter.
- The shipped default host `c64u` sometimes resolves via DHCP DNS and sometimes not. To force A/B
  deterministically, seed an unreachable selected host (TEST-NET `203.0.113.9`) via CDP `localStorage`
  key `c64u_saved_devices:v1` (include a stale `U2` entry to keep exercising U2 as a valid persisted
  input). Note: with `pwd` now set, the C64U itself is "reachable but Forbidden until authenticated".

## OBJECTIVE D — Edge cases + stress
- **Single-flight under stress:** rapid/repeated "Discover devices" taps, and discovery while a scan
  or a connect is in flight → exactly one scan, no duplicates, no crash.
- **Lifecycle:** background/foreground mid-scan; route changes mid-scan; rotate (must stay Portrait).
- **Dedup edge cases:** device reachable by hostname AND IP, IP change between scans, same `unique_id`
  on two addresses → a single deduped row (uniqueId → hostname/product → address).
- **Network bounds:** scan stays bounded — no public ranges, bounded concurrency/timeout, read-only
  `/v1/info` only, no FTP/Telnet/stream/write during discovery (inspect logcat + Diagnostics).
- **Partial failure / slow host:** one device offline/slow mid-scan → the other still surfaces; no
  hang past the window; correct "no devices found" message.
- **Demo-mode interaction:** real candidates take precedence over the demo interstitial.
- **Capability refresh:** switching C64U↔U64 updates streaming/capability gating; persisted capability
  data refreshes on reachability/firmware change.
- **C64U Remote specifics:** keypad-first variant — verify discovery, the Forbidden popup, and the
  password prompt are reachable/operable via the `*`/`#`/digit shortcuts + D-pad focus ring.

## BUILD / DEPLOY (use the fixed tool)
```bash
node scripts/build-android-apks.mjs --variant all --install --uninstall-first --device 9B081FFAZ001WX
node scripts/build-android-apks.mjs --variant all --reset-config --skip-build --device 9B081FFAZ001WX
```
After deploy, ALWAYS confirm current code via CDP: check the loaded `SettingsPage` chunk hash and that
`[data-testid=settings-discover-devices]` is in the DOM. (A stale collected APK once shadowed fresh
builds — bug FIXED via `findApk` Gradle-output-first — but verify.)

## GATES (run before claiming done)
```bash
npx tsc --noEmit
npm run lint        # if variant:check fails, run `npm run variant:generate` (the build tool now
                    # auto-restores the default variant, but a manual run may be needed)
npx vitest run      # full suite — must stay green (626 files / 7262 tests as of handover)
```

## KNOWN GOTCHAS (carry forward)
- **Build-tool stale-APK** (FIXED): if the device ever runs an old chunk, pull the installed APK and
  `unzip -l | grep SettingsPage` vs `dist/`.
- **Per-variant generated files:** building sets `APP_VARIANT` and regenerates
  `src/generated/variant.ts` for that variant; the tool restores the default after building, but a
  manual `npm run variant:generate` may be needed or variant-dependent unit tests
  (featureFlags / AppBar.layout / PageContainer / settingsTransfer) fail.
- **C64U flakiness:** intermittent HTTP drop-out under load; the hostname `c64u` resolves on the Pixel
  only sometimes (DHCP DNS). Discovery (IP scan) is resilient and is the point of the feature.
- **Don't** hard-code device IPs or the password into source/tests; **don't** log the password;
  **don't** make destructive/streaming/reboot calls during discovery.

## ACCEPTANCE
- Global Forbidden→password popup implemented + tested: any 401/403 from a device (health check or
  anywhere) raises ONE popup naming the device and prompting for the network password; submit stores +
  retries; wrong password re-prompts; password never leaked; works on both variants from any screen.
- Password-protected C64U: discovered as password-required, connectable with `pwd`, persists across
  restart, fails cleanly on wrong password — both variants, evidence captured (password masked).
- HIL 3×-consecutive matrix completed (or true blockers documented) for Scenarios A/B/C × both
  variants. Edge-case + stress findings recorded; bugs root-caused, fixed, and covered by tests.
- `tsc` / `lint` / full `vitest` green. `WORKLOG.md` + `report.md` updated. Evidence saved durably.
- Be factual: do not claim a 3× pass you did not run; do not claim U2 hardware validation.
