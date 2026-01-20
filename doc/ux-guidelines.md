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

3. **Libraries**
   - Logical collections of selected items.
   - Used exclusively for **playback** or **disk mounting**.
   - Never expose filesystem navigation.

All UX flows must respect this separation.

---

## Libraries

There are exactly two libraries:

### File Library

- Contains all playable artefacts:
  - PRG, CRT, SID, MOD, and disk images.
- Disk images in this library are treated as playable media.
- Playback auto-starts the first item on the disk.

### Disk Library

- Contains disk images intended for later mounting on drives.
- Focused on system configuration rather than immediate playback.

Libraries:

- Never expose filesystem concepts.
- Never depend on navigation state.
- Always operate on stored library entries.

---

## Primary User Actions

### Add Items (Primary CTA)

All acquisition flows start with **Add items** or **Add more items**.

This action always leads to:

1. Choose source
2. Select items
3. Add to library

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

Selection views:

- Are used only to select files or folders.
- Must not expose playback, mounting, or library actions.
- Must use the same layout and behaviour for all sources.

---

## Layout

- Use centered dialogs for modal actions:
  - Mount
  - Rename
  - Remove from library
  - Playlist actions
- Avoid layout shifts when selections or controls appear.
- Reserve space for selection and bulk-action controls.
- Group related controls and keep labels concise and intention-driven.

---

## Selection and Bulk Actions

- Always show:
  - Selection count
  - “Select all / Deselect all”
- Place bulk actions near selection controls.
- Clearly distinguish destructive actions.
- Always confirm destructive actions:
  - Remove from library
  - Delete (where applicable)

---

## Playback and Mounting Controls

- Playback and mounting controls appear **only in libraries**, never in selection views.
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
- Add to library
- Remove from library

### Avoid

- Browse filesystem
- Root directory
- Drill up
- Any terminology implying unrestricted filesystem access

Menu titles, dialog titles, and action labels must match exactly.

---

## Consistency Rules

- The same selection UI must be used for all sources.
- The same library UI must be used regardless of item origin.
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
