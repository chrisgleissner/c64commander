# Agentic Android Runtime Contract

## Purpose

This file captures the Android-specific runtime behavior that autonomous testing must respect today.

Current execution scope:

- Physical autonomous execution is Android-only.
- The controller contract remains generic so a future iOS controller can implement the same role.

## Connection State Machine

Source of truth:

- `src/lib/connection/connectionManager.ts`

States:

| State | Meaning | Common entry paths | Common exit paths |
| --- | --- | --- | --- |
| `UNKNOWN` | Manager initialized, discovery not yet resolved | app init | startup/manual/settings discovery |
| `DISCOVERING` | Active startup, manual, or settings probe cycle | startup, manual, settings | `REAL_CONNECTED`, `DEMO_ACTIVE`, `OFFLINE_NO_DEMO` |
| `REAL_CONNECTED` | Real device is active and demo server is stopped | successful probe, smoke mock override | manual/settings rediscovery, device loss not yet modeled as explicit state |
| `DEMO_ACTIVE` | Demo mode is active and runtime URL points at demo or fallback target | failed probe with auto demo enabled, fuzz mode | background rediscovery to real, manual/settings rediscovery |
| `OFFLINE_NO_DEMO` | No real device and demo disabled or blocked | failed probe with demo disabled, sticky real-device lock blocking demo | manual/settings rediscovery |

Runtime rules:

- Manual discovery forces a bounded one-shot probe.
- Background rediscovery only runs from `DEMO_ACTIVE` or `OFFLINE_NO_DEMO`.
- Successful transition to a real device stops the demo server and can enable sticky real-device lock.
- Sticky real-device lock prevents automatic fallback back into demo mode during the same session.

## Demo Interstitial Contract

- The interstitial is shown only for non-background transitions into demo mode.
- It is intended to appear once per session.
- Dismissing it does not change the underlying connection state by itself.

## Android Background Playback Contract

Source of truth:

- `src/pages/PlayFilesPage.tsx`
- `src/lib/native/backgroundExecution.ts`
- `src/lib/native/backgroundExecutionManager.ts`

Behavior:

- When playback is active and not paused, the page starts background execution once and sets `dueAtMs` for auto-advance.
- When playback stops, pauses, or the page cleans up, background execution is stopped and `dueAtMs` is cleared.
- On Android, `backgroundAutoSkipDue` feeds back into playback timeline reconciliation.
- If background execution start fails, foreground playback may continue, but background auto-advance is no longer guaranteed.

Testing implication:

- A passing Android background case needs runtime evidence that the background path was armed, not just that the playlist later advanced.

## Android-Native File And Plugin Constraints

- Local file access can be plain entry-based or SAF-tree-based. Cases must know which mode they are exercising.
- FTP browsing depends on the native FTP plugin behavior, not just web mocks.
- Diagnostics export and settings transfer can hit Android file-picker or share-sheet behavior that web tests do not cover.
- Mock-server, diagnostics-bridge, folder-picker, secure-storage, HVSC ingestion, and background-execution behavior already have JVM tests that should be reused as contract evidence.

## Product Failure Vs Lab Failure

| Class | Meaning | Examples |
| --- | --- | --- |
| Product failure | The app or device behavior is wrong under a healthy lab | wrong discovery transition, wrong playlist state, mount failure with healthy runtime |
| Lab/runtime failure | Android runtime, plugin, filesystem, or capture infrastructure is unhealthy | SAF permission loss, background plugin failure, logcat/plugin crash, capture loss |
| Inconclusive | Evidence cannot separate product from lab | app says play started, plugin logs fail, and A/V never changes |

## What Must Be Recorded

For Android physical runs, always capture:

- connection state before and after major rediscovery actions
- whether the app is in real or demo mode
- whether background execution was armed for playback cases
- any plugin or logcat warnings tied to SAF, FTP, diagnostics, or background execution
