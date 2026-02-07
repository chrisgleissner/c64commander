# PLANS.md

## 1. SCOPE
- [x] Audit current Home/Disks/API behavior against requested device classes and machine controls.
- [x] Implement full disk + printer support on Home and disk-only support on Disks page.
- [x] Implement read, write, and reset handling aligned with documented REST support.
- [x] Keep changes minimal and aligned with existing UX/component patterns.

## 2. RESET SEMANTICS (CRITICAL)
- [x] Implement `Reset Drives` to target only Drive A, Drive B, and Soft IEC Drive.
- [x] Implement `Reset Printer` to target only Printer emulation (same REST API endpoint as for 'Reset Drives').
- [x] Enforce mandatory post-reset `GET /v1/drives` refresh and UI update strictly from refreshed payload.
- [x] Ensure transient fields (e.g., Soft IEC `last_error`) clear only when absent in refreshed response.
- [x] Add explicit unsupported-reset handling with code comments/tests (no invented endpoints, no toggle simulation).

## 3. REFERENCE API RESPONSE
- [x] Support full parsing of `GET /v1/drives` payload including `a`, `b`, `IEC Drive`, and `Printer Emulation`.
- [x] Preserve optional fields (`rom`, `image_file`, `image_path`, `last_error`, `partitions`) without crashes.
- [x] Ignore unknown future device entries safely.

## 4. DATA NORMALISATION (MANDATORY)
- [x] Add/extend a normalization layer for drive-like devices with explicit classes:
  - [x] `PHYSICAL_DRIVE_A`
  - [x] `PHYSICAL_DRIVE_B`
  - [x] `SOFT_IEC_DRIVE`
  - [x] `PRINTER`
- [x] Implement mapping rules:
  - [x] `a` -> `PHYSICAL_DRIVE_A`
  - [x] `b` -> `PHYSICAL_DRIVE_B`
  - [x] `IEC Drive` -> `SOFT_IEC_DRIVE`
  - [x] `Printer Emulation` -> `PRINTER`
- [x] Expose UI labels:
  - [x] `Drive A`
  - [x] `Drive B`
  - [x] `Soft IEC Drive`
  - [x] `Printer`
- [x] Enforce deterministic ordering:
  - [x] Home: A, B, Soft IEC, Printer
  - [x] Disks: A, B, Soft IEC (no printer)
- [x] Cover missing fields + unknown devices in unit tests.

## 5. HOME PAGE REQUIREMENTS
- [x] Convert Home drives UI into one consolidated Drives group directly under Drives header.
- [x] Remove dedicated per-drive cards/subgroups for A/B/Soft IEC from Home.
- [x] Render compact per-device rows in the consolidated group with:
  - [x] Enabled toggle
  - [x] Bus ID dropdown
  - [x] Drive type dropdown where supported
- [x] Keep Home dashboard concise (no full low-level details: rom, image_file, image_path, partitions, last_error).
- [x] Place `Reset Drives` inside the consolidated Drives group (not standalone section).
- [x] Add Printers section immediately below Drives with:
  - [x] Enabled toggle
  - [x] Bus ID dropdown
  - [x] explanatory label text
  - [x] `Reset Printer` action

## 6. MACHINE SECTION – PAUSE / RESUME (UPDATED)
- [x] Reduce machine controls to exactly 8 controls.
- [x] Replace separate Pause and Resume with one unified stateful control.
- [x] Drive Pause/Resume state from authoritative REST-backed machine state (not last button press).
- [x] During pause/resume mutation: disable control and show loading indicator.
- [x] On pause/resume failure: revert UI state and log via existing logging.
- [x] Rework machine layout/grouping:
  - [x] Reset first
  - [x] Reboot second
  - [x] Separate high-risk controls from pause/resume
  - [x] Power Off with strongest destructive styling
  - [x] Reset/Reboot with subtle danger accent
- [x] Replace double-tap Power Off with explicit confirmation dialog containing required warning text.
- [x] Implement Save RAM flow:
  - [x] Configured folder => save immediately
  - [x] Missing folder => prompt folder, persist it, then save in same flow
- [x] Implement Load RAM flow:
  - [x] Configured folder => open file picker rooted at RAM DUMP folder, restrict `.bin`
  - [x] Missing folder => open file picker, persist parent folder after file select, then load immediately
- [x] Enforce invariants: Save/Load RAM never fail only due to missing RAM DUMP folder.
- [x] Add tests for all four RAM folder cases.

## 7. DISKS PAGE REQUIREMENTS
- [x] Ensure Disks page shows only Drive A, Drive B, Soft IEC Drive (no printer UI).
- [x] Show bus ID + type next to each listed drive.
- [x] Keep interaction behavior aligned with Home drive behavior.

## 8. INTERACTION MODEL
- [x] Boolean fields mutate immediately on tap with per-control pending state.
- [x] Enumerated fields use dropdowns.
- [x] Free-form fields use input editor behavior.
- [x] On mutation failure: revert UI, log error, and show non-intrusive toast.

## 9. REST DISCOVERY (MANDATORY)
- [x] Confirm writable fields and reset endpoint availability from existing REST client + OpenAPI.
- [x] Implement mutation routing only where endpoints exist.
- [x] Render unsupported mutations read-only.
- [x] Add explicit tests proving no mutation is attempted for unsupported operations.

## 10. DROPDOWN VALUES
- [x] Disk bus ID dropdown supports 8, 9, 10, 11 and always includes current out-of-range value.
- [x] Printer bus ID dropdown supports 4, 5 and always includes current out-of-range value.
- [x] Physical drive type dropdown includes at least 1541, 1571, 1581.
- [x] Soft IEC type editing enabled only if REST/config support exists; otherwise read-only.

## 11. TEST REQUIREMENTS
- [x] Add normalization tests for all device classes and mapping behavior.
- [x] Add test: Soft IEC `last_error` disappears only after reset + refreshed `GET /v1/drives` response.
- [x] Add reset semantics tests:
  - [x] Reset Drives affects only disk devices
  - [x] Reset Printer affects only printer
  - [x] Every reset action triggers a drives refetch
- [x] Add Pause–Resume tests:
  - [x] exactly one pause/resume control
  - [x] icon + label reflect current machine state
  - [x] correct REST pause/resume call path
  - [x] UI updates from refreshed machine state
- [x] Add UI invariant tests:
  - [x] Printers never appear on Disks page
  - [x] Machine controls count is exactly 8
- [x] Update/extend unit and Playwright tests without weakening assertions.

## 12. DELIVERABLES & VERIFICATION
- [x] Update Home page for drives, printers, machine controls, power-off confirmation, RAM flows.
- [x] Update Disks page to be drives-only (A/B/Soft IEC) with required fields/actions.
- [x] Ensure reset/pause semantics are correct and deterministic.
- [x] Ensure `PLANS.md` tasks are completed and checked only after verification.
- [x] Run full local verification:
  - [x] `npm run test`
  - [x] `npm run lint`
  - [x] `npm run build`
  - [x] `npm run test:e2e`
  - [x] `./build`
