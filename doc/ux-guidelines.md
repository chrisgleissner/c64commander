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
- Libraries are the only place where playback and mounting occur.
- Clear intent, stable layouts, and consistent wording are mandatory.

This model prioritizes clarity, predictability, and long-term maintainability.
