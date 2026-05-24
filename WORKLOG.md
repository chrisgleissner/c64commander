# Device Safety Regression Worklog

## Files Inspected

- `README.md`: project overview, Home page feature context, Android/web setup.
- `.github/copilot-instructions.md`: mandatory classification, bug-fix tests, validation, screenshot policy, coverage gate.
- `docs/ux-guidelines.md`: UI interaction constraints; no visible redesign planned.
- `package.json`: available lint, test, coverage, build, Android, and evidence commands.
- `src/pages/HomePage.tsx`: Home config controls, quick actions, FTP/Telnet config and REU workflows.
- `src/pages/home/components/LightingSummaryCard.tsx`: Home case light color and brightness slider workflow.
- `src/hooks/useDeviceBoundSlider.ts`: local slider intent, throttled preview, commit, polling pause, stale reconciliation.
- `src/hooks/useInteractiveConfigWrite.ts`: coalesced interactive config writes used by lighting sliders and SID slider paths.
- `src/lib/deviceInteraction/latestIntentWriteLane.ts`: latest-value-wins write lane.
- `src/lib/config/configWriteThrottle.ts`: serialized config write queue.
- `src/lib/deviceInteraction/deviceInteractionManager.ts`: REST/FTP/Telnet safety scheduler, cooldown, backoff, priority queues.
- `src/lib/c64api.ts`: REST transport, config writes, machine CTAs, drive writes, playback writes.
- `src/lib/ftp/ftpClient.ts`: FTP list/read/write wrapper.
- `src/lib/telnet/telnetClient.ts`, `src/lib/telnet/telnetSession.ts`, `src/hooks/useTelnetActions.ts`: Telnet transports and scheduled action path.
- `src/lib/config/applyConfigFileReference.ts`: config-file FTP/Telnet workflow.
- `src/hooks/useC64Connection.ts`: background info/config/drives polling and config mutation hooks.
- `src/lib/query/c64PollingGovernance.ts`: polling pause registry used by sliders.
- `src/lib/diagnostics/healthCheckEngine.ts`, `src/lib/connection/connectionManager.ts`: health/discovery probes and explicit bypass callers.
- Representative tests under `tests/unit/...` for c64api, config write throttle, device interaction scheduling, sliders, and config rows.

## Relevant Findings

- Change classification is `CODE_CHANGE`; no intentional visible UI change, so screenshot refresh is not expected.
- Home case light sliders are device-bound sliders in `LightingSummaryCard`. They update local UI immediately, throttle preview writes, and commit the final value.
- `useInteractiveConfigWrite` previously sent `immediate: true` for non-`C64U` product families. `C64API.updateConfigBatch` honored `immediate` by bypassing `scheduleConfigWrite`.
- Even when `scheduleConfigWrite` was used, it only used app-level `configWriteIntervalMs` default of 200 ms. It did not enforce `loadDeviceSafetyConfig().configsCooldownMs`, which is 1200 ms in conservative `C64U` AUTO mode.
- REST config mutation scheduling had a separate hardcoded `CONFIG_MUTATION_COOLDOWN_MS = 120` instead of Device Safety `configsCooldownMs`.
- `useDeviceBoundSlider` already protected the visual state from stale device echoes via pending intent, but it lacked diagnostic logs for local intent, coalescing, stale refresh ignored, and latest intent confirmed.
- Background reads waited for interactive write bursts only when intent was `background`. System health reads could continue during user write bursts; they now yield while user write activity is active.
- FTP list/read/write paths go through `withFtpInteraction`. Telnet paths in `useTelnetActions` went through `withTelnetInteraction`; Home config/REU helper sessions and config-reference helper sessions did not and were routed through the Telnet scheduler.

## Root Cause Evidence

- Root cause set:
  - Config writes did not consistently honor Device Safety settings. `scheduleConfigWrite` enforced only app `configWriteIntervalMs` (200 ms default), while conservative Device Safety `configsCooldownMs` is 1200 ms.
  - REST config mutation cooldown used a hardcoded 120 ms cooldown, bypassing Device Safety `configsCooldownMs`.
  - `updateConfigBatch({ ... }, { immediate: true })` bypassed `scheduleConfigWrite`; `useInteractiveConfigWrite` and other callers could therefore bypass the serialized config queue.
  - Home case light brightness/color sliders send throttled preview writes plus final commit writes. With the too-short/bypassable gates, rapid visual changes could produce unsafe config mutation traffic.
