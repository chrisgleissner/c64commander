# UX Guidelines

## Goals

- Provide a **single, coherent mental model** across all file- and disk-related workflows.
- Ensure clear separation between **selection**, **navigation**, and **consumption**.
- Keep interactions predictable, repeatable, and intention-driven.
- Minimize layout shifts and maintain stable control placement.
- Provide clear feedback for selection, bulk actions, playback, and mounting states.
- Keep playlist browsing and filtering responsive at large scale (target: 100k items).

---

## Core Concepts (UX-Level)

The UX is built around three distinct concepts that must never be conflated:

1. **Sources**
   - Define _where items come from_.
   - Examples:
     - Local folders (multiple, user-defined)
     - C64U
     - HVSC
   - Selected before navigation begins.

2. **Selection (Scoped Navigation)**
   - Used only to **select items**.
   - Navigation is always **bounded to the selected source**.
   - No playback or mounting occurs here.

3. **Playlists & Collections**

- Playlists are the single source of truth for **playback**.
- Disk collections are used exclusively for **mounting**.
- Never expose filesystem navigation.

All UX flows must respect this separation.

---

## Playlists & Disk Collections

There are exactly two collections:

### Playlist (Play page)

- Contains all playable artefacts:
  - PRG, CRT, SID, MOD, and disk images.
- Items are queued explicitly; adding items never auto-plays.
- Playlist rows are source-agnostic:
  - Show canonical metadata (title, artist when available, duration, size, path, optional user metadata such as stars).
  - Do not show source-kind text labels (for example local/C64U/HVSC) in the playlist row.
  - Show a small source icon in each row to indicate origin (Local/C64U/HVSC).
- Mixed-source playlists must behave identically for play, reorder, remove, shuffle, and repeat.

### Source Transparency

- Source transparency means consistent handling across sources, not hidden origin.
- Playlist rows must not show source-kind text labels (for example `Local`, `C64U`, `HVSC`).
- Playlist rows render canonical track metadata (title, path, duration, and optional secondary metadata) plus a small source icon.
- Now-playing surfaces also show a small source icon for the active item.
- Source identity text is shown only during source selection and source browsing.

Source icons:

- `Local`: device icon.
- `C64U`: C64U icon.
- `HVSC`: library icon.

Playback metadata conventions:

- Multi-subsong SID playback shows `Subsong N/M`.
- Unknown duration renders as `—:—`.
- Availability issues render as generic `Unavailable` status, not source-specific errors.

### Disk Collection (Disks page)

- Contains disk images intended for later mounting on drives.
- Focused on system configuration rather than immediate playback.

Collections:

- Never expose filesystem concepts.
- Never depend on navigation state.
- Always operate on stored entries.

---

## Primary User Actions

### Add Items (Primary CTA)

All acquisition flows start with **Add items** or **Add more items**.

This action always leads to:

1. Choose source
2. Select items
3. Add to playlist

The user never “browses the filesystem” as a primary goal.

---

## Source Selection

- Source selection always happens **before** navigation.
- Sources must be clearly identifiable and named.
- Canonical source order is always: `Local`, `C64U`, `HVSC`.
- Play page source chooser must expose exactly:
  - `Local`
  - `C64U`
  - `HVSC`
- Source chooser buttons and other multi-source ordered lists must present sources in that exact order.
- Local device sources are added via the system folder picker; the source chooser shows only an “Add file / folder” action and does not list prior folders.
- Adding a new local source requires the Android folder picker.

Source selection must never occur inside a selection view.

---

## Selection (Scoped Navigation)

Selection views allow navigation and selection **within a fixed scope**.

Rules:

- Navigation downwards is unrestricted.
- Navigation upwards is allowed only until the source root.
- Traversal beyond the source root is impossible.
- The root boundary must be visually clear.
- “Up” is disabled at the root.
- Remember the last visited path per source and resume there.
- Provide a quick “Root” action to return to the source root.

Selection views:

- Are used only to select files or folders.
- Must not expose playback, mounting, or collection actions.
- Must use the same layout and behaviour for all sources.
- Must use the same interaction primitives for all sources:
  - `Root`
  - `Up`
  - `Refresh`
  - Folder open
  - Selection and add confirmation

---

## Playlist Query and Scale (100k Target)

- Playlist rendering must be query-driven, not full-array filtering in React memory.
- Filter input must update visible results quickly and predictably for large playlists.
- Query results must support deterministic ordering (default: playlist position), paging/windowing, and total match counts.
- Use virtualized rendering for long lists; avoid rendering off-screen rows.
- “View all” must open a query-backed list view, not materialize all items in memory at once.

