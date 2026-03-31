# Playback Configuration System

## 1. Problem Statement

The C64 Ultimate device requires specific hardware configuration for different programs and songs to play correctly. Examples include SID socket assignments, drive type selection (1541/1571/1581), cartridge settings, audio mixer levels, and machine timing (PAL/NTSC). Today, users must manually configure these settings before each playback session, or rely on a narrow automatic mechanism that matches `.cfg` files to playable files by identical base name in the same directory.

### Current state

C64 Commander already has a foundation for per-item configuration:

1. **Sibling name matching**: When files are added to a playlist, the system looks for a `.cfg` file with the same base name in the same directory (e.g. `game.prg` matches `game.cfg`). This match is stored as a `ConfigFileReference` on the `PlaylistItem`.

2. **Pre-playback application**: In `usePlaybackController.playItem()`, if the current item has a `configRef`, the system applies it via the config workflow (FTP upload to `/Temp` + Telnet "Load Settings" navigation) before executing the play plan.

3. **Manual attachment**: Users can manually browse and select a `.cfg` file from local storage or C64U filesystem to attach to playlist items.

### Problems with the current approach

- **Discovery is too narrow**: Only exact base-name matches in the same directory are found. A config file named `PAL_setup.cfg` or placed in a parent directory is invisible.
- **No transparency**: Users cannot see what configuration will be applied, what it contains, or why it was selected.
- **No editing**: Users cannot inspect or modify individual configuration values within the app before applying them.
- **No disambiguation**: When multiple potential configs exist, the system silently picks the first match or misses them entirely.
- **Inconsistent coverage**: The disk page has no config attachment at all. Config discovery only runs during playlist import, not for C64U-resident files browsed later.
- **No diff visibility**: Users cannot see what a config file will change relative to the device's current state.
- **Silent application**: Config is applied without confirmation or feedback during playback transitions.

---

## 2. Requirements

### Explicit requirements (from task specification)

| ID  | Requirement                                                                               |
| --- | ----------------------------------------------------------------------------------------- |
| R1  | Discover relevant configuration files for playable items                    |
| R2  | Apply configuration only immediately before playback, never during unrelated operations   |
| R3  | Provide full transparency into which configuration was selected, why, and what it changes |
| R4  | Allow manual override that always takes precedence over automatic behavior                |
| R5  | Allow users to inspect and edit configuration values within the app                       |
| R6  | Work consistently across playlists, disk collections, and multi-disk scenarios            |
| R7  | Support multiple drives (8, 9, SDIEC)                                                     |
| R8  | Support all playable file types: SID, PRG, CRT, D64, D71, D81, MOD                        |

### Inferred requirements (from codebase analysis and UX guidelines)

| ID  | Requirement                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------- |
| R9  | Config discovery must work for both local and C64U sources                                                |
| R10 | Config references must survive playlist persistence and restoration                                       |
| R11 | Config application must integrate with the existing machine transition coordinator                        |
| R12 | Config application must not block or interfere with volume/mute management                                |
| R13 | The system must log all config operations through the existing diagnostics framework                      |
| R14 | Config UI must follow the existing interstitial model (modals for decisions, bottom sheets for workflows) |
| R15 | Config indicators must not violate the health badge visibility contract                                   |
| R16 | The system must degrade gracefully when a referenced config file becomes unavailable                      |
| R17 | Manual config selection must use the existing source browser pattern (Local, C64U)                        |

---

## 3. Constraints and Non-Goals

### Constraints

- **No strict naming conventions**: Config files may have any name. The system must not require `game.cfg` to match `game.prg`.
- **No fragile heuristics**: Content-based guessing (e.g. parsing `.cfg` contents to infer which program it belongs to) is unreliable and forbidden as a primary mechanism.
- **No implicit state changes**: Mounting, browsing, or navigating must never trigger configuration application.
- **Manual always wins**: Any user-specified config overrides all automatic behavior, with no exceptions.
- **Deterministic behavior**: Given the same inputs, the system must always produce the same configuration decision.
- **Existing API surface**: The C64U firmware exposes `.cfg` file loading via Telnet menu navigation and individual config items via REST. The system must work within these two mechanisms.

