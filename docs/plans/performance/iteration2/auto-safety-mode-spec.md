# Auto Device-Safety Mode - Functional Spec

## Motivation

The Commodore 64 Ultimate (`c64u`) has a known firmware degradation pattern: REST endpoints stop responding after sustained or fast-paced load that the Ultimate 64 Elite (`u64`) handles fine. Iteration 1 evidence showed `c64u` `/v1/info` failing with connection-reset within 17-161 ms while `u64` answered in 27-33 ms. Once `c64u` enters that state, the only recovery is a physical power cycle.

The existing safety presets (`RELAXED`, `BALANCED`, `CONSERVATIVE`, `TROUBLESHOOTING`) already encode the right trade-off. The problem is that the user is expected to remember to switch to `CONSERVATIVE` whenever they pick a saved device whose product family is `C64U`, and switch back to `BALANCED` when they pick the `U64`. Nobody does that reliably.

The fix is a new safety mode, `AUTO`, that performs this selection itself, based on the verified product family of the currently-selected saved device.

## Goal

`AUTO` is the new recommended default. When `AUTO` is selected:

- if the currently-selected saved device has a verified `lastKnownProduct` (or freshly `lastVerifiedProduct`) of `C64U`, the effective preset is `CONSERVATIVE`;
- otherwise, the effective preset is `BALANCED`.

The user does not have to do anything. Switching saved devices automatically re-resolves the effective preset.

## Code shape

These changes are scoped to existing files. No new module is introduced.

### `src/lib/config/deviceSafetySettings.ts`

- Extend `DeviceSafetyMode`:

  ```ts
  export type DeviceSafetyMode = "AUTO" | "RELAXED" | "BALANCED" | "CONSERVATIVE" | "TROUBLESHOOTING";
  ```

- Update `normalizeMode()` to recognize `AUTO`.
- Change `DEFAULT_DEVICE_SAFETY_MODE` to `"AUTO"`. Existing installs whose `localStorage` already has a stored mode are untouched; only fresh installs see the new default.
- Do **not** add a fifth row to `MODE_DEFAULTS`. `AUTO` is not a preset; it resolves to one of the existing presets at read time.
- Introduce a pure resolver:

  ```ts
  export type ResolvedSafetyPreset = "BALANCED" | "CONSERVATIVE";

  export type AutoResolutionContext = {
    activeProduct: ProductFamilyCode | null; // from saved-devices store
    activeDeviceId: string | null;           // for telemetry / logging
  };

  export type AutoResolution = {
    storedMode: DeviceSafetyMode;            // what the user picked, including AUTO
    effectiveMode: Exclude<DeviceSafetyMode, "AUTO">;
    resolvedPreset: ResolvedSafetyPreset | null; // null when stored mode isn't AUTO
    isProvisional: boolean;                  // true when AUTO resolved without a verified product
    reason: string;                          // short human-readable explanation
  };

  export const resolveAutoSafetyMode = (
    stored: DeviceSafetyMode,
    ctx: AutoResolutionContext,
  ): AutoResolution => { ... };
  ```

  Rules inside `resolveAutoSafetyMode`:

  - If `stored !== "AUTO"`, return `{ effectiveMode: stored, resolvedPreset: null, isProvisional: false, reason: "explicit-user-choice" }`.
  - If `stored === "AUTO"` and `ctx.activeProduct === "C64U"`, return `effectiveMode = "CONSERVATIVE"`, `resolvedPreset = "CONSERVATIVE"`, `isProvisional = false`, reason `"auto-c64u"`.
  - If `stored === "AUTO"` and `ctx.activeProduct` is one of `"U64" | "U64E" | "U64E2"`, return `effectiveMode = "BALANCED"`, `resolvedPreset = "BALANCED"`, `isProvisional = false`, reason `"auto-u64-family"`.
  - If `stored === "AUTO"` and `ctx.activeProduct === null`, return `effectiveMode = "BALANCED"`, `resolvedPreset = "BALANCED"`, `isProvisional = true`, reason `"auto-no-verified-product"`. The provisional flag is recorded in diagnostics so soak runs can detect when AUTO has not yet seen a verified product.

- Update `loadDeviceSafetyConfig()`:
  - Read the stored mode as today.
  - Look up the currently-selected saved device's product family. The lookup must not depend on React state; it reads directly from `savedDevicesStore` (or whatever sync accessor exists there). If neither `lastKnownProduct` nor `lastVerifiedProduct` is set, treat the product as `null`.
  - Run `resolveAutoSafetyMode(stored, ctx)` and pick `MODE_DEFAULTS[effectiveMode]` as the base preset.
  - Apply user overrides (existing behavior) on top of the resolved preset.
  - Return the existing `DeviceSafetyConfig` shape **plus** a new optional `resolution: AutoResolution` field so consumers can render the resolution and diagnostics can log it.

### `src/lib/savedDevices/store.ts`

- Expose a tiny sync accessor: `getSelectedSavedDeviceProductFamilySync(): ProductFamilyCode | null`. Reads from the in-memory snapshot. Used by `deviceSafetySettings` and by `deviceInteractionManager`.
- After `completeSavedDeviceVerification()` and after any change of `selectedDeviceId`, broadcast the existing `c64u-device-safety-updated` event (or a new equivalent `c64u-active-device-product-changed` event the safety subscriber listens to) so `deviceInteractionManager.updateConfig()` re-runs and the new effective preset takes effect immediately.