---

## Interstitial Model

Every interstitial must be exactly one of these surface types:

### Modal (Decision Interstitial)

- Centered
- Compact
- Blocking
- Short-lived
- Must remain decision-only
- Must not be used for browsing, exploration, filtering, or multi-step workflows
- Must not rely on outer-surface scrolling

Examples:

- Demo Mode prompt
- Source selection chooser
- Save to App
- Power Off
- Clear Flash
- Restore Snapshot confirmation
- Rename and delete confirmations

### Bottom Sheet (Workflow Surface)

- Scrollable, exploratory, or stateful
- May stay open while the user browses, filters, or edits
- Persistent workflow surface
- Must fully occupy the available height from the bottom edge to the shared overlay top
- Must slightly overlap the header using the shared overlap delta
- Must leave the badge text, badge glyph, and header title readable at all times

Examples:

- Source browser after a source is chosen
- Playlist and disk “View all”
- Lighting Studio
- Diagnostics and diagnostics tool views
- Snapshot browser
- Manage App Configs
- Load from App
- Online Archive

### Interaction Invariant

- Exactly one interactive surface may own the screen at a time.
- Do not choose modal vs bottom sheet by screen size or height.
- Choose the surface by interaction type only.
- Hybrid flows are forbidden.
- A surface must never combine exploration and confirmation.

Required split examples:

- Snapshot browser is a bottom sheet; restore confirmation is a separate modal.
- Source chooser is a modal; source browser is a bottom sheet.
- Config manager is a bottom sheet; rename and delete are separate modals.

### Safe Area Rules

- `compact` profile uses full-screen top alignment: `HEADER_TOP = 0`.
- `medium` and `expanded` profiles respect the runtime top safe area: `HEADER_TOP = env(safe-area-inset-top)`.
- Do not hardcode top offsets.
- Do not add extra top padding beyond `HEADER_TOP`.
- System UI, cutouts, and status indicators must never be obstructed.

### Controlled Header Overlap

- Workflow sheets use one shared top equation only:
  `overlay.top = getBadgeSafeZoneBottomPx() - min(12px, 0.15 * headerHeight)`
- No workflow sheet may introduce extra top gaps, custom viewport fractions, or custom top margins.
- Overlap may intersect only the badge border area.
- Overlap must never intersect header title text, badge text, or the status glyph.

### Shared Header Row

- Every interstitial header starts with one title row only.
- The title sits on the left edge of the header content area.
- The close control sits on the right edge of that same row and shares the title's visual vertical center.
- Diagnostics header actions such as the overflow menu share that same row and align to the same right-side action rail as the close control.
- There must be no spacer row, no secondary row above the title, and no per-screen header padding overrides.

### Close Control

- All interstitial dismissal uses one shared `CloseControl` component.
- The close control renders as a plain `×` glyph with no visible button chrome, border, fill, shadow, or hover background.
- The visual footprint stays minimal while the interactive hit target remains at least `40px`.
- No interstitial may implement its own bespoke close button.

### Header Cleanup Rules

- Drag handles and pill bars are forbidden on workflow sheets.
- `Collapse` and `Expand` controls are forbidden in interstitial headers.
- Lighting Studio and Diagnostics follow the same header-row contract as every other sheet.
- Any additional controls must render on the title row or move into the body immediately below the header.

### Z-Index Hierarchy

- Main content: level `10`
- Backdrop: level `20`
- Header surface: level `30`
- Active modal or workflow sheet: level `40`
- The header stays above the backdrop and below the active surface.
- No interstitial component may exceed level `40`.

### Dimming Standard

- All overlays use the same backdrop: `bg-black/40`.
- This applies to modals, workflow sheets, and progress overlays.
- Do not use blur on overlay backdrops.
- Do not introduce per-component dimming overrides.

### Navigation Suppression

- When any interstitial is active, bottom navigation is visually removed with `transform: translateY(100%)`.
- Navigation space remains reserved through a persistent layout constraint.
- Overlay activation must not reflow content, resize the viewport, or shift scroll position.
- Background content and header controls must be non-interactive while another surface owns the screen.

### Full Height Utilization

- Bottom sheets must fill the full available height from the bottom edge to `overlay.top`.
- No visual sliver gap is allowed between the header overlap line and the sheet.
- Lighting Studio follows the same overlay top contract as Diagnostics and every other workflow sheet.

---

### Overlay and Badge Visibility Contract

