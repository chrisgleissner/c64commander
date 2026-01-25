# C64 Commander - Stabilisation, UX, and Iconography Fix Plan

## A. Play Page - UI and Playback

- [x] Move playback progress bar to directly below the song control buttons
- [x] Add elapsed time label to the LEFT of the progress bar
- [x] Add remaining time label to the RIGHT of the progress bar, prefixed with "-"
- [x] Ensure time labels update continuously during playback
- [x] Fix demo mode playback so that Play actually starts playback
- [x] Ensure playback progress advances in demo mode
- [x] Verify that selecting a song updates the progress bar immediately
- [x] Ensure no silent failures when pressing Play (user-visible error and diagnostics log)

## B. Song Length Handling (Use Existing Native + DB Infrastructure)

- [x] Identify existing native-side HVSC song length ingestion / extraction code paths (including DB schema and repositories)
- [x] Verify current DB contents and lookup flow for song length by song identity (md5, path, or equivalent key)
- [x] Fix song length lookup so that already-ingested song length data is actually used for progress and remaining-time calculation
- [x] Ensure BOTH songlengths.md5 and songlengths.txt are supported end-to-end
- [x] Reuse existing HVSC ingestion service logic where possible
- [x] Extend ingestion to work with:
      - a 7-zip HVSC archive, OR
      - an already-extracted HVSC folder on the filesystem
- [x] Add diagnostics logs explaining which length source was used and why
- [x] Add strong test coverage:
      - Kotlin unit tests for parsing / ingestion (as applicable)
      - Integration tests verifying DB lookup is used by the UI
      - E2E test verifying remaining time display for a known sample

## C. Play Page - UI Cleanup

- [x] Remove non-functional checkbox row: "SID music / MOD music / PRT program / CRT cartridge / disk image"
- [x] Rename "Filter items" to "Filter files"
- [x] Ensure only functional filter checkboxes remain visible and working

## D. Playlist Persistence

- [x] Ensure playlist survives page navigation
- [x] Ensure playlist survives full app restart
- [x] Persist playlist using appropriate storage (preferences or local DB)
- [x] Restore playlist deterministically on app startup
- [x] Add tests for playlist persistence (or best-available automated substitute)

## E. Disks Page - Demo Mode Mounting

- [x] Fix disk mounting in demo mode
- [x] Ensure mounting from local Android filesystem works in demo mode
- [x] Ensure disk-mount operations in demo mode target the mock C64U by default
- [x] Verify mount-to-drive (e.g. drive A) succeeds in demo mode
- [x] Add clear error logging when mount fails (endpoint, host, demo vs real)

## F. File Origin Iconography

- [x] Use the following icons to indicate file origin, rendered to the LEFT of each imported file:
      - `c64u-icon.svg` for files originating from the C64U
      - `device-icon.svg` for files originating from the local device
- [x] Icons are currently located at:
      - `public/c64u-icon.svg`
      - `public/device-icon.svg`
- [x] Evaluate whether this location is idiomatic for the project structure
- [x] If not, relocate the icons to a more appropriate assets location and update all references accordingly
- [x] Ensure icons are loaded in a platform-appropriate way (Android, iOS, web)
- [x] Scale icons appropriately for list usage:
      - prefer reusing the same SVG at different sizes where possible
      - if platform constraints require multiple rasterised sizes, generate them
- [x] Icons MUST be:
      - visually subtle
      - monochrome or low-contrast
      - easily interpretable at a glance
      - non-disruptive to layout and alignment
- [x] Ensure icons do not cause row height changes or visual jitter
- [x] Add accessible labels (aria / contentDescription) if supported

## G. Demo Mode Connectivity Model (Mock-First With Real-Device Probing)

- [x] Verify mock C64U server starts reliably when demo mode is enabled
- [x] Ensure normal operations in demo mode use the mock C64U by default
- [x] Preserve periodic real-device probing (default interval: 5s or existing default)
- [x] Trigger probing immediately when either changes:
      - C64U Hostname / IP
      - Network Password
- [x] Ensure probe attempts are safe and non-disruptive
- [x] Add explicit logging for demo vs real connectivity decisions
- [x] Ensure discovery of a real device is treated as an optional upgrade path

## H. Settings Page Corrections

- [x] Display the ACTUALLY USED hostname/IP when demo mode is enabled
- [x] Clearly separate:
      - user-entered hostname/IP (editable)
      - “Currently using:” resolved target (mock vs real)
- [x] Ensure “Currently using:” updates when probe results change
- [x] Remove text: "the protocol is added automatically"
- [x] Update network password help text to:
      "Network password from the C64 manual, if defined"

## I. Verification

- [x] All relevant unit tests pass
- [x] All Playwright E2E tests pass
- [ ] Manual sanity check of:
      - demo mode playback
      - progress bar and time labels
      - playlist persistence
      - disk mounting from Android filesystem in demo mode
      - file origin icons (visibility, subtlety, alignment)
      - settings “Currently using:” indicator
- [ ] Confirm no unexpected network calls during normal demo operations (except allowed probes)
- [ ] No regressions introduced
