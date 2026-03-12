# REST Interaction Hardening Plan

## Audit Findings

- [x] Request identity already canonicalizes query parameters in [`src/lib/deviceInteraction/restRequestIdentity.ts`](/home/chris/dev/c64/c64commander/src/lib/deviceInteraction/restRequestIdentity.ts) via `canonicalizeRestPath()` and `buildRestRequestIdentity()`.
- [x] `src/lib/c64api.ts` also canonicalizes query parameters for its GET dedupe key via `normalizeUrlPath()`.
- [x] `src/lib/c64api.ts` only enables its local inflight dedupe / replay budget for read-only methods.
- [ ] `src/lib/deviceInteraction/deviceInteractionManager.ts` still reuses `restInflight` for mutation policy keys, so overlapping writes can coalesce incorrectly in production.
- [ ] `src/lib/deviceInteraction/deviceInteractionManager.ts` keeps short-lived REST cache entries after successful writes, so cached `GET /v1/configs` can survive a `PUT` or `POST`.
- [ ] `src/lib/deviceInteraction/deviceInteractionManager.ts` performs cooldown/backoff sleeps inside the REST scheduler task, which can occupy the single REST slot before the real request starts.
- [x] `src/pages/playFiles/hooks/useVolumeOverride.ts` uses a latest-intent write lane plus immediate writes; transport-level correctness depends on writes never coalescing and cache invalidation staying correct.
- [x] Existing circuit-breaker logic appears bounded by time and success resets, but it still needs regression coverage alongside the scheduler changes.

## Implementation Tasks

- [x] Phase 1: audit REST identity, dedupe, cache, scheduler, slider write path, and circuit-breaker behavior.
- [ ] Phase 2: harden request identity tests where needed, without refactoring the architecture.
- [ ] Phase 3: prevent write coalescing in the shared REST interaction manager.
- [ ] Phase 4: add targeted REST cache invalidation on successful writes.
- [ ] Phase 5: remove self-blocking scheduler sleeps while keeping REST concurrency at `1`.
- [ ] Phase 6: add deterministic regression tests for:
  - identical GET burst coalescing
  - query-sensitive GET separation
  - cache invalidation after writes
  - slider-style ordered write bursts
  - scheduler non-stall behavior
- [ ] Phase 7: run required validation:
  - targeted unit tests
  - `npm run test:coverage`
  - `npm run lint`
  - `npm run build`
  - `./build`

