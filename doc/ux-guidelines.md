# UX Guidelines

## Goals

- Provide a **single, coherent mental model** across all file- and disk-related workflows.
- Ensure clear separation between **selection**, **navigation**, and **consumption**.
- Keep interactions predictable, repeatable, and intention-driven.
- Minimize layout shifts and maintain stable control placement.
- Provide clear feedback for selection, bulk actions, playback, and mounting states.

---

## Core Concepts (UX-Level)

The UX is built around three distinct concepts that must never be conflated:

1. **Sources**
   - Define *where items come from*.
   - Examples:
     - C64 Ultimate
     - Local device folders (multiple, user-defined)
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
- Local device sources represent previously selected folders.
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
- “Up” is disabled or hidden at the root.
- Remember the last visited path per source and resume there.
- Provide a quick “Root” action to return to the source root.

Selection views:

- Are used only to select files or folders.
- Must not expose playback, mounting, or collection actions.
- Must use the same layout and behaviour for all sources.

---

## Layout

- Use centered dialogs for modal actions:
  - Mount
  - Rename
  - Remove from collection
  - Playlist actions
- Avoid layout shifts when selections or controls appear.
- Reserve space for selection and bulk-action controls.
- Group related controls and keep labels concise and intention-driven.
- Long paths must wrap and never force horizontal scrolling.
- Lists show a configurable preview limit and open a scrollable “View all” panel for the full set.

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
- Playlist displayed with SelectableActionList component
- Transport controls: Play/Stop, Pause/Resume, Prev/Next
- Playlist options: Shuffle, Repeat
- Selection controls: Select all, Deselect all, Remove selected
- View all button when playlist exceeds preview limit
- HVSC integration for SID metadata and song lengths

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
- Quick action cards for machine control (Reset, Menu, Pause, Resume, Power Off)
- Configuration quick actions (Apply, Save, Load, Revert, Manage)
- Drive status cards with navigation to Disks page
- Current configuration display

**Settings Page (SettingsPage.tsx)**
- Connection settings (IP, Port, Mock mode)
- Appearance settings (Theme selection)
- Diagnostics (Share logs, Email logs, Clear logs)
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
- Source selection: Local vs C64 Ultimate
- Navigation within selected source (bounded by source root)
- File type filtering
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
- "Local" / "C64 Ultimate" - Source names
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
