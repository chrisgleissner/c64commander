# Agentic Oracle Catalog

## Purpose

This file defines which evidence is strong enough to prove outcomes across the real feature surface.

## Oracle Classes

| Oracle class | Typical source | Good for | Limits |
| --- | --- | --- | --- |
| UI | Visible labels, button state, dialogs, row contents | Read-only surfaces, immediate app feedback | Weak alone for hardware mutations |
| REST-visible state | `c64api`-visible config, drive, or info state | Config, drive, and machine state round-trips | Cannot prove physical A/V output by itself |
| FTP-visible state | C64U storage listings and file reads | Disk and media staging, C64U file presence | Not enough for playback success alone |
| Filesystem-visible state | Android app files, SAF reads, diagnostics ZIP, exported settings | RAM dumps, exports, imports, HVSC artifacts | Android-runtime-dependent |
| Diagnostics and logs | app logs, traces, action summaries, logcat | Async workflows, failure attribution, background/runtime issues | Must be correlated with the triggering action |
| State refs | RAM reads, device info snapshots, mounted-state snapshots | Direct C64 state corroboration | Reserved for gap-filling, not primary control |
| A/V signal | `c64scope` capture and assertions | Playback start, progression, screen/audio signatures | Not required for many non-playback features |

## General Rules

- Use at least two independent signals for destructive or hardware-coupled actions.
- Use A/V as the primary oracle only when the user-visible requirement is genuinely audiovisual.
- When a UI toast is the only positive signal, treat the result as unproven unless another state source changes as expected.
- Prefer repository-owned diagnostics over ad hoc screenshots when the outcome is asynchronous.

## Feature-Oriented Oracle Policy

### Connection And Demo Mode

Primary:

- Connectivity indicator and interstitial state.
- Connection snapshot state and discovery logs.

Fallback:

- Successful or failed `/v1/info`-style reachability evidence.

Weak or forbidden:

- Indicator color alone.

### Machine Control And RAM

Primary:

- UI action confirmation plus REST/state-ref change.
- Diagnostics/log entries for the issued machine action.

Fallback:

- Post-action route refresh and explicit recovery state.

Weak or forbidden:

- Toast text alone.
- Direct `c64bridge` write or reset as proof that the app path succeeded.

### Playback And Mixed-Format Progression

Primary:

- Play-page transport state plus `c64scope` video/audio assertions.

Fallback:

- Playlist/current-item state plus logs plus RAM/state ref when the case allows it.

Weak or forbidden:

- A single screenshot of the Play page.
- A/V without a recorded app action timeline.

### Android Background Playback And Lock Behavior

Primary:

- Play-page state plus Android background-execution logs or events plus timeline reconciliation evidence.

Fallback:

- `backgroundAutoSkipDue` event evidence plus updated current-item state.

Weak or forbidden:

- Assuming background worked because foreground playback resumes later.

### HVSC Download, Install, Ingest, Cancel, Reset

Primary:

- HVSC status UI plus incremental progress plus filesystem or ingestion-stat evidence.

Fallback:

- Diagnostics/log evidence with final ready or failed status.

Weak or forbidden:

- Presence of the HVSC section alone.

### Disk Library, Mount/Eject, Drive Config, Soft IEC

Primary:

- Library UI plus REST-visible drive or mount state.

Fallback:

- FTP-visible file presence and drive-status text when the mount state is otherwise visible.

Weak or forbidden:

- Delete confirmation dialog alone.

### Config Category Edits, Clock Sync, Audio Mixer

Primary:

- Live config value round-trip through the UI and REST-visible state.

Fallback:

- Diagnostics/log confirmation for batch writes or resets.

Weak or forbidden:

- "Request succeeded" without reading the resulting value back.

### Settings Persistence, Diagnostics Export, Settings Import/Export

Primary:

- UI state plus persisted local setting or exported file evidence.

Fallback:

- Diagnostics bundle contents or trace/log evidence.

Weak or forbidden:

- Share-sheet open alone as proof that export completed.

### Docs And Licenses

Primary:

- UI content rendering.

Fallback:

- Error-log absence when loading bundled notices.

## Weak Or Forbidden Oracle Patterns

- Single-toast success.
- Single screenshot without state correlation.
- A/V-only proof for settings, config, disk-library, or diagnostics workflows.
- Log lines without matching route/action/timestamp context.
- Direct `c64bridge` media start as proof of app playback behavior.
- Absence of a crash as proof of success.