### Non-goals

- **Config file authoring from scratch**: The system does not need to create new `.cfg` files. It discovers, selects, previews, edits, and applies existing ones.
- **Automatic config generation from program analysis**: Analyzing PRG/SID binary headers to infer required configuration is out of scope.
- **Cloud-based config database**: A shared online repository of per-game configurations is out of scope.
- **Real-time config monitoring**: Continuously polling device state to detect out-of-band changes is out of scope.
- **Config file format conversion**: Supporting non-C64U config formats is out of scope.

---

## 4. Design Principles

### P1: Explicit over implicit

Every configuration decision must be traceable. If the system selects a config automatically, the user must be able to see exactly which file was chosen and why. If no config is selected, that absence is also visible.

### P2: Playback is the only trigger

Configuration is applied at exactly one point: immediately before playback execution. No other user action (browsing, mounting, importing, reordering) causes config application.

### P3: User intent is sovereign

Manual selections, manual edits, and manual "no config" decisions always override automatic behavior. The system never silently replaces a user's explicit choice.

### P4: Transparency before action

Before any config is applied, the user can see what will change. The system provides a clear before/after view of affected settings.

### P5: Safe defaults

If no config is found or attached, the system does nothing to the device configuration. The absence of a config file means "use whatever the device is currently configured as." This is the safest default.

### P6: Graceful degradation

If a previously attached config becomes unavailable (file deleted, source unmounted), the system warns the user at playback time rather than silently skipping or failing.

### P7: Consistency across surfaces

The Play page, Disks page, and any future playback surface must use the same config discovery, resolution, and application pipeline.

---

## 5. System Model

### 5.1 Configuration Discovery Model

Discovery answers: "Which config files could be relevant to this playable item?"

#### Discovery strategies (ordered by specificity)

**Strategy 1: Exact name match (current behavior, preserved)**

For a file `foo.prg`, look for `foo.cfg` in the same directory.

- Specificity: highest
- Confidence: high
- Scope: same directory only

**Strategy 2: Directory-level config**

Look for any `.cfg` file in the same directory as the playable file. If exactly one `.cfg` file exists alongside multiple playable files, it is a candidate for all of them.

- Specificity: medium
- Confidence: medium (requires disambiguation if multiple `.cfg` files exist)
- Scope: same directory

**Strategy 3: Parent directory config**

Walk up the directory tree (up to the source root) looking for `.cfg` files. A config at a parent level is a broad-scope config intended for all items beneath it.

- Specificity: low
- Confidence: low (broad scope, may not be relevant)
- Scope: ancestor directories up to source root

#### Discovery results

Discovery produces a **candidate list**, not a final selection. Each candidate includes:

```
ConfigCandidate {
  ref: ConfigFileReference       // existing type: local or ultimate
  strategy: "exact-name" | "directory" | "parent-directory"
  distance: number               // 0 = same dir, 1 = parent, 2 = grandparent, etc.
  confidence: "high" | "medium" | "low"
}
```

#### Discovery timing

Discovery runs at two points:

1. **Import time**: When files are added to a playlist or disk collection (current behavior, extended).
2. **On-demand**: When the user explicitly requests config discovery for an existing playlist item.

Discovery does **not** run during playback. The playback path uses only the already-resolved config reference stored on the item.

#### Ambiguity handling

When discovery finds multiple candidates:

- If exactly one candidate has `strategy: "exact-name"`, it is auto-selected.
- If no exact-name match exists but exactly one `.cfg` file is in the same directory, it is auto-selected with `confidence: "medium"`.
- In all other cases (multiple same-directory configs, only parent-directory configs), **no automatic selection occurs**. The candidates are stored but the item's `configRef` remains `null`. The user sees an indicator that config candidates were found and can manually choose.