- Test evidence added:
  - `configWriteThrottle` proves conservative Device Safety config cooldown dominates app write interval.
  - `deviceInteractionManager.scheduling` proves REST config mutations are separated by Device Safety cooldown and system reads yield to active user write bursts.
  - `useDeviceBoundSlider` proves 20 rapid local changes stay visually local, produce fewer preview writes than local changes, keep the final value through a stale refresh, and log intent/coalescing/stale/confirmation events.
  - `useInteractiveConfigWrite` proves interactive writes route through serialized config writes with `immediate: false`.

## Device-Bound Call Audit

| Area                           | Files                                                                                                                    | Path                                                                                                                                                          | Safety/backoff status                                                                                                                                                                        | Priority/stale-state notes                                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Home case light brightness     | `LightingSummaryCard.tsx`, `useDeviceBoundSlider.ts`, `useInteractiveConfigWrite.ts`, `useC64Connection.ts`, `c64api.ts` | Slider local intent -> throttled preview/commit -> latest-intent lane -> `updateConfigBatch` -> `scheduleConfigWrite` -> REST scheduler -> `/v1/configs` POST | Fixed: no `immediate` bypass; config queue uses max(app interval, Device Safety `configsCooldownMs`); REST mutation cooldown uses Device Safety `configsCooldownMs`                          | Local slider value stays latched while pending; stale device value ignored; background/system reads yield to user write burst |
| Home case light color          | Same as brightness                                                                                                       | Color slider local intent -> same write lane and `/v1/configs` POST                                                                                           | Fixed via same shared slider/config write path                                                                                                                                               | Same latest-value and stale reconciliation behavior                                                                           |
| Home lighting selects/toggles  | `LightingSummaryCard.tsx`, `useConfigActions.ts`, `c64api.ts`                                                            | `updateConfigValue` -> `setConfigValue` -> `scheduleConfigWrite` -> REST scheduler                                                                            | Fixed by config queue and REST mutation cooldown changes                                                                                                                                     | Ordered serialization, no over-coalescing                                                                                     |
| Other Home config CTAs/toggles | `HomePage.tsx`, `AudioMixer.tsx`, `DriveManager.tsx`, `PrinterManager.tsx`, `UserInterfaceSummaryCard.tsx`               | `updateConfigValue` or C64API mutation helpers                                                                                                                | Config writes fixed via `scheduleConfigWrite`; machine/drive/playback writes pass through `C64API.request` and REST scheduler                                                                | User intent priority is scheduler order; background/system reads yield during user write bursts                               |
| Config page sliders            | `ConfigItemRow.tsx`, `useDeviceBoundSlider.ts`, `useC64SetConfig`                                                        | Slider hook -> `setConfigValue` -> `scheduleConfigWrite` -> REST scheduler                                                                                    | Fixed by shared slider logs and config queue safety                                                                                                                                          | Local pending intent prevents stale rollback                                                                                  |
| Play volume sliders            | `VolumeControls.tsx`, `useVolumeOverride.ts`                                                                             | Slider hook -> volume override writes -> `updateConfigBatch(... immediate: true)`                                                                             | Fixed at API layer: `immediate` is logged but still routed through Device Safety queue                                                                                                       | Existing polling pause tests plus API safety path                                                                             |
| Lighting Studio apply          | `useLightingStudio.tsx`                                                                                                  | `updateConfigBatch(... immediate: true)`                                                                                                                      | Fixed at API layer: `immediate` no longer bypasses queue                                                                                                                                     | UI state managed by studio; device writes are safe                                                                            |
| REST reads/polling             | `useC64Connection.ts`, `c64api.ts`, `deviceInteractionManager.ts`                                                        | Query hooks -> `getInfo/getCategory/getDrives` -> REST scheduler                                                                                              | Reads use cache/cooldown/backoff; background and system reads yield during user write bursts                                                                                                 | Stale slider state handled in slider hook; polling pause still cancels active drive polling                                   |
| FTP                            | `ftpClient.ts` and callers                                                                                               | `listFtpDirectory/readFtpFile/writeFtpFile` -> `withFtpInteraction`                                                                                           | Uses FTP scheduler, Device Safety FTP concurrency/cooldown/backoff                                                                                                                           | User/system/background intent supported by wrapper                                                                            |
| Telnet actions                 | `useTelnetActions.ts`, `HomePage.tsx`, `applyConfigFileReference.ts`                                                     | Telnet workflow -> `withTelnetInteraction`                                                                                                                    | Fixed Home/config-reference direct sessions to route through Telnet scheduler                                                                                                                | Serialized and backoff-protected                                                                                              |
| Diagnostics/discovery probes   | `healthCheckEngine.ts`, `connectionManager.ts`                                                                           | Some probes intentionally pass bypass flags for discovery/recovery                                                                                            | Remaining audited exception: these can bypass cache/cooldown/backoff/circuit for explicit discovery/diagnostic recovery, but system REST reads now yield while user write activity is active | Not used by Home slider writes; keep under follow-up risk if stricter diagnostics semantics are required                      |

