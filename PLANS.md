# PLANS.md

## 1. Global Slider Responsiveness - Full Async Rest Decoupling
- [x] Inventory all slider usages and current REST handlers
- [x] Implement shared async coalescing + final commit behavior
- [x] Ensure no cross-coupling between concurrent slider updates
- [x] Preserve trace and notification observability for slider REST calls

## 2. Global Slider UX Consistency (Value Display, Midpoint Notch, Haptics)
- [x] Add dynamic value display behavior with fade-out on release
- [x] Implement midpoint notch, cling, and haptic tick logic
- [x] Centralize styling and behavior in a shared slider component/hook
- [x] Migrate all sliders to the shared implementation

## 3. Ram Save And Load Correctness (Reference Python Scripts)
- [x] Compare TypeScript RAM operations with scripts/ram_read.py and scripts/ram_write.py
- [x] Fix address ranges, chunking, and freeze/unfreeze flow discrepancies
- [x] Add logging and error context for RAM operations
- [ ] Verify round-trip RAM read/write correctness against c64u

## 4. Ram Snapshot Filename Specification
- [x] Implement ISO-8601 filename generation with optional sanitized context
- [x] Keep backward compatibility for loading older filenames
- [x] Add tests for filename formatting and context sanitization

## 5. Android UX Constraints
- [x] Confirm Android file picker usage remains native
- [x] Ensure filenames are meaningful without metadata reliance

## 6. Ram Dump Folder Display Path
- [x] Derive and persist a user-friendly display path for SAF tree URIs
- [x] Prevent content:// or DocumentsProvider prefixes in UI
- [x] Add unit tests for display path derivation
- [x] Add UI test coverage for Home page path rendering

## 7. Hvsc Download Crash And Ingestion Reliability
- [x] Identify and fix the download crash
- [x] Implement mock HVSC hosting via HVSC mock server + cache
- [x] Add config switch for HVSC base URL
- [x] Ensure ingestion reliability and guard against repeated downloads
- [x] Add logging across download, extract, and ingest
- [x] Add tests covering crash fix, mock download, ingestion, and no-real-host usage

## 8. Testing And Validation
- [x] Add tests for slider async behavior and final commit semantics
- [x] Add tests for value display show/hide and midpoint behavior + haptics gating
- [x] Add tests for RAM save/load round-trip and filename generation
- [x] Run unit tests, lint, and full build; fix any failures

## 9. Completion Criteria
- [ ] Verify all requirements satisfied and PLANS.md reflects completion
