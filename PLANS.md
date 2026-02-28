# Diagnostics Target Rendering Plan

## 1. Scope

- Refine user-facing diagnostics target labels only.
- Remove the word `mock` from diagnostics target rendering.
- Keep transport/event payload values unchanged (`internal-mock`, `external-mock`, `real-device`).
- Keep rendering concise, lowercase, deterministic, and screenshot-safe.

## 2. Non-Goals

- No changes to networking, REST/FTP routing, or connection selection logic.
- No changes to trace serialization/deserialization semantics.
- No changes to test harness target emission values.
- No migration of existing logs/traces.

## 3. Mapping Specification

- `internal-mock` → `demo`
- `external-mock` → `sandbox`
- `real-device` + known product (`c64u`, `u64`, `u64e`, `u64e2`) → normalized product token
- `real-device` + missing/unknown product → `device`
- Legacy `mock` input (display-only compatibility) → `demo`
- Legacy direct known product target values pass through normalized lowercase.

## 4. Refactoring Strategy

- Introduce a dedicated mapper module: `src/lib/diagnostics/targetDisplayMapper.ts`.
- Route `formatActionEffectTarget` through this mapper.
- Remove legacy display fallback values `mock` and `c64`.
- Keep behavior localized to rendering functions and UI consumers.

## 5. Test Strategy

- Update unit tests for `formatActionEffectTarget` to match new labels.
- Add dedicated mapper unit tests covering all required mapping branches.
- Add regressions:
	- rendered output never equals `mock`
	- unknown real-device product maps to `device`
- Add/adjust Playwright diagnostics assertions for `demo`/`sandbox`/`device` text in expanded effects.

## 6. Risk Analysis

- Risk: legacy traces carrying `mock` could leak old wording.
	- Mitigation: explicit legacy mapping `mock` → `demo`.
- Risk: product alias normalization could regress known hardware labels.
	- Mitigation: table-driven mapper tests for canonical + alias inputs.
- Risk: screenshot drift.
	- Mitigation: constrain assertions to target text and keep all other rendering unchanged.

## 7. Completion Checklist

- [ ] `mock` removed from diagnostics target display output.
- [ ] `internal-mock` renders `demo`.
- [ ] `external-mock` renders `sandbox`.
- [ ] Known products render `c64u`/`u64`/`u64e`/`u64e2`.
- [ ] Unknown/missing product for `real-device` renders `device`.
- [ ] Unit tests updated and passing.
- [ ] Playwright coverage updated and passing.
- [ ] Lint/build/test/coverage/build helper checks run and passing.
