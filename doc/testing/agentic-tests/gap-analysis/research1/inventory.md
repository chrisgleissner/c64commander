# Inventory

## Tool And Policy Inventory

### Summary

| Surface | Repository evidence | Role in intended design | What it actually enables today | Bias |
| --- | --- | --- | --- | --- |
| `droidmind` | `.vscode/mcp.json` configures it as MCP server; `droidmind/` gitignored symlink; docs reference throughout | drive the app via MCP | available to IDE LLM sessions but NOT wired into `c64scope` validation pipeline; validation uses direct ADB instead | app-driven when used via MCP, but validation code bypasses it |
| `mobile-mcp` | `.vscode/mcp.json` configures `@mobilenext/mobile-mcp` | alternative mobile controller | not referenced by validation pipeline or docs | app-driven in theory, unused |
| `c64bridge` | `c64bridge/**`, README, prompts, AGENTS, tool registry | narrow gap-fill only | direct program execution, memory, config, drive, disk, stream, sound, system control | strongly direct-device |
| `c64scope` MCP | `c64scope/src/server.ts`, tools/modules | session, capture, assertions, artifacts | session/capture/assert/catalog tooling | neutral-to-observability |
| `c64scope` validation runners | `c64scope/src/validation/**`, `autonomousValidation.ts`, `hardwareValidation.ts` | not clearly separated in docs | scripted direct hardware validation using ADB/curl/FTP/readmem/run_prg | strongly bypass-prone |
| Agentic prompt | `.github/prompts/agentic-test.prompt.md` | app-first orchestration prompt | prose guidance only | app-first in prose |
| Case catalog | `c64scope/src/catalog/cases.ts` | app-aligned journey metadata | metadata only; not current executable path | app-first in metadata |
| Validation case set | `c64scope/src/validation/cases/index.ts` | current executable runner inputs | thin direct-control case suite | bypass-prone |
| App diagnostics | `src/lib/diagnostics/**`, Settings diagnostics UI | app-native observability | logs, traces, actions, ZIP export | app-driven |
| Playwright | `playwright/**` | reusable expected flow prior art | broad web-flow semantics and selectors | app-driven prior art |
| Maestro | `.maestro/**` | native-flow prior art | Android/iOS flow order, lock screen, HVSC, playlist, file-picker flows | app-driven prior art |

## Prompt And Policy Contracts

### App-first policy sources

- `doc/testing/agentic-tests/agentic-test-architecture.md`
- `doc/testing/agentic-tests/c64scope-spec.md`
- `.github/prompts/agentic-test.prompt.md`
- `doc/testing/agentic-tests/agentic-safety-policy.md`
- `doc/testing/agentic-tests/agentic-controller-contract.md`

These documents consistently say:

- C64 Commander is the product under test.
- Use the app for normal playback, queue, disk, and settings behavior.
- Use `c64bridge` only for narrow gap-fill or recovery.

### Direct-control-bias sources

- `c64bridge/README.md`
- `c64bridge/AGENTS.md`
- `c64bridge/src/prompts/registry.ts`
- `c64scope/src/validation/cases/playback.ts`
- `c64scope/src/validation/cases/storage.ts`
- `c64scope/src/validation/runner.ts`

Observed bias:

- direct examples for running code on the C64
- direct program upload and execution
- direct memory verification
- direct drive/config/FTP operations
- hardcoded “peer server” and “LLM decision trace” narratives inside a scripted runner

## MCP Server Configuration

### Fact

`.vscode/mcp.json` configures four MCP servers:

| Server | Command | Status in validation pipeline |
| --- | --- | --- |
| `droidmind` | `uvx --from git+https://github.com/hyperb1iss/droidmind droidmind --transport stdio` | available to IDE sessions; NOT used by scripted validation |
| `c64bridge` | `npx -y c64bridge@latest` | available to IDE sessions; validation cases call REST/FTP endpoints that are proxied through this server's underlying API |
| `c64scope` | `npx -y tsx ${workspaceFolder}/c64scope/src/index.ts` | available to IDE sessions; scripted validation uses `c64scope` session store directly |
| `mobile-mcp` | `npx -y @mobilenext/mobile-mcp@latest` | available to IDE sessions; NOT referenced by validation pipeline or docs |

Implication:

- IDE-based LLM sessions (Copilot, Cursor) have access to all four MCP servers including `droidmind` for app UI interaction.
- The scripted `c64scope` validation pipeline (`autonomousValidation.ts`, `hardwareValidation.ts`) bypasses MCP entirely and uses direct ADB, REST, and FTP calls.
- This means there are two distinct execution contexts: (a) LLM-orchestrated sessions with full MCP access, and (b) scripted validation runs with no MCP integration.

## `c64bridge` Inventory

### Fact

`c64bridge` is the most mature and ergonomic control surface in the repo.

Evidence:

- `c64bridge/src/tools/registry/index.ts` registers modules for program, memory, sound, system, graphics, RAG, disk, drive, printer, config, extract, and stream.
- `c64bridge/README.md` advertises 12 tools, 25 resources, and 7 prompts.
- `c64bridge/README.md` explicitly recommends the “C64 agent” for playback, drives, streaming, and device control.

### Relevant capabilities that bias toward bypass

| Capability | Why attractive to an LLM | Why harmful for app validation |
| --- | --- | --- |
| `c64_program` | starts execution deterministically in one call | skips app playlist/playback path |
| `c64_memory` | immediate low-level oracle | proves hardware state, not app control path |
| `c64_disk` / `c64_drive` | direct mount/config control | skips disk-library UX and persistence |
| `c64_config` | direct read/write round-trip | skips Config and Settings UI |
| `c64_stream` | one-call stream control | encourages stream setup outside the app |
| `c64_system` | fast reset/reboot/power | encourages hardware-first recovery over app attribution |

