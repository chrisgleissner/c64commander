---
description: Update documentation screenshots when UI changes require it
---

# Screenshot Update

Update documentation screenshots only when the visible UI changed in a way that makes existing documentation images inaccurate.

Documentation screenshots live under:

docs/img/

They are part of the repository's user-visible documentation and must remain accurate.

However, screenshots must be updated with strict discipline.

---

# Preconditions

Before performing any screenshot work:

1. Determine whether the change includes a **UI_CHANGE**.
2. Identify the **specific UI surfaces** affected.
3. Confirm that the visible UI change makes existing documentation screenshots inaccurate.

If the UI change does **not** alter documented visible output, **do not update screenshots**.

---

# When Screenshots MUST Be Updated

Update screenshots when visible UI changes affect documented output, including:

- page layout
- labels or headings
- buttons, controls, or icons
- page sections appearing or disappearing
- navigation visible in the screenshot
- colors, spacing, or styling that materially changes the documentation image
- empty states, dialogs, or overlays explicitly documented

---

# When Screenshots MUST NOT Be Updated

Do **not** regenerate screenshots for:

- documentation-only changes
- refactors with identical UI output
- API or backend logic changes without visible UI difference
- internal state changes that do not alter rendering
- test changes
- dependency updates
- unrelated pages unaffected by the task

Never regenerate screenshots purely because a screenshot tool exists.

---

# Minimal Screenshot Rule

Regenerate **only the smallest subset of screenshots required** to restore documentation accuracy.

Examples:

- If only the Home page changed, update only screenshots under the Home-related folder(s).
- If only a dialog changed, update only screenshots that include that dialog.
- If a change affects dark mode only, regenerate only the dark mode screenshots.

Never regenerate the entire screenshot set.

---

# Screenshot Mapping

Before generating screenshots:

1. Identify the exact page(s) affected.
2. Identify the corresponding screenshot files under `docs/img/`.
3. Replace only those files.

Preserve:

- existing file names
- existing directory structure

Unless the documentation structure itself changed.

---

# Verification

After updating screenshots:

1. Verify that each regenerated image corresponds to the updated UI.
2. Confirm that no unrelated screenshots were modified.
3. Ensure documentation references still point to the correct files.

---

# Output

Provide a concise completion summary containing:

- the UI surfaces that changed
- the screenshot files updated
- the reason each screenshot required regeneration

Example summary:

Updated screenshots for Home page layout change:

- docs/img/app/home/00-overview-light.png
- docs/img/app/home/01-overview-dark.png

Reason: button labels and section spacing changed, making previous documentation images inaccurate.

If screenshots were **not updated**, explicitly state why they were unnecessary.