This prevents misapplication: the system never guesses when the answer is ambiguous.

### 5.2 Configuration Resolution Model

Resolution answers: "Which single config (if any) will be applied for this item?"

#### Resolution precedence (highest to lowest)

| Priority | Source                 | Description                                                      |
| -------- | ---------------------- | ---------------------------------------------------------------- |
| 1        | Manual override        | User explicitly selected or edited a config for this item        |
| 2        | Manual "none"          | User explicitly chose "No config" for this item                  |
| 3        | Auto high-confidence   | Exact-name match discovered automatically                        |
| 4        | Auto medium-confidence | Single directory-level match discovered automatically            |
| 5        | No config              | No match found or only ambiguous/low-confidence candidates exist |

#### Resolution state per item

Each playlist item (or disk collection entry) carries:

```
ConfigResolution {
  // The resolved config to apply (null = no config)
  resolved: ConfigFileReference | null

  // How the resolution was determined
  origin: "manual" | "manual-none" | "auto-exact" | "auto-directory" | "none"

  // All discovered candidates (for user review)
  candidates: ConfigCandidate[]

  // User edits applied on top of the resolved config (section 7)
  overrides: ConfigValueOverride[] | null
}
```

#### Resolution is stable

Once a resolution is computed (at import time or via manual selection), it does not change unless:

- The user explicitly changes it.
- The user re-runs discovery (e.g. after adding new config files to the source).

The system never silently re-resolves. This prevents surprises during playlist playback.

### 5.3 State Model

#### Configuration states

A playlist item's configuration exists in one of these states:

```
[No Config] ──discovery──> [Candidates Found] ──auto/manual──> [Config Resolved]
                                    │                                   │
                                    │                                   ├──edit──> [Config Edited]
                                    │                                   │
                                    └──manual "none"──> [Config Declined]
```

| State            | Meaning                                                            | Visual indicator                  |
| ---------------- | ------------------------------------------------------------------ | --------------------------------- |
| No Config        | No `.cfg` file found or associated                                 | No indicator                      |
| Candidates Found | Discovery found candidates but none were auto-selected (ambiguous) | Amber dot or "?" icon             |
| Config Resolved  | A config file is attached and will be applied before playback      | Config icon (filled)              |
| Config Edited    | A config is attached and the user has made value-level edits       | Config icon (filled) + edit badge |
| Config Declined  | User explicitly chose "no config" for this item                    | Config icon (struck through)      |

#### State transitions during playback

When playback starts for an item:

1. **Check config state**: Read `configResolution` from the item.
2. **If no config or declined**: Skip config application. Proceed to play plan.
3. **If config resolved or edited**:
   a. Validate that the config file is still accessible.
   b. If inaccessible: warn user, offer to proceed without config or cancel.
   c. If accessible: apply the config (with any overrides).
   d. Log the application through diagnostics.
4. **Execute play plan**: Existing playback router runs as today.

#### State persistence

Config resolution state is persisted as part of the playlist/collection persistence model. The existing `configRef` field on `PlaylistItem` and `StoredPlaylistState` is extended:

- `configRef`: the resolved `ConfigFileReference` (already exists)
- `configOrigin`: how it was resolved (`"manual" | "manual-none" | "auto-exact" | "auto-directory" | "none"`)
- `configOverrides`: any user edits (new field, nullable)
- `configCandidates`: stored for later review (new field, nullable, not persisted to storage to avoid bloat)

---

## 6. UX Interaction Model

### 6.1 Config indicator on playlist items

Every playlist item row shows a small config status indicator:

| State                    | Indicator                  | Tap action                   |
| ------------------------ | -------------------------- | ---------------------------- |
| No Config                | (none)                     | Opens config attachment flow |
| Candidates Found         | Small amber "?" badge      | Opens candidate chooser      |
| Config Resolved (auto)   | Small config icon          | Opens config detail sheet    |
| Config Resolved (manual) | Small config icon + pin    | Opens config detail sheet    |
| Config Edited            | Small config icon + pencil | Opens config detail sheet    |
| Config Declined          | Small config icon, struck  | Opens config attachment flow |

