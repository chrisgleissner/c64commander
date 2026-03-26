# Telnet Convergence Worklog

## 2026-03-26T16:00:00Z - Task classification and implementation restart

- Reclassified the work from the earlier audit state to `DOC_PLUS_CODE` with visible UI changes because this pass must modify runtime code, Home UI, Diagnostics, tests, docs, and screenshots.
- Replaced the completed audit framing in `PLANS.md` with an implementation plan that matches the required convergence slices and mandatory validation.
- Locked the execution rule that REST/FTP diagnostics behavior stays intact while Telnet becomes a first-class subsystem.

## 2026-03-26T16:15:00Z - Required reading and impact map refreshed

- Re-read `doc/research/review-13/review-13.md`, the Telnet base spec, the integration spec, the action walkthrough, Addendum 1, `src/pages/DocsPage.tsx`, and `docs/diagnostics/index.md`.
- Re-read the runtime/UI files that currently own the gaps: `src/lib/telnet/telnetTypes.ts`, `src/lib/telnet/telnetActionExecutor.ts`, `src/hooks/useTelnetActions.ts`, `src/pages/home/components/MachineControls.tsx`, `src/pages/home/components/DriveManager.tsx`, `src/pages/home/components/PrinterManager.tsx`, and `src/pages/home/hooks/useHomeActions.ts`.
- Re-read the diagnostics and health surfaces that must converge: `src/lib/tracing/traceSession.ts`, `src/lib/tracing/types.ts`, `src/lib/diagnostics/actionSummaries.ts`, `src/lib/diagnostics/healthModel.ts`, `src/lib/diagnostics/diagnosticsActivity.ts`, `src/hooks/useDiagnosticsActivity.ts`, `src/hooks/useHealthState.ts`, and `src/components/diagnostics/DiagnosticsDialog.tsx`.

## 2026-03-26T16:30:00Z - Confirmed root-cause implementation seams

- Confirmed the Telnet registry still omits the Developer submenu even though the mock fixture and spec already define those actions.
- Confirmed `recordTelnetOperation()` exists but has no runtime call sites, leaving diagnostics summaries and health contributors unable to see Telnet work.
- Confirmed Home still mixes REST reboot semantics with partial Telnet buttons, and there is no primary-versus-overflow action split to protect the 2x4 compact layout.
- Confirmed the device-card model remains inconsistent: printer exposes two Telnet actions, Soft IEC exposes two, and physical drive cards expose none.

## 2026-03-26T16:40:00Z - Test and docs baseline locked

- Confirmed current unit coverage protects low-level Telnet execution and selected Home buttons but not the required registry parity, Telnet traces, Diagnostics Telnet contributors, Home ordering/overflow rules, or device-card convergence.
- Confirmed docs still describe a REST-first Home and Diagnostics story and the screenshot inventory does not yet cover the required Telnet quick-action, overflow, or Diagnostics filter states.
- Next implementation slice: patch the canonical Telnet action metadata and capability model first so tracing, diagnostics, and UI can share one source of truth.