### `src/lib/deviceInteraction/deviceInteractionManager.ts`

- No structural change. It already calls `loadDeviceSafetyConfig()` on every event from `subscribeDeviceSafetyUpdates`. The only additional wiring is to make sure changes in the active saved device (or its verified product) trigger that same broadcast.

### `src/pages/SettingsPage.tsx`

- Add a new `SelectItem` for `AUTO` as the **first** option:

  ```tsx
  <SelectItem value="AUTO">Auto (Conservative for C64U, Balanced for others) - recommended</SelectItem>
  ```

- Below the select, when `AUTO` is the active stored mode, render a small read-only line:

  ```
  Effective preset: Balanced - resolved from active device (U64 Elite, verified).
  ```

  or, when provisional:

  ```
  Effective preset: Balanced (provisional - no verified product yet for this device).
  ```

- The relaxed-mode confirm dialog is unchanged. Selecting `AUTO` from `RELAXED` should not re-trigger the warning. Selecting `RELAXED` from `AUTO` should trigger it as today.

### `src/lib/config/settingsTransfer.ts`

- The settings export must include `AUTO` as a valid value.
- The settings import must accept `AUTO` and reject unknown values (existing behavior).

### Diagnostics

- The active `AutoResolution` (stored, effective, resolvedPreset, isProvisional, reason, activeProduct, activeDeviceId) is appended to the diagnostics state snapshot already exported by the diagnostics dialog.
- A single log line is emitted at `info` level when the effective preset changes, with `mode`, `resolvedPreset`, `provisional`, `activeProduct`, and `activeDeviceId`. This is the line the soak relies on to prove AUTO followed the device.

## Behavior matrix

| Stored mode | Active saved device product | Effective preset | Provisional | Notes |
| --- | --- | --- | --- | --- |
| `AUTO` | `C64U` (verified) | `CONSERVATIVE` | no | Goal case for c64u soak |
| `AUTO` | `U64`/`U64E`/`U64E2` (verified) | `BALANCED` | no | Goal case for u64 soak |
| `AUTO` | none verified yet | `BALANCED` | yes | Provisional - upgrades automatically once `/v1/info` verifies |
| `AUTO` | no saved device selected | `BALANCED` | yes | Same as above |
| `BALANCED` | any | `BALANCED` | no | User opt-out of automation |
| `CONSERVATIVE` | any | `CONSERVATIVE` | no | User opt-out, more cautious |
| `RELAXED` | any | `RELAXED` | no | User opt-out; confirmation dialog gated as today |
| `TROUBLESHOOTING` | any | `TROUBLESHOOTING` | no | Also enables debug logging, as today |

## Acceptance tests

Unit:

1. `resolveAutoSafetyMode("AUTO", { activeProduct: "C64U", ... })` yields `effectiveMode === "CONSERVATIVE"`.
2. `resolveAutoSafetyMode("AUTO", { activeProduct: "U64", ... })` yields `effectiveMode === "BALANCED"`, not provisional.
3. `resolveAutoSafetyMode("AUTO", { activeProduct: null, ... })` yields `effectiveMode === "BALANCED"`, **provisional**.
4. `resolveAutoSafetyMode("CONSERVATIVE", { activeProduct: "U64" })` yields `effectiveMode === "CONSERVATIVE"`, not provisional, reason `"explicit-user-choice"`.
5. `loadDeviceSafetyConfig()` returns the `CONSERVATIVE` preset values when stored mode is `AUTO` and the selected saved device's `lastKnownProduct` is `C64U`.
6. Switching the selected saved device from a `U64`-verified entry to a `C64U`-verified entry causes the next `loadDeviceSafetyConfig()` to return the `CONSERVATIVE` preset.

Integration (Vitest with mocked saved-devices store):

7. After `completeSavedDeviceVerification(..., { product: "C64U" })`, the `c64u-device-safety-updated` event fires and `deviceInteractionManager`'s in-process `config` switches to `CONSERVATIVE` values (specifically `ftpMaxConcurrency === 1`, `infoCacheMs === 1200`).

Real-device (Phase D soak):

8. Diagnostics trace contains exactly one `effective-preset = CONSERVATIVE` line per `u64 -> c64u` switch and one `effective-preset = BALANCED` line per `c64u -> u64` switch, in the order the switches occurred.
9. `c64u` REST `/v1/info` from the Pixel 4 remains reachable in < 1000 ms at the end of the soak (before any cooldown).

## Migration

- Existing installs: stored mode is unchanged. If a user has `BALANCED` saved, they keep `BALANCED`. They will only see `AUTO` if they pick it themselves.
- Fresh installs: `DEFAULT_DEVICE_SAFETY_MODE` is `AUTO`. The Settings page renders `Auto` as the selected option and shows the resolved preset line.
- Settings transfer JSON: a v(n) export carrying `BALANCED` imports as `BALANCED`. A v(n+1) export carrying `AUTO` imports as `AUTO` on a build that supports it. Older builds reject `AUTO` as an unknown mode unless they also add explicit support for it.

## Out of scope

- No change to `RELAXED`/`BALANCED`/`CONSERVATIVE`/`TROUBLESHOOTING` numeric values. If `CONSERVATIVE` proves insufficient to keep `c64u` healthy, tightening it is a follow-up - not part of this spec.
- No change to the user-override fields (FTP concurrency, info cache ms, etc.). They continue to override the resolved preset just like today.
