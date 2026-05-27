# Production Hardening 2 — Implementation Prompt

You are an expert senior engineer working on **C64 Commander** (React + Vite +
Capacitor; controls a Commodore 64 Ultimate / Ultimate 64 over REST, FTP, Telnet).

This is an **implementation** task. Execute the plan that fixes every finding from the
prod-hardening-2 research. Read these first and treat them as the source of truth:

- `docs/research/stabilization/prod-hardening-2/research.md` — evidence, architecture,
  inventory, risk register, target policy, acceptance criteria.
- `docs/research/stabilization/prod-hardening-2/plans.md` — the ordered work items
  (WI-1 … WI-11), files, and per-item tests.
- Repo rules: `.github/copilot-instructions.md` (overrides), `AGENTS.md`/`CLAUDE.md`,
  `docs/ux-guidelines.md` if any UI changes, `docs/testing/maestro.md` for Maestro.

Classify this as **CODE_CHANGE** (with required doc/test artifacts). No visible UI
redesign is intended; the device picker and badges keep their current look.

## The problem (one paragraph)

The device-protection gateway (`src/lib/deviceInteraction/deviceInteractionManager.ts`
+ `scheduleConfigWrite` + device-safety presets) is sound, but a few edges bypass it or
are mis-prioritised, and the **background** health-check path is too heavy. Route every
device call through the gateway, delete the bypasses and quirks, and redesign the
background health path to be near-free when idle — **without** touching the wanted
device-picker behaviour.

## Hard constraints (do not violate)

1. **Single gateway.** Every REST/FTP/Telnet call goes through `withRestInteraction` /
   `withFtpInteraction` / `withTelnetInteraction`; every config write also through
   `scheduleConfigWrite`. **No direct `fetch`/socket to a device endpoint** anywhere
   else (probes, diagnostics, discovery included).
2. **Keep the device-picker 10 s full health cycle EXACTLY as-is** (the
   `switchDeviceDialog` context in `useSavedDeviceHealthChecks`): same 10 s cadence,
   same parallel fan-out across saved devices, same CONFIG pulse. This is wanted.
3. **Only the background path changes.** `backgroundMaintenance` health must become:
   selected-device-only, freshness-gated, a **single read-only `GET /v1/info`** (no
   FTP/Telnet/CONFIG/memory, no fan-out), with health primarily **derived from the
   traffic the app already makes**, adaptive cadence, and circuit-respecting. Idle
   healthy device ⇒ ~0 dedicated probes. Unreachable selected device ⇒ surfaced
   immediately.
4. **Delete bypasses and quirks; keep it simple.** Remove the `connectionManager`
   raw-fetch fallback outright (do not "wrap" it). Remove the dead `immediate` option.
   Collapse duplicate timeout logic. Do not add speculative abstraction.
5. **Do NOT chase the firmware lock-up root cause.** Assume any fast sequence of
   REST/Telnet/FTP calls can wedge the listener; harden against that class.
6. **UI responsiveness only via local state / coalescing / latest-intent latch** — never
   by bypassing the gateway or the rate limiter.
7. **Every behavioural change ships a regression test** that fails before and passes
   after, targeting the specific condition. Exercise scheduler logic with
   `__c64uForceInteractionScheduling` (because `isTestEnv()` bypasses gating).
8. Obey the exception-handling rule (never swallow errors), DRY/KISS, and the
   modularization guardrails.

## Work items (execute in this order; details in plans.md)

**Phase 1 — safety + bypass removal + quirk cleanup**
- WI-1 Delete `connectionManager` raw-fetch fallbacks; discovery uses gateway `getInfo`
  only.
- WI-2 Route `GlobalDiagnosticsOverlay.validateTarget` through the gateway (`user`).
- WI-3 Thread `__c64uIntent` through `readMemory`/`writeMemory*`/uploads; stop
  `fetchWithTimeout` hardcoding `user`.