The indicator is placed in the item's action area, consistent with the existing source icon placement.

### 6.2 Config detail sheet (bottom sheet)

Opened by tapping the config indicator on a resolved item. Shows:

**Header row**: Config file name, source icon (Local/C64U), resolution origin label.

**Summary section**: Key configuration values that differ from the device's current state (diff view). Limited to the most impactful categories:

- C64 and Cartridge Settings
- SID Sockets Configuration
- Drive A / Drive B Settings
- Audio Mixer

**Actions**:

- **Change config**: Opens the source browser to select a different `.cfg` file.
- **Edit values**: Opens the config editor (section 7).
- **Remove config**: Detaches the config (sets state to "Config Declined").
- **Re-discover**: Re-runs discovery for this item.

This is a bottom sheet (workflow surface) per the interstitial model, because it involves exploration and stateful interaction.

### 6.3 Candidate chooser (bottom sheet)

Opened when candidates are found but none auto-selected. Shows:

- List of discovered `.cfg` candidates with:
  - File name
  - Discovery strategy label ("Same name", "Same folder", "Parent folder")
  - File size and modification date
- **Select** button per candidate
- **Browse for other** action to open the source browser
- **No config** action to explicitly decline

### 6.4 Pre-playback config notification

When playback starts and a config will be applied, a brief non-blocking notification appears:

> "Applying config: `game-pal.cfg`"

This notification uses the existing toast/notification system. It is informational only and does not block playback. The notification respects the user's notification visibility setting.

For the first playback in a session where config is applied, or when the config changes between tracks, the notification includes the key diff:

> "Applying config: `game-pal.cfg` (changes: C64 Mode, SID Socket 1)"

### 6.5 Config attachment during import

The existing import flow (addFileSelections) already runs discovery. The extended behavior:

1. Discovery runs as files are scanned.
2. High-confidence matches are auto-attached (as today).
3. Medium-confidence matches are stored as candidates.
4. After import completes, if any items have unresolved candidates, a summary toast appears:

> "3 items have config suggestions. Tap to review."

The user can review and resolve these at their leisure. No action is required; unresolved items simply play without config.

### 6.6 Disk collection config

Disk collection entries on the Disks page gain the same config resolution model. Discovery runs when disks are added to the collection. Config is applied when a disk is played from the playlist (which already uses the same playback path).

For disk mounting (non-playback), config is **never** applied. Mounting is a passive action; only explicit play triggers config.

### 6.7 Config in "now playing" area

The playback controls card shows the currently active config (if any) as a small label:

> Config: `game-pal.cfg`

Tapping it opens the config detail sheet for the current item.

---

## 7. Configuration Editing Model

### 7.1 Scope

Users can edit individual configuration values that a `.cfg` file would set, without modifying the original `.cfg` file. Edits are stored as overrides on the playlist item.

### 7.2 Override model

```
ConfigValueOverride {
  category: string    // e.g. "C64 and Cartridge Settings"
  item: string        // e.g. "C64 Mode"
  value: string       // e.g. "PAL"
}
```

Overrides are applied **after** the base `.cfg` file is loaded. The application sequence is:

1. Load `.cfg` file via Telnet "Load Settings" (applies all values in the file).
2. Apply each override via REST `PUT /v1/configs/{category}/{item}?value={value}`.
3. Proceed with playback.

### 7.3 Config editor (bottom sheet)

The config editor shows the values that the `.cfg` file will set, organized by category. For each value:

- **Category heading**: collapsible group (e.g. "C64 and Cartridge Settings")
- **Item row**: label, current value from the config, edit control
- **Edit controls**: match the existing config browser widgets (dropdowns for enumerated values, sliders for numeric ranges, text inputs for strings)
- **Override indicator**: items with user overrides show a small badge

