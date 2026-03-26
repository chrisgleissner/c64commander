# Archive Client Simplification Plan

Status: COMPLETE
Date: 2026-03-26
Classification: DOC_PLUS_CODE

## Objective

Collapse the archive client subsystem to a single config-driven CommoserveClient, remove the retired secondary source, and remove the archive backend abstraction while preserving runtime behavior.

## Execution Phases

### Phase 1 - Baseline and impact map

- Status: COMPLETE
- Inventory retired-source and archive-backend references across runtime code, tests, docs, and generated artifacts.
- Confirm the active architecture still contains two archive client subclasses, backend-based config, and source/UI branches.

### Phase 2 - Converge archive config and client model

- Status: COMPLETE
- Replace archive config input with source-driven fields: `id`, `name`, `baseUrl`, `headers?`, `enabled?`.
- Remove archive backend types and defaults maps keyed by backend.
- Keep a single concrete archive client implementation: `CommoserveClient`.
- Simplify `createArchiveClient()` to unconditional CommoserveClient construction.
- Preserve request timeouts, query construction, transport behavior, binary downloads, and request/response transforms.

### Phase 3 - Remove retired-source runtime affordances

- Status: COMPLETE
- Remove retired-source settings, source selection branches, source navigation types, file origin handling, and playlist source branches.
- Keep the online archive UX functional with the CommoServe source only.
- Replace archive logging metadata from backend-based fields to source-based fields.

### Phase 4 - Consolidate mocks and regression tests

- Status: COMPLETE
- Remove source-specific archive mock wrappers.
- Update archive, settings, hook, source adapter, and item-selection tests to use generic or CommoServe source config.
- Add regression coverage for default config plus custom external config.

### Phase 5 - Documentation and literal sweep

- Status: COMPLETE
- Remove all retired-source mentions from repository documentation and process artifacts.
- Ensure PLANS.md and WORKLOG.md reflect only the converged architecture.

### Phase 6 - Validation and convergence

- Status: COMPLETE
- Run `npm run lint`.
- Run `npm run test:coverage` and confirm branch coverage remains at least 91%.
- Run `npm run build`.
- Run `npm run cap:build` if needed to refresh generated Android web assets so stale literals are removed.
- Perform final repository-wide literal sweep for removed-source strings and archive backend references.

## Current Validation State

- `npm run lint`: passed (0 errors).
- `npm run test`: all tests passed.
- `npm run build`: passed.
- Branch coverage: 91.01% (15075/16565), above the 91% threshold.
- Repository-wide retired-source sweep across active source and tests: clean.

## Constraints

- No new archive client implementations.
- No archive backend discriminator in archive config or factory code.
- No dead code or commented-out compatibility shims.
- Preserve external behavior for search, presets, entries, binary download, and execution.

## Acceptance Checklist

- Exactly one archive client implementation remains.
- No removed-source string remains anywhere in the repository.
- Archive config and logging are source-based rather than backend-based.
- Factory has no client-selection branching.
- Tests pass and coverage remains at least 91%.
- Build succeeds and generated assets no longer contain removed literals.