## Code Changes Made

- Created `PLANS.md` and `WORKLOG.md`.
- `src/lib/config/configWriteThrottle.ts`: config write queue now waits for `max(loadConfigWriteIntervalMs(), loadDeviceSafetyConfig().configsCooldownMs)` and logs applied delay.
- `src/lib/deviceInteraction/deviceInteractionManager.ts`: REST config mutation cooldown now uses `config.configsCooldownMs`; system reads yield to active user write bursts; REST start/end/cooldown/backoff debug logs added.
- `src/lib/c64api.ts`: `updateConfigBatch(..., { immediate: true })` no longer bypasses `scheduleConfigWrite`; it logs that the immediate option was routed through the safety queue.
- `src/hooks/useInteractiveConfigWrite.ts`: interactive config writes always pass `immediate: false` and log queued/sent latest-intent events.
- `src/hooks/useDeviceBoundSlider.ts`: added stable debug names and logs for local intent, queued writes, coalesced writes, delayed preview, stale device value ignored, and latest intent confirmed.
- `src/pages/home/components/LightingSummaryCard.tsx`: provided debug names for color and brightness sliders.
- `src/pages/HomePage.tsx`: routed direct Home config/REU Telnet sessions through `withTelnetInteraction`.
- `src/lib/config/applyConfigFileReference.ts`: routed config-reference Telnet sessions through `withTelnetInteraction`.

## Tests Added or Modified

- `tests/unit/configWriteThrottle.test.ts`: added Device Safety cooldown regression and updated burst spacing expectations.
- `tests/unit/lib/deviceInteraction/deviceInteractionManager.scheduling.test.ts`: added REST config mutation cooldown and system-read-yields-to-user-write regressions.
- `tests/unit/hooks/useDeviceBoundSlider.test.ts`: added 20-change rapid slider/log/stale-refresh regression.
- `tests/unit/hooks/useInteractiveConfigWrite.test.ts`: updated expectations to serialized safe write path.

## Commands Run

- `pwd && rg --files ...`: located orientation and source files. Result: pass.
- `sed -n '1,240p' README.md`: inspected overview. Result: pass.
- `sed -n '1,260p' .github/copilot-instructions.md`: inspected mandatory workflow. Result: pass.
- `sed -n '1,220p' docs/ux-guidelines.md`: inspected UX guidance. Result: pass.
- `cat package.json`: inspected scripts. Result: pass.
- `rg ... device-bound calls`: audited REST/FTP/Telnet/ping/health/config/slider/CTA paths. Result: pass.
- `npx prettier --write ...`: formatted changed TS/TSX/MD files. Result: pass.
- `npx vitest run tests/unit/configWriteThrottle.test.ts tests/unit/hooks/useDeviceBoundSlider.test.ts tests/unit/hooks/useInteractiveConfigWrite.test.ts tests/unit/lib/deviceInteraction/deviceInteractionManager.scheduling.test.ts`: initial result failed one old burst-spacing assumption; after update result passed, 4 files / 40 tests.
- `npx vitest run tests/unit/c64api.test.ts tests/unit/c64api.branches.test.ts tests/unit/lib/c64api.test.ts tests/unit/config/deviceSafetySettings.test.ts tests/unit/components/ConfigItemRow.test.tsx tests/unit/components/ConfigItemRow.edgeCases.test.tsx`: passed, 6 files / 212 tests.

## Test Results

- Targeted safety/sliders/scheduler tests: passed, 40 tests.
- Adjacent C64 API/config-row tests: passed, 212 tests.
- Full lint/build/coverage and APK deployment still pending.

## Log Evidence

- Automated log assertions in `useDeviceBoundSlider.test.ts` prove:
  - 20 rapid local slider changes were recorded as local intent and the visible value followed the latest local value.
  - Preview writes were fewer than local changes.
  - Final commit value was queued.
  - Stale device value `0` was ignored while pending value `20` was latched.
  - Confirmation of latest intent `20` cleared pending state.
- Automated log assertion in `configWriteThrottle.test.ts` proves Device Safety config cooldown `1200` ms applied over app interval `100` ms.
- Scheduler tests prove config mutation outbound starts are spaced by Device Safety cooldown and system health reads wait until user write burst settles.

## Remaining Limitations

- Hardware reachability and Pixel 4 availability have not yet been checked.
- Diagnostic/discovery probes still contain explicit bypass flags for recovery/discovery semantics. They now yield to active user write bursts, but a stricter no-bypass diagnostics policy would require a follow-up design decision because those probes are also used to recover from unknown/error states.
