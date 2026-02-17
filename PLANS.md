# PLAN: CTA Highlight Reset + Demo Auto-Reconnect

## Problem Summary

Two systemic issues are being fixed:

1. Custom CTA-like UI elements can remain visually highlighted/focused after click.
2. Demo mode does not reliably auto-transition to real mode when the configured C64U becomes reachable later.
3. Provide objective proof that CTA highlight activation clears automatically after the configured timeout.
4. Android memory-constrained emulator gating must assume a 3GB RAM, 2-core, 2GHz/core device profile.

This plan is the authoritative tracker and is updated as work progresses.

---

## Architectural Analysis (UI Layer)

### Existing CTA interaction stack

- Global interaction hook: `src/lib/ui/buttonInteraction.ts` via `registerGlobalButtonInteractionModel()` mounted in `src/App.tsx`.
- Shared button primitive: `src/components/ui/button.tsx` with click delegation into `handlePointerButtonClick()`.
- Additional CTA wrappers: e.g. `QuickActionCard`, tab bar, list rows, settings cards, diagnostics controls.
- Visual feedback currently relies on:
  - Focus ring/flash (`focus-visible` + `.focus-flash`)
  - transient tap attribute (`data-c64-tap-flash`)
  - component-level active/selected styles

### Root cause for highlight persistence

- Global interaction detection was too narrow (button-role-centric), so non-button CTAs could miss deterministic transient reset behavior.
- Highlight duration constant was not aligned to required value (`200ms` vs `~220ms`).
- Coverage for non-button semantics (links/tab roles/tabIndex-driven CTAs) was incomplete.

---

## Exhaustive CTA Inventory

Inventory command used:

- `rg --no-heading "onClick=|onPointerDown=|onMouseDown=|role=\"button\"|tabIndex=\{" src --glob '**/*.tsx' --glob '**/*.ts' | cut -d: -f1 | sort -u`

### CTA abstraction files

- `src/components/ui/button.tsx`
- `src/lib/ui/buttonInteraction.ts`
- `src/components/QuickActionCard.tsx`
- `src/components/TabBar.tsx`
- `src/components/ConnectivityIndicator.tsx`
- `src/components/DiagnosticsActivityIndicator.tsx`

### Files with direct click/pointer handlers (41)