- WI-4 Add `readmem`/`writemem` cooldown keys in `resolveRestPolicy`.
- WI-5 Remove `__c64uBypassCircuit` from health/discovery REST probes; report from state
  when the circuit is open.
- WI-6 Remove the dead `immediate` option from `updateConfigBatch` (+ 3 callers);
  collapse duplicate request timeouts; document/de-duplicate the read-cache layers.
- WI-7 Tag health probe intents (observability); picker cadence unchanged.

**Phase 2 — background-health redesign (core)**
- WI-8 Background = selected-device-only + freshness gate + single `/v1/info` probe +
  traffic-derived health + adaptive cadence + circuit respect. **Leave the
  `switchDeviceDialog` branch untouched.** Update `UnifiedHealthBadge` to consume
  traffic-derived health and show last-seen age for non-selected devices.

**Phase 3 — regression prevention**
- WI-9 CI guard (ESLint `no-restricted-syntax` or a unit test) forbidding device-endpoint
  `fetch`/socket outside the gateway modules + PR checklist line.
- WI-10 Migrate `ConfigItemRow` sliders onto the latest-intent lane (coalesce long drags).
- WI-11 (optional) Tag user-pressed Telnet actions `user`.

## Method

1. Re-read `research.md` + `plans.md`. For each work item, confirm the current code at
   the cited file:line before editing.
2. Implement the smallest coherent change per item; keep repo conventions; Prettier-clean
   on write.
3. Add/Update the per-item regression tests listed in `plans.md`.
4. Keep `PLANS.md` (root) or a task checklist updated as items complete; do not weaken or
   delete existing tests; fix root causes, never suppress.
5. If REST routing/trace semantics change (WI-1/2/6), re-record and commit golden traces
   under `playwright/fixtures/traces/golden`; never weaken trace assertions.

## Validation (per phase, then final)

- Targeted Vitest for changed specs → `npm run test` → `npm run lint` → `npm run build`.
- `npm run test:coverage` must show **≥91% branch** globally. For any `agents/` change,
  `npm run test:agents` **≥90%** branch.
- Deploy the latest APK from `android/app/build/outputs/apk/` to the attached Pixel 4
  (serial prefix `9B0` preferred; uninstall+reinstall if blocked), launch, and validate:
  sliders stay responsive, picker health is live (10 s), and the idle app is quiet
  (no background fan-out). Record the device/host used, or document a concrete
  hardware/adb blocker.
- For device-flow validation prefer `u64` over `c64u`; probe `http://u64/v1/info` then
  `http://c64u/v1/info`. Record which target was used; do not claim device validation if
  neither is reachable.

## Convergence / done when

All acceptance criteria in `research.md` ("Acceptance Criteria for Future
Implementation", items 1–14) hold, in particular:
- 0 device-endpoint `fetch`/socket calls outside the gateways (guarded in CI).
- Picker-open 10 s full cycle unchanged (proven by test).
- Idle healthy `C64U` background health ops/min ≈ 0; background probe is a single
  `/v1/info`, selected-device-only, freshness-gated; failed real calls flip the badge.
- `readmem`/`writemem` spaced; memory/upload/probe intents correct; no `bypassCircuit`
  on routine probes; circuit-open ⇒ no probe traffic.
- Sliders bounded (≤1 in-flight + ≤1 trailing per drag, no snap-back).
- No dead `immediate` flag; single timeout mechanism per request path.
- Tests green; coverage ≥91%; APK deployed + validated on Pixel 4 (or blocker recorded).

## Out of scope

- The firmware lock-up root cause.
- Any change to the wanted device-picker 10 s full health cycle.
- Pre-existing unrelated working-tree edits owned by concurrent work
  (`.github/workflows/android.yaml`, `playwright/playback.part2.spec.ts`,
  `tests/unit/ci/telemetryGateWorkflow.test.ts`) — leave them as-is.

## Final report

Summarize: what changed per work item; tests/builds run and results; coverage number;
golden-trace updates (if any); the Pixel 4 deploy + on-device validation outcome (or the
blocker); and any deviations from `plans.md` with justification.