The editor reuses the existing `normalizeConfigItem` and config widget infrastructure from the Config Browser page.

### 7.4 Reading config file contents

To preview and edit `.cfg` file contents, the system must read and parse the file. The C64U `.cfg` format is a binary format that can be read by:

1. Uploading the file to `/Temp` on the C64U.
2. Using the Telnet menu to navigate to the file and inspect its effect on each config category.

Alternatively, the system can:

1. Snapshot the current device config (read all categories via REST).
2. Apply the `.cfg` file.
3. Read all categories again via REST.
4. Compute the diff.
5. Restore the original config.

This "snapshot-apply-diff-restore" approach is accurate but expensive and potentially disruptive. A more practical approach:

**Recommended: Deferred diff computation**

- The editor shows a "Load preview" button that performs the snapshot-apply-diff-restore cycle.
- The diff is cached for the session.
- Until the user loads the preview, the editor shows the config file metadata (name, size, date) and the override list.
- This avoids the cost of parsing every config file at import time.

### 7.5 Editing without a base config

Users can also create overrides without a base `.cfg` file. This covers the case where the user wants to change one or two settings before playback without maintaining a full config file.

In this mode:

- The item's config state is "Config Edited" with no base `configRef`.
- Only the overrides are applied via REST before playback.
- No Telnet "Load Settings" step occurs.

---

## 8. Edge Cases and Failure Modes

### 8.1 Config file becomes unavailable

**Scenario**: A config was attached at import time but the source (local folder, USB drive) is no longer accessible at playback time.

**Behavior**: At playback time, the system attempts to resolve the config file. If it fails:

1. Playback is paused before execution.
2. A modal dialog appears: "Config file `game.cfg` is unavailable. Play without config, or cancel?"
3. User chooses:
   - **Play without config**: Playback proceeds. The item's config state is updated to "Config Declined" for this session.
   - **Cancel**: Playback does not start.

This is a modal (decision interstitial) per the UX guidelines.

### 8.2 Config application fails mid-workflow

**Scenario**: The Telnet session disconnects during config application, or the FTP upload fails.

**Behavior**:

1. The error is caught and logged through the existing diagnostics framework.
2. A user-facing error notification appears: "Config application failed: [reason]. Playback cancelled."
3. Playback does not proceed. The device state may be partially modified.
4. The user can retry (which re-attempts config application) or remove the config and play without it.

### 8.3 Multiple items with different configs in rapid succession

**Scenario**: Autoplay advances through a playlist where consecutive items have different configs.

**Behavior**: Each item's config is applied independently before its playback. The playback controller already serializes play transitions via `enqueuePlayTransition`, so config application for item N+1 waits until item N's transition is complete.

**Risk**: Frequent config changes increase Telnet session overhead and device load.

**Mitigation**: The system compares the incoming config to the last-applied config. If they are identical (same file reference, same overrides), the redundant application is skipped. This is safe because config application is idempotent.

### 8.4 Disk multi-group rotation with config

**Scenario**: A multi-disk game (disk 1, disk 2, disk 3) where only disk 1 has a config that sets up the drive and machine type.