This contract is **mandatory with zero exceptions**.

#### Health Badge

The health badge is the element in the top-right of the app bar labeled with the connectivity state
(for example "C64U ● HEALTHY", "C64U ● DEGRADED", "C64U ● UNHEALTHY"). It must remain:

- Visually present at all times while an overlay is active.
- Clearly readable at all times — text, status label, and health glyph must be distinguishable even when a backdrop is present.

Rationale: the health badge is the primary connectivity signal. Masking it prevents the user from noticing that the device has become degraded or unreachable while a workflow sheet is open.

#### Badge Safe Zone

The shared badge reference is the measured badge surface bounds.

- `getBadgeSafeZoneBottomPx()` returns the badge bottom edge used as the workflow-sheet top base.
- The sheet may overlap only by the shared overlap delta.
- Badge text and glyph are treated as critical bounds and may never be intersected.

#### Header Critical Bounds

- Header title text is also a critical bound.
- Runtime assertions must fail if an overlay intersects header title text or badge critical content.

#### Runtime Assertions

- `assertOverlayRespectsBadgeSafeZone(...)` logs a `console.error` in non-production builds when:
- a workflow sheet rises above the allowed overlap line
- header title text is intersected
- badge text or glyph is intersected
- badge border overlap exceeds the shared delta

---

## Subtitle Usage Policy

Visible subtitles are forbidden for top-of-page headers.

- Do not render a second line directly below the primary page title in the shared top header.
- Embedded explanatory copy inside page content is allowed when it is part of the page body rather than the page header.
- Do not use a page-header subtitle as a fallback for weak page naming.
- Accessibility descriptions may exist only when they are visually hidden (`sr-only`) and required for semantics.

Allowed exceptions:

- Embedded page explanations and helper text inside the main content area
- Error text
- Inline validation
- Live status output
- Intentional body content that is not acting as a subtitle

---

## Header Layout Standard

All top-level page headers must use the same structure.

- Left side: page title or branded leading content.
- Right side: unified health badge.
- Vertical alignment: exact center alignment on the same header row.
- Minimum row height: 52 px.
- Spacing must make the header feel taller through padding, not larger title text.
- The Home page may use a larger logo for brand identity, but it still follows the same shared row alignment.

Header prohibitions:

- No visible subtitle line.
- No extra status chips to the left of the health badge.
- No per-page header spacing overrides that break row alignment across display profiles.

---

## Layout

- Use centered dialogs for decision interstitials only:
  - confirmations
  - destructive actions
  - short naming prompts
- Avoid layout shifts when selections or controls appear.
- Reserve space for selection and bulk-action controls.
- Group related controls and keep labels concise and intention-driven.
- Long paths must wrap and never force horizontal scrolling.
- Lists show a configurable preview limit and open a scrollable, query-backed “View all” bottom sheet for large result sets.

---

## Selection and Bulk Actions

- Always show:
  - Selection count
  - “Select all / Deselect all”
- Place bulk actions near selection controls.
- Clearly distinguish destructive actions.
- Always confirm destructive actions:
  - Remove from collection
  - Delete (where applicable)

---

## Playback and Mounting Controls

- Playback and mounting controls appear **only in playlists/collections**, never in selection views.
- Keep playback-related toggles grouped and stable.
- Playlist actions (play, remove, clear) must be easily discoverable.
- Use detected metadata (e.g. HVSC song lengths) to inform timers when available.

---

## Language and Labels

Language must express **intent**, not implementation.

### Preferred Terms

- Add items
- Choose source
- Select items
- Add to playlist
- Remove from collection
- Local
- C64U
- HVSC

### Avoid

- Browse filesystem
- Root directory
- Drill up
- Any terminology implying unrestricted filesystem access

Menu titles, dialog titles, and action labels must match exactly.

---

## Consistency Rules

- The same selection UI must be used for all sources.
- The same playlist UI must be used regardless of item origin.
- Source-specific icons are allowed in playlist and now-playing rows; source-specific text labels are not.
- Source boundaries must never be crossed implicitly.
- Users must never wonder whether they are:
  - Selecting items
  - Browsing a source
  - Playing or mounting content

If intent is unclear, the UX is incorrect.

---

## Summary

- Sources define scope.
- Selection happens within scope.
- Collections (playlists and disk libraries) are the only place where playback and mounting occur.
- Clear intent, stable layouts, and consistent wording are mandatory.

This model prioritizes clarity, predictability, and long-term maintainability.

---

## Implementation Notes

### Actual Page Structure