## `c64scope` Inventory

### MCP surfaces

Implemented tool groups:

- `scope_session`
- `scope_lab`
- `scope_capture`
- `scope_assert`
- `scope_artifact`
- `scope_catalog`

Implemented resources:

- case catalog
- assertion catalog
- playbook references
- artifact bundle schema
- failure taxonomy

Implemented prompt:

- `agentic_physical_case`

### Implementation mismatch inside `c64scope`

Fact:

- `c64scope` also contains a second system:
  - `autonomousValidation.ts`
  - `hardwareValidation.ts`
  - `validation/cases/**`
  - `validation/runner.ts`
- That second system is not just session/capture tooling. It performs direct device and hardware actions itself.

Implication:

- `c64scope` is currently both an observability server and a bypass-friendly executor.

## C64 Commander App Testability Inventory

### Stable selectors and inspectable state

Fact:

- The app exposes many stable selectors and labels, including:
  - Play transport and playlist controls
  - HVSC controls and progress widgets
  - Settings diagnostics controls
  - Config category/item selectors
  - Home quick-config, drive, LED, SID, RAM, and stream selectors

Examples:

- `src/pages/playFiles/components/PlaybackControlsCard.tsx`
- `src/pages/playFiles/components/PlaylistPanel.tsx`
- `src/pages/playFiles/components/HvscControls.tsx`
- `src/pages/SettingsPage.tsx`
- `src/pages/ConfigBrowserPage.tsx`
- `src/pages/HomePage.tsx`

### Native and app observability already present

- action traces and user tracing
- diagnostics logs, traces, and action summaries
- diagnostics export/share logic
- playback trace snapshots
- background-execution start/stop and due-at logging
- HVSC progress listener and cached-status reporting
- playlist persistence keyed by device
- disk library persistence keyed by device

## Reusable Prior Art Inventory

### App selectors available for the 7 required deep-dive flows

| Flow | Key selectors | Source |
| --- | --- | --- |
| Disk list creation | `[data-testid="disk-list"]`, `[data-testid="disk-row"]`, `[data-testid="disk-row-header"]`, `[data-testid="add-disks-overlay"]`, `[data-testid="source-entry-row"]`, `button[aria-label="Disk actions"]`, `button[aria-label="Mount <name>"]` | `HomeDiskManager.tsx`, `DiskTree.tsx` |
| Playlist creation | `[data-testid="add-items-to-playlist"]`, `[data-testid="playlist-list"]`, `[data-testid="playlist-item"]`, `[data-testid="playlist-type-{category}"]`, `button[aria-label="Clear playlist"]`, `[data-testid="add-items-confirm"]` | `PlaylistPanel.tsx`, `ItemSelectionDialog.tsx` |
| Autoplay locked screen | `backgroundAutoSkipDue` event, `autoAdvanceDueAtMs` state, `cancelAutoAdvance()` callback | `backgroundExecution.ts`, `PlayFilesPage.tsx` |
| HVSC download | `getHvscStatus()`, `getHvscCacheStatus()`, `installOrUpdateHvsc()`, `addHvscProgressListener()`, `HvscManager.tsx` UI | `hvscService.ts`, `hvscDownload.ts` |
| Cache reuse | `getHvscCacheStatus()` → `{ baselineVersion, updateVersions }`, `ingestCachedHvsc()`, `resolveCachedArchive()` | `hvscService.ts`, `hvscDownload.ts` |
| Playlist from HVSC | `[data-testid="import-option-hvsc"]`, `[data-testid="source-entry-row"]`, `[data-testid="add-items-filter"]`, `[data-testid="add-items-selection-count"]`, `[data-testid="add-items-confirm"]` | `ItemSelectionDialog.tsx` |
| End-to-end playback | `[data-testid="playlist-play"]`, `[data-testid="playlist-pause"]`, `[data-testid="playback-elapsed"]`, `[data-testid="playback-remaining"]`, `[data-testid="playback-current-track"]`, `[data-testid="playback-counters"]`, `[data-testid="volume-mute"]` | `PlaybackControlsCard.tsx`, `VolumeControls.tsx` |

### Maestro flows relevant to the required deep dives

| Flow | Reuse value |
| --- | --- |
| `.maestro/edge-playlist-manipulation.yaml` | native add-items, start playback, clear playlist |
| `.maestro/edge-auto-advance-lock.yaml` | lock-screen next-track progression |
| `.maestro/edge-hvsc-ingest-lifecycle.yaml` | HVSC install/ingest stage sequence |
| `.maestro/smoke-background-execution.yaml` | lock/unlock and background JS continuity |
| `.maestro/smoke-hvsc.yaml` / `smoke-hvsc-mounted.yaml` | HVSC browse/import/play seeds |

### Playwright suites relevant to the required deep dives

| Suite | Reuse value |
| --- | --- |
| `playwright/playlistControls.spec.ts` | playlist filters, order, duration, transport |
| `playwright/itemSelection.spec.ts` | add-items flows from local/C64U/HVSC surfaces |
| `playwright/hvsc.spec.ts` | HVSC download, ingest, cache, browse, play |
| `playwright/diskManagement.spec.ts` | disk view-all, rename, remove, mount, collection management |
| `playwright/settingsDiagnostics.spec.ts` | diagnostics UI semantics |

## Key Inventory Findings

1. The repo already contains most of the app-level knowledge needed for deep app-driven testing.
2. The missing piece is not feature discovery. It is executable controller orchestration that actually uses the app.
3. The implemented executable surfaces over-reward direct hardware access and under-provide app-driving infrastructure.