- `src/App.tsx`
- `src/components/AppBar.tsx`
- `src/components/ConnectivityIndicator.tsx`
- `src/components/DemoModeInterstitial.tsx`
- `src/components/DiagnosticsActivityIndicator.tsx`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/components/disks/DiskTree.tsx`
- `src/components/disks/HomeDiskManager.tsx`
- `src/components/itemSelection/AddItemsProgressOverlay.tsx`
- `src/components/itemSelection/ItemSelectionDialog.tsx`
- `src/components/itemSelection/ItemSelectionView.tsx`
- `src/components/lists/SelectableActionList.tsx`
- `src/components/QuickActionCard.tsx`
- `src/components/SectionHeader.tsx`
- `src/components/TabBar.tsx`
- `src/components/ui/button.tsx`
- `src/components/ui/carousel.tsx`
- `src/components/ui/sidebar.tsx`
- `src/components/ui/slider.test.tsx`
- `src/components/ui/slider.tsx`
- `src/lib/ui/buttonInteraction.ts`
- `src/pages/ConfigBrowserPage.tsx`
- `src/pages/DocsPage.tsx`
- `src/pages/home/components/MachineControls.tsx`
- `src/pages/home/components/PrinterManager.tsx`
- `src/pages/home/components/StreamStatus.tsx`
- `src/pages/home/components/SystemInfo.tsx`
- `src/pages/home/dialogs/LoadConfigDialog.tsx`
- `src/pages/home/dialogs/ManageConfigDialog.tsx`
- `src/pages/home/dialogs/PowerOffDialog.tsx`
- `src/pages/home/dialogs/SaveConfigDialog.tsx`
- `src/pages/home/DriveCard.tsx`
- `src/pages/HomePage.tsx`
- `src/pages/home/SidCard.tsx`
- `src/pages/MusicPlayerPage.tsx`
- `src/pages/playFiles/components/HvscControls.tsx`
- `src/pages/playFiles/components/PlaybackControlsCard.tsx`
- `src/pages/playFiles/components/PlaybackSettingsPanel.tsx`
- `src/pages/playFiles/components/PlaylistPanel.tsx`
- `src/pages/playFiles/components/VolumeControls.tsx`
- `src/pages/SettingsPage.tsx`

---

## Exhaustive CSS Active/Focus Inventory

Inventory command used:

- `rg --no-heading ":active|:focus|:focus-visible|\\.active\\b|data-\\[state=active\\]|data-c64-tap-flash" src --glob '**/*.css' --glob '**/*.tsx' --glob '**/*.ts' | cut -d: -f1 | sort -u`

### Files controlling active/focus/pressed visual states (7)

- `src/index.css`
- `src/components/ui/tabs.tsx`
- `src/components/ui/toast.tsx`
- `src/components/diagnostics/GlobalDiagnosticsOverlay.tsx`
- `src/pages/SettingsPage.tsx`
- `src/lib/ui/buttonInteraction.ts`
- `src/lib/ui/buttonInteraction.test.ts`

### Key state selectors/classes audited

- `button:focus-visible`, `.focus-flash:focus-visible`
- `data-c64-tap-flash`
- `.tab-item.active`
- Tailwind active/focus tokens used by base UI primitives (`focus-visible:*`, `data-[state=active]:*`)

---

## Connection Lifecycle Analysis

### Entry/ownership

- Connection lifecycle source of truth: `src/lib/connection/connectionManager.ts`
- Runtime orchestration and timers: `src/components/ConnectionController.tsx`

### Current lifecycle (audited)

- Startup: `initializeConnectionManager()` then `discoverConnection('startup')`
- Manual/settings/background triggers call shared `discoverConnection()`
- Demo transition sets mock runtime endpoint and `DEMO_ACTIVE`
- Background rediscovery is scheduled while in `DEMO_ACTIVE` or `OFFLINE_NO_DEMO`

### Root-cause gap fixed

- Duplicate background triggers could overlap/cancel in-flight probe behavior.
- Requirement is explicit: avoid duplicate concurrent probes and auto-transition seamlessly once real device is reachable.

---

## Implementation Plan (Live)

1. [x] Complete exhaustive CTA and style inventory
2. [x] Introduce shared CTA highlight constant at `220ms`
3. [x] Centralize and broaden interactive element detection for transient highlight reset
4. [x] Keep only explicit persistent-active exception path for long-running CTA state
5. [x] Harden background discovery to prevent overlapping probe cancellation races
6. [x] Add/update deterministic unit tests for both issues
7. [ ] Run lint/tests/coverage/build/full build helper
8. [ ] Push branch and verify CI green via `gh` run monitoring
9. [ ] Finalize this plan with validation evidence
10. [x] Add screenshot-based transient highlight proof requirement and generate evidence
11. [x] Update Android emulator gating profile to 3GB RAM, 2 cores, assumed 2GHz/core

---

## Changes Implemented So Far

### CTA fix implementation

- Updated `src/lib/ui/buttonInteraction.ts`
  - Added shared constants:
    - `CTA_HIGHLIGHT_DURATION_MS = 220`
    - `CTA_HIGHLIGHT_ATTR = 'data-c64-tap-flash'`
  - Expanded interactive target selector to include semantic and custom CTA targets:
    - buttons, links, summary, role-based controls, and focusable tabIndex controls
  - Kept keyboard accessibility (`event.detail === 0` click path unchanged)
  - Added explicit persistent-active opt-out attribute: `data-c64-persistent-active='true'`
- Updated `src/index.css`
  - Expanded tap-highlight suppression coverage for non-button CTAs
  - Applied transient flash style to any `[data-c64-tap-flash='true']`
- Updated Play control exception:
  - `src/pages/playFiles/components/PlaybackControlsCard.tsx`
  - Play button now marks persistent active state while playback is active

### Demo auto-reconnect hardening

- Updated `src/lib/connection/connectionManager.ts`
  - Background trigger no longer preemptively cancels active discovery
  - Duplicate background probe requests are skipped while one is already active
  - In-flight background probe cleanup made deterministic via `try/finally`

### Tests added/updated

- `src/lib/ui/buttonInteraction.test.ts`
  - Verifies transient flash uses shared `220ms` constant
  - Verifies persistent-active CTA exemption
  - Verifies global interaction model covers non-button CTA (`a[href]`)
- `tests/unit/connection/connectionManager.test.ts`
  - Added regression test ensuring overlapping background rediscovery calls do not abort in-flight success and still transition demo → real

### Android emulator profile update

- Updated `.github/workflows/android.yaml` (Android | Maestro gating):
  - AVD profile set to `3072MB` RAM, `2` CPU cores, low-ram disabled.
  - Added explicit `ANDROID_AVD_CPU_FREQ_MHZ=2000` and persisted into AVD `config.ini` via `hw.cpu.speed`.
  - Runtime boot assertions now validate CPU core count and memory total against the 3GB/2-core assumption.
- Updated `scripts/run-maestro-gating.sh`:
  - Defaults aligned to `3072MB` RAM, `2` cores, `2000MHz` assumed CPU profile.
  - CI gate now checks runtime CPU/memory profile instead of `ro.config.low_ram=true`.

---

## Risk Analysis

- **Risk:** broad selector could include unintended elements.
  - **Mitigation:** constrained to interactive semantics (`button`, `a[href]`, role-based controls, explicit tabIndex, explicit data marker).
- **Risk:** breaking keyboard focus behavior.
  - **Mitigation:** transient flash still pointer-only; keyboard click path remains exempt.
- **Risk:** race conditions in discovery transitions.
  - **Mitigation:** background dedupe + in-flight guard + deterministic cleanup.
- **Risk:** visual regressions in intentional stateful controls.
  - **Mitigation:** explicit persistent-active path for long-running play CTA.

---

## Test Matrix

### Unit

- CTA highlight duration and cleanup at `220ms`
- Pointer-only behavior; keyboard-triggered click exempt
- Persistent-active CTA exemption
- Global model applies to non-button CTA targets
- Demo mode background rediscovery transitions demo→real
- Duplicate background trigger does not cancel in-flight probe

### Integration / E2E

- Existing connection simulation/demo mode suites remain required for CI
- Existing representative page interactions cover broad CTA surface in Playwright
- Dedicated proof capture: take screenshot immediately after activation and shortly after timeout, while asserting transient attribute clears

### Proof Requirement (Added)

- Must provide screenshot evidence for CTA highlight activation and post-timeout cleared state.
- Acceptable proof includes a deterministic Playwright test with before/after screenshots and explicit attribute assertions.

---

## Definition of Done

- [x] Shared single highlight duration constant set to `220ms`
- [x] CTA highlight reset centralized in reusable abstraction
- [x] Play button active playback state is explicit persistent-active exception
- [x] Exhaustive CTA and CSS state inventory documented
- [x] Demo mode auto-reconnect path hardened with non-overlapping probes
- [ ] All required local checks green (lint, test, coverage, build, full build helper)
- [ ] CI green and verified via `gh`
- [ ] Plan updated with final evidence and zero remaining TODOs

---

## Verification Evidence (Proof: CTA Highlight Timeout)

### Automated proof run

- Command: `npx playwright test playwright/buttonHighlightProof.spec.ts --project=android-phone`
- Result: `1 passed`

### What was asserted

- On CTA activation, `data-c64-tap-flash="true"` is present.
- After `320ms`, the same CTA no longer has `data-c64-tap-flash="true"`.

### Screenshot artifacts generated

- Activation screenshot:
  - `test-results/playwright/buttonHighlightProof-CTA-h-d026d-ars-after-transient-timeout-android-phone/button-highlight-active.png`
- Post-timeout screenshot:
  - `test-results/playwright/buttonHighlightProof-CTA-h-d026d-ars-after-transient-timeout-android-phone/button-highlight-cleared.png`