**Play Page (PlayFilesPage.tsx)**

- Primary CTA: "Add items" or "Add more items"
- Opens ItemSelectionDialog for source and file selection
- Uses the same source chooser and browser flow for Local, C64U, and HVSC
- Playlist displayed with SelectableActionList component
- Playlist list surface must remain query-driven and virtualized for large datasets
- Transport controls: Play/Stop, Pause/Resume, Prev/Next
- Playlist options: Shuffle, Repeat
- Selection controls: Select all, Deselect all, Remove selected
- View all button when playlist exceeds preview limit
- HVSC integration for SID metadata and song lengths
- HVSC install/update/status controls are separate from normal source browsing and add-to-playlist flow

**Disks Page (DisksPage.tsx → HomeDiskManager.tsx)**

- Drive control area showing Drive A and Drive B status
- Active drive selection (radio buttons)
- Mount/Eject buttons for each drive
- Multi-disk navigation (Prev/Next) for disk groups
- Disk library displayed with SelectableActionList
- Primary CTA: "Add disks"
- Opens ItemSelectionDialog for disk source and selection
- Selection controls: Select all, Deselect all, Remove selected
- View all button when library exceeds preview limit

**Home Page (HomePage.tsx)**

- Compact machine control grid (4-column layout) with:
  - Reset, Reboot, Menu, Pause, Resume
  - Reboot (Clear RAM), Save RAM, Load RAM
  - Power Off with accidental-tap protection
- RAM dump folder panel (current folder + Change Folder)
- Configuration quick actions sized to match machine control cards
- Drive status cards with navigation to Disks page
- SID socket rows use a compact two-row layout with read-only base addresses and volume/pan sliders
- SID status and Streams status (VIC/Audio/Debug ON/OFF + target IP/port)

**Settings Page (SettingsPage.tsx)**

- Connection settings (IP, Port, Mock mode)
- Appearance settings (Theme selection)
- Diagnostics (Clear All, Share / Export)
- About section (with secret developer mode activation)

**Config Browser Page (ConfigBrowserPage.tsx)**

- Hierarchical category navigation
- Config item widgets (sliders, toggles, inputs)
- Per-item refresh buttons
- Category-level reset buttons

### Component Inventory

**SelectableActionList** - Universal list component used for:

- Playlist items on Play page
- Disk library on Disks page
- Consistent UI across both pages
- Built-in selection controls, bulk actions, view all dialog
- Per-item dropdown menus for contextual actions

**ItemSelectionDialog** - Source and file browser used for:

- Adding items to playlist
- Adding disks to library
- Source selection: Local vs C64U vs HVSC (Play page)
- Navigation within selected source (bounded by source root)
- File type filtering
- If the source picker is external (Android folder picker / OS dialog), the dialog closes and progress is shown on the destination page.

**Disk Groups**

- Group labels (name + color chip) are always shown beneath disk entries.
- Group assignment is available from the disk menu with existing group pickers and inline create.
- Folder scans auto-group disks that share a common prefix (case-insensitive; trailing digits or single letters).
- Bulk selection and confirmation

**QuickActionCard** - Action buttons used on Home page

- Machine control actions
- Configuration management actions
- Visual feedback states (default, danger, success)
- Loading and disabled states

### Terminology Consistency

The following terms are consistently used across the UI:

**Preferred (Used)**:

- "Add items" / "Add more items" - Primary acquisition CTA
- "Choose source" - Source selection dialog heading
- "Local" / "C64U" / "HVSC" - Source names

Terminology rule:

- Use only `Local`, `C64U`, and `HVSC` when naming sources in code and user-facing text.
- The long forms `Local Device`, `Commodore 64 Ultimate`, and `High Voltage SID Collection` are allowed only in documentation or explanatory prose outside the interactive UI.
- "Select all" / "Deselect all" - Bulk selection
- "Remove selected" - Destructive bulk action
- "View all" - List expansion
- Collection management (not filesystem operations)

**Avoided (Not Used)**:

- "Browse filesystem"
- "Root directory"
- "Drill up"
- Direct filesystem terminology

### Navigation Boundaries

Actual implementation enforces source boundaries:

- "Up" button navigates within source
- "Up" disabled at source root (not hidden)
- Source change requires returning to source selection
- No implicit source boundary crossing

### Modal Patterns

All destructive and configuration actions use centered modal dialogs:

- Mount disk dialog
- Remove from collection confirmation
- Rename disk dialog
- Save configuration dialog
- Load configuration dialog
- Set duration override dialog
- Choose subsong dialog