**Behavior**: Each disk in the group can have its own config independently. If only disk 1 has a config, the system applies it for disk 1. Disks 2 and 3 play without config application (device retains the state from disk 1's config).

This is correct because multi-disk games typically need configuration only at initial load.

### 8.5 Config conflicts between REST and .cfg file

**Scenario**: The user has made REST-based config changes (via the Config Browser page) and then plays an item with a `.cfg` file that overrides those changes.

**Behavior**: The `.cfg` file always wins at playback time (it's a full device config restore). REST overrides are applied after the `.cfg` file.

**Transparency**: The pre-playback notification shows what will change, giving the user a chance to cancel if the changes are undesirable.

### 8.6 HVSC source items

**Scenario**: HVSC items are pre-packaged SID files. They do not have `.cfg` files in the HVSC tree.

**Behavior**: Discovery correctly returns no candidates for HVSC-sourced items. Users can manually attach a config if desired (e.g. a "SID playback" config they maintain separately). The system does not manufacture config references for HVSC items.

### 8.7 CommoServe archive items

**Scenario**: Items downloaded from the CommoServe archive may include `.cfg` files in the archive.

**Behavior**: Discovery does not run for CommoServe items during the initial add (since the archive structure is opaque until download). If the archive contains a `.cfg` alongside a playable file, it is treated as a candidate once the archive is expanded. This is a future enhancement; for the initial implementation, CommoServe items have no automatic config discovery.

### 8.8 User edits a config, then changes the base config file

**Scenario**: User has overrides on item A pointing to `game.cfg`. User then changes the base config to `other.cfg`.

**Behavior**: Overrides are cleared when the base config file changes. A confirmation modal appears: "Changing the config file will clear your custom edits. Continue?"

### 8.9 Playlist shuffle with mixed configs

**Scenario**: A shuffled playlist contains items with different configs, no configs, and declined configs.

**Behavior**: Each item is independent. The playback controller applies (or skips) config per-item as it reaches each track. Shuffle does not affect config resolution.

---

## 9. Trade-offs and Alternatives Considered

### Alternative A: Content-based config matching

**Approach**: Parse `.cfg` file contents to determine which programs they are intended for, using embedded metadata or heuristic analysis.

**Rejected because**: C64U `.cfg` files are binary device state snapshots with no embedded metadata about target programs. Heuristic matching based on config values (e.g. "this config enables 1541 mode, so it must be for D64 files") is unreliable and produces false positives.

### Alternative B: Config database / registry

**Approach**: Maintain a local database mapping playable file hashes or paths to config file references, built up over time from user selections.

**Rejected because**: This adds significant complexity (database schema, migration, sync) for a feature that the simpler candidate-list approach handles adequately. The candidate list with manual resolution provides the same outcome with less infrastructure. Could be reconsidered as a future enhancement if users accumulate large config libraries.

### Alternative C: Automatic config application on mount

**Approach**: Apply config when a disk is mounted, not just when playback starts.

**Rejected because**: This violates the constraint that mounting must not trigger configuration changes. Users mount disks for inspection, directory listing, and file transfer without intending to change the machine state. Config application is reserved for the explicit play action.

### Alternative D: Global "active config" concept

**Approach**: Instead of per-item configs, maintain a single "active config" that applies to all playback until changed.

**Rejected because**: This is less precise than per-item config. A playlist of SID files from different composers may need different SID socket configurations. Per-item config is more expressive and matches user intent better. However, a "default config" (applied when an item has no specific config) is a valid future enhancement that could coexist with per-item config.

### Alternative E: Real-time config diff before every playback

**Approach**: Before every play action, read the device's current config, compute a diff against the target config, and show the user what will change.

**Rejected because**: The diff computation requires reading all config categories via REST (18+ API calls), which adds latency to every play transition. This is acceptable as an on-demand preview (section 7.4) but not as a mandatory pre-playback step. The cached diff approach with a "Load preview" button is a better balance of information and responsiveness.

### Trade-off: Discovery depth vs. performance

**Decision**: Discovery walks up to the source root but does not recursively search sibling directories or unrelated paths. This limits discovery to the vertical directory ancestry, which is fast (one directory listing per level) and semantically meaningful (parent configs are intentional broad-scope configs). Horizontal search (looking in sibling directories) would be slow and produce more false positives.

### Trade-off: Auto-selection aggressiveness

**Decision**: Only exact-name matches and single-directory configs are auto-selected. All other cases require manual resolution. This is conservative but safe. Users who want automatic behavior can adopt the naming convention (put `game.cfg` next to `game.prg`). Users who do not follow conventions are not penalized with incorrect auto-selection.

---

## 10. Final Recommended Approach

### Summary

The playback configuration system extends the existing `ConfigFileReference` infrastructure with three new capabilities:

1. **Multi-strategy discovery** that finds config candidates beyond exact-name matching, while preserving the existing exact-name behavior as the highest-confidence strategy.

2. **Transparent resolution** that stores the full candidate list and resolution origin on each item, making the system's decisions visible and reversible.

3. **Value-level editing** that allows users to inspect config contents and apply per-item overrides without modifying the original `.cfg` file.

### Implementation layers

**Layer 1: Discovery engine** (new module: `src/lib/config/configDiscovery.ts`)

- Input: a playable file path + source reference
- Output: ordered list of `ConfigCandidate` objects
- Strategies: exact-name, directory-level, parent-directory
- Integrates with existing source listing infrastructure

**Layer 2: Resolution logic** (new module: `src/lib/config/configResolution.ts`)

- Input: candidate list + existing manual selection (if any)
- Output: `ConfigResolution` object
- Precedence: manual > manual-none > auto-exact > auto-directory > none
- Called at import time and on-demand

**Layer 3: Application pipeline** (extends existing `applyConfigFileReference.ts`)

- Applies base `.cfg` via existing Telnet workflow
- Applies value overrides via REST after base config
- Logs all operations through diagnostics
- Integrates with machine transition coordinator
- Skips redundant application when consecutive items share the same config

**Layer 4: UI components** (new and extended components)

- Config indicator on playlist item rows
- Config detail bottom sheet
- Candidate chooser bottom sheet
- Config editor bottom sheet (reuses config browser widgets)
- Pre-playback config notification
- Config-unavailable modal

**Layer 5: Persistence** (extends existing playlist persistence)

- `configRef`: existing field, unchanged
- `configOrigin`: new field on `PlaylistItem` and `StoredPlaylistState`
- `configOverrides`: new field for value-level edits
- `configCandidates`: in-memory only, not persisted

### Integration points with existing code

| Existing module               | Change                                                           |
| ----------------------------- | ---------------------------------------------------------------- |
| `addFileSelections.ts`        | Replace `resolveConfigRef()` with discovery engine call          |
| `usePlaybackController.ts`    | Add redundancy check before `applyConfigFileReference()`         |
| `playbackRouter.ts`           | No change (config is applied before play plan execution)         |
| `types.ts` (PlaylistItem)     | Add `configOrigin`, `configOverrides`, `configCandidates` fields |
| `configFileReference.ts`      | No change to existing types                                      |
| `applyConfigFileReference.ts` | Add override application step after base config                  |
| `configWorkflow.ts`           | No change                                                        |
| `usePlaylistListItems.tsx`    | Add config indicator rendering                                   |
| `PlayFilesPage.tsx`           | Wire config detail/chooser/editor sheets                         |

### What does not change

- The Telnet "Load Settings" workflow for `.cfg` file application
- The FTP upload mechanism for local config files
- The REST API for individual config item reads/writes
- The config browser page (remains a standalone device config tool)
- The config snapshot save/load workflow on the Home page
- The existing exact-name matching behavior (preserved as highest-priority strategy)
- Source browsing, mounting, and import flows (no config side effects)

### Phased delivery

**Phase 1: Foundation**

- Discovery engine with all three strategies
- Resolution model with precedence
- Config indicator on playlist items
- Config detail sheet with file info and resolution origin
- Candidate chooser for ambiguous cases
- Integration tests

**Phase 2: Transparency**

- Deferred diff computation (snapshot-apply-diff-restore)
- Pre-playback notification with key changes
- Config-unavailable modal
- Redundant application skip

**Phase 3: Editing**

- Config editor with category/item/value widgets
- Override persistence on playlist items
- Override application via REST after base config
- Override-clear confirmation on base config change

**Phase 4: Cross-surface parity**

- Config support on the Disks page collection entries
- Config support for CommoServe archive items (post-download discovery)
- "Default config" concept for items without specific configs
