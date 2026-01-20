# UX consistency guidelines

## Goals

- Keep interactions predictable across pages and dialogs.
- Minimize layout shifts and maintain stable control placement.
- Provide clear feedback for selection, bulk actions, and playback states.

## Layout

- Use centered dialogs for modal actions (mount, rename, delete, playlist, etc.).
- Avoid layout shifts when selections or controls appear; reserve space for actions.
- Group related controls and keep labels concise.

## Selection and bulk actions

- Always show selection count and “Select all / Deselect all”.
- Place bulk destructive actions near selection controls.
- Confirm destructive actions (delete, remove from library).

## File browsing

- Use consistent “Up” navigation and path display in local/FTP browsers.
- Keep primary actions (Open, Play, Import) aligned and consistent per row.

## Playback controls

- Keep Shuffle and Repeat toggles grouped with folder recursion controls.
- Playlist actions (play, remove, clear) should be accessible without hunting.
- Use detected durations (Songlengths/HVSC) to inform timers when available.

## Copy and labels

- Use descriptive action labels (e.g., “Rename disk…”, “Remove from library”).
- Match menu and dialog titles with their action labels.
