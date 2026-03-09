# Agentic Coverage Matrix

## Purpose

This matrix ensures no major repository feature area is omitted from autonomous test planning.

Testability states:

- `Ready`: implementable now with current repo evidence.
- `Guarded`: implementable now, but only with explicit safety policy.
- `Partial`: partly implementable, but missing one or more expected-behavior or instrumentation decisions.
- `Out`: intentionally not part of product-validation coverage.

| Feature area | Repo anchors | Documentation owner | Testability | Primary oracle class | Safety class | Blockers / notes |
| --- | --- | --- | --- | --- | --- | --- |
| Route shell and navigation | `src/App.tsx`, `src/components/TabBar.tsx` | `agentic-feature-surface`, `agentic-action-model` | Ready | UI plus trace/log | Read-only | Includes hidden probe route, but product runs should stay on public routes |
| Connection and demo-mode state machine | `src/lib/connection/connectionManager.ts` | `agentic-android-runtime-contract`, `agentic-oracle-catalog` | Ready | UI plus connection snapshot plus logs | Guarded | Android-first only |
| Home machine controls | `src/pages/HomePage.tsx` | `agentic-action-model`, `agentic-safety-policy` | Guarded | UI plus REST/state-ref plus diagnostics | Destructive | Exact safe lab budget must be enforced |
| Home RAM workflows | `src/pages/HomePage.tsx`, `src/lib/machine/**` | `agentic-action-model`, `agentic-oracle-catalog` | Partial | Filesystem plus REST/state-ref | Destructive | Needs clearer expected-behavior contract for real hardware |
| Home quick config, LED, SID, audio shortcuts | `src/pages/HomePage.tsx` | `agentic-action-model`, `agentic-oracle-catalog` | Guarded | UI plus REST-visible config | Guarded mutation | Some hardware-visible outcomes still need item-specific expectations |
| Home drives, printer, stream | `src/pages/HomePage.tsx` | `agentic-action-model`, `agentic-oracle-catalog` | Partial | UI plus REST/FTP plus diagnostics | Guarded mutation | Printer and stream postconditions need stronger product spec |
| Home app config snapshot management | `src/hooks/useAppConfigState.ts` | `agentic-action-model`, `agentic-oracle-catalog` | Ready | UI plus local persistence | Guarded mutation | Use test-owned config names only |
| Play source browsing and playlist build | `src/pages/PlayFilesPage.tsx` | `agentic-action-model`, `agentic-oracle-catalog` | Ready | UI plus REST/FTP/filesystem | Guarded mutation | Mixed local, SAF, FTP, and HVSC paths |
| Play transport and queue progression | `src/pages/PlayFilesPage.tsx` | `agentic-action-model`, `agentic-oracle-catalog`, `c64scope-spec` | Ready | UI plus A/V plus logs | Guarded mutation | A/V is required here, but not sufficient alone |
| Play duration, subsong, volume, songlengths | `src/pages/playFiles/**` | `agentic-action-model`, `agentic-oracle-catalog` | Ready | UI plus REST-visible mixer state | Guarded mutation | Needs mixer-state corroboration |
| Play HVSC lifecycle | `src/pages/playFiles/hooks/useHvscLibrary.ts`, `src/lib/hvsc/**` | `agentic-action-model`, `agentic-oracle-catalog`, `agentic-android-runtime-contract` | Guarded | UI plus filesystem plus diagnostics | Guarded mutation | Long-running and resource-heavy |
| Android background playback and lock behavior | `src/pages/PlayFilesPage.tsx`, `src/lib/native/backgroundExecution*.ts` | `agentic-android-runtime-contract`, `agentic-oracle-catalog` | Ready | UI plus Android logs plus diagnostics, with A/V when applicable | Guarded mutation | Android-only execution scope |
| Disks library and drive control | `src/components/disks/HomeDiskManager.tsx` | `agentic-action-model`, `agentic-oracle-catalog`, `agentic-safety-policy` | Guarded | UI plus REST/FTP | Guarded / destructive | Delete paths need test-owned fixtures only |
| Config browser general editing | `src/pages/ConfigBrowserPage.tsx` | `agentic-action-model`, `agentic-oracle-catalog` | Partial | UI plus REST-visible config | Guarded mutation | Category-specific expected behavior is incomplete |
| Config Audio Mixer and clock sync | `src/pages/ConfigBrowserPage.tsx` | `agentic-action-model`, `agentic-oracle-catalog` | Partial | UI plus REST-visible config plus logs | Guarded mutation | Clock sync success tolerance not fully specified |
| Settings connection, theme, play prefs, HVSC toggle | `src/pages/SettingsPage.tsx` | `agentic-action-model`, `agentic-oracle-catalog` | Ready | UI plus persistence plus logs | Guarded mutation | Good reuse from Playwright |
| Settings diagnostics and settings transfer | `src/pages/SettingsPage.tsx`, `src/lib/diagnostics/**` | `agentic-observability-model`, `agentic-oracle-catalog` | Partial | Filesystem plus diagnostics ZIP plus UI | Guarded mutation | Share-sheet completion semantics need product call |
| Settings device safety and developer mode | `src/pages/SettingsPage.tsx` | `agentic-safety-policy`, `agentic-open-questions` | Partial | UI plus persisted config | Guarded / destructive | Tests must not weaken global safety without explicit case approval |
| Docs and licenses | `src/pages/DocsPage.tsx`, `src/pages/OpenSourceLicensesPage.tsx` | `agentic-action-model`, `agentic-oracle-catalog` | Ready | UI | Read-only | Coverage should remain lightweight |
| Coverage probe and heartbeat | `src/pages/CoverageProbePage.tsx`, `src/components/TestHeartbeat.tsx` | `agentic-observability-model` | Out | Probe-only | Prohibited in product verdicts | Allowed for lab checks only |
