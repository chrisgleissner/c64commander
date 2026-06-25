# S4-UNHANDLED-ABORTERROR-ON-OVERLAY-DISMISS — AbortError escapes as an unhandledrejection when an overlay is dismissed mid-fetch

- ID: `S4-UNHANDLED-ABORTERROR-ON-OVERLAY-DISMISS`
- Severity: **S4** (minor / code-quality) · Priority: P3
- Product area: global request lifecycle (AbortController on overlay close / route change)
- Build: `0.8.9-b8687` (fixed, SHA `2ffb1645…`) · Git base `b86877f43589` · Pixel 4 `9B081FFAZ001WX` · target c64u
- First observed UTC: 2026-06-25T~17:2xZ

## Symptom

When an overlay that has in-flight device requests is dismissed (observed: `*`→Diagnostics→Back, and `#`→Device Switcher→Back), the app aborts the pending fetch(es), and the resulting `AbortError` surfaces as a **global `unhandledrejection`** rather than being caught/swallowed:

```
unhandledrejection: AbortError: signal is aborted without reason
    at vh (assets/index-*.js)
    at async Object.f [as run] (...)
```

Captured 2× during the keypad shortcut sweep (collector `window.__qaErrors`), both with `href=/docs` (the route the overlays were opened from). Zero such rejections occurred during plain tab-to-tab navigation across all 6 routes.

## Impact

Benign to the user (no crash, no visible error, the abort is intentional). But an escaped `unhandledrejection` is real noise: it can spam production error tracking, can trip a global error overlay in some configs, and can mask a genuinely unhandled rejection. The app already has an idle/superseded-abort path (`throwIfSuperseded` → `createAbortError` in `src/lib/c64api.ts`) and treats caller-cancelled aborts as expected at the request layer — the gap is a caller (Diagnostics data load and/or the Device Switcher dual-device health probe) that doesn't `.catch()` the abort when the component unmounts.

## Reproduction

1. Connect to c64u (healthy). On any route, press `*` to open Diagnostics (fires the diagnostics/health data load).
2. Immediately press Back to dismiss before the load settles.
3. Repeat with `#` (Device Switcher — it probes both saved devices' health).
4. Read `window.__qaErrors` via CDP → contains `unhandledrejection: AbortError`.

## Suspected component

Diagnostics overlay data loader and/or `useSavedDeviceHealthChecks` (Device Switcher dual-probe) — an awaited fetch whose AbortController fires on unmount, with no `.catch(isAbort)` swallow at that call site.

## Evidence

- `screenshots/sweep-diagnostics-star.png`, `screenshots/sweep-device-switcher.png`
- CDP collector dump (this report's stack trace).

## Recommended fix (not applied — QA finding)

At the Diagnostics/Device-Switcher fetch call sites, catch and ignore AbortError on unmount (the request layer already classifies these as expected; the leak is a missing `.catch` at the consuming hook). Alternatively add a global `unhandledrejection` listener that swallows `AbortError`.
