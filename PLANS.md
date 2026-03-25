# Online Archive HTTP Integration Plan

Status: IN PROGRESS
Date: 2026-03-25
Classification: DOC_PLUS_CODE

## Phase 1 - Repo + Spec Alignment
- Inputs: issue statement, current telnet/archive docs, existing settings/playback architecture
- Outputs: confirmed scope, touched-file map, baseline validation results
- Acceptance criteria: current archive/Telnet behavior, settings patterns, and playback execution seams are understood
- Produced artifacts: PLANS.md, WORKLOG.md

## Phase 2 - Archive Abstraction Model
- Inputs: direct HTTP archive requirements, existing logging/error patterns
- Outputs: ArchiveClient interface, BaseArchiveClient, thin backend subclasses, factory
- Acceptance criteria: shared request logic lives in base class; subclasses only differ by defaults/headers
- Produced artifacts: src/lib/archive/types.ts, src/lib/archive/client.ts

## Phase 3 - Configuration System
- Inputs: appSettings persistence, settings transfer/export/import
- Outputs: backend + override persistence, validation, resolved config model
- Acceptance criteria: runtime config resolves user overrides over backend defaults and falls back on invalid host input
- Produced artifacts: src/lib/config/appSettings.ts, src/lib/config/settingsTransfer.ts, src/lib/archive/config.ts

## Phase 4 - Generic Client + Subclasses
- Inputs: config resolver, archive types
- Outputs: thin CommoserveClient / Assembly64Client implementations and createArchiveClient()
- Acceptance criteria: no direct subclass instantiation outside the factory in app code
- Produced artifacts: src/lib/archive/client.ts

## Phase 5 - HTTP Implementation
- Inputs: endpoint contract, timeout requirements
- Outputs: deterministic fetch implementation with headers, timeouts, JSON parsing, binary download, diagnostics
- Acceptance criteria: dynamic baseUrl only, required headers injected, errors include backend + host, binary preview logged
- Produced artifacts: src/lib/archive/client.ts

## Phase 6 - Query Builder + Types
- Inputs: AQL grammar, search field set
- Outputs: pure backend-agnostic query builder and types
- Acceptance criteria: quoted/unquoted rules enforced, empty query rejected, URL encoding deterministic
- Produced artifacts: src/lib/archive/queryBuilder.ts, src/lib/archive/types.ts

## Phase 7 - File Execution Pipeline
- Inputs: archive binary download, existing playback router and validation utilities
- Outputs: shared archive execution helper using REST upload/run path
- Acceptance criteria: no Telnet usage in primary flow; no backend-specific execution branches
- Produced artifacts: src/lib/archive/execution.ts

## Phase 8 - Hook Integration
- Inputs: archive client factory, execution helper
- Outputs: deterministic hook with idle/searching/results/entries/downloading/executing/error phases and cancellation
- Acceptance criteria: race-safe requests and immediate client recreation on config changes
- Produced artifacts: src/hooks/useOnlineArchive.ts

## Phase 9 - Settings UI
- Inputs: settings page patterns, hook API
- Outputs: Online Archive settings section and archive dialog
- Acceptance criteria: backend selection and overrides persist immediately; archive browser reachable from UI
- Produced artifacts: src/pages/SettingsPage.tsx, src/components/archive/OnlineArchiveDialog.tsx

## Phase 10 - Platform Configuration
- Inputs: Android manifest/network policy, iOS Info.plist ATS settings
- Outputs: allow-list for default archive hosts and documented override limitation
- Acceptance criteria: default hosts are allowed on native platforms without weakening unrelated behavior
- Produced artifacts: android/app/src/main/AndroidManifest.xml, android/app/src/main/res/xml/network_security_config.xml, ios/App/App/Info.plist

## Phase 11 - State Machine + Error Handling
- Inputs: hook state requirements, diagnostics/logging patterns
- Outputs: deterministic transitions and contextual error surfaces
- Acceptance criteria: cancellation supported; errors remain diagnosable and include backend/host context
- Produced artifacts: src/hooks/useOnlineArchive.ts, src/lib/archive/client.ts

## Phase 12 - Mock Infrastructure
- Inputs: archive API contract, test server patterns
- Outputs: shared archive mock core and thin backend wrappers
- Acceptance criteria: one endpoint implementation shared by both backends; supports dual-server mode
- Produced artifacts: tests/mocks/baseArchiveMock.ts, tests/mocks/commoserveMock.ts, tests/mocks/assembly64Mock.ts

## Phase 13 - Testing (Including Switchover)
- Inputs: Vitest/Playwright infrastructure, archive mocks, mock C64 server
- Outputs: focused unit/integration/UI tests for config, headers, query builder, switchover, and execution
- Acceptance criteria: runtime backend switching verified without stale state or cache leakage
- Produced artifacts: tests/unit/**, tests/integration/**, optional Playwright coverage if needed

## Phase 14 - Diagnostics + Logging
- Inputs: archive client/execution helpers
- Outputs: request/response timing, resolved config, client type, sanitized headers, payload preview logs
- Acceptance criteria: each archive operation logs enough context for reproducible diagnosis
- Produced artifacts: src/lib/archive/client.ts, src/lib/archive/execution.ts

## Phase 15 - Screenshots + Documentation
- Inputs: UI delta, platform limitation details
- Outputs: only the docs/README updates and screenshots actually made necessary by the visible UI change
- Acceptance criteria: docs remain accurate; screenshots updated only if existing documented visuals became stale
- Produced artifacts: README/doc updates, screenshots if required

## Phase 16 - Final Validation
- Inputs: changed code and tests
- Outputs: lint/test/coverage/build/platform validation results, code review, CodeQL scan
- Acceptance criteria: targeted validation complete, branch coverage >= 91%, no unresolved localized security issues
- Produced artifacts: WORKLOG.md final entries, validation evidence
