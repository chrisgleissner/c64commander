# Diagnostics Overlay Convergence Plan

Status: IN PROGRESS
Classification: UI_CHANGE + DOC_PLUS_CODE
Date: 2026-03-21

## Phase 1 - Plan

- [x] Simplify healthy state
- [x] Fix unhealthy state clarity
- [x] Restructure summary
- [x] Enforce disclosure layers
- [x] Remove duplication
- [x] Remove early technical detail
- [x] Improve drill-down clarity
- [x] Implement overlay layering rules
- [x] Add focus headers
- [x] Add scope labels
- [ ] Validate all acceptance criteria

## Phase 2 - Implement Target Spec

- [ ] Make healthy first-open state summary-only with one optional action
- [ ] Make unhealthy first-open state show contributor, issue, and one dominant action
- [ ] Collapse summary into one coherent block in fixed order
- [ ] Hide layer 2 and layer 3 content until explicit user intent
- [ ] Remove duplicated counts, timestamps, and repeated signals
- [ ] Keep raw technical lines out of the default view
- [ ] Add focused purpose and interpretation lines to drill-downs
- [ ] Distinguish base overlay, inline expansion, and nested analytic overlay visually
- [ ] Add nested overlay return-anchor headers
- [ ] Show conditional scope labels only for focused or filtered states
- [ ] Enforce deterministic back navigation order

## Phase 3 - Validation

- [ ] Test 1 - Healthy state
- [ ] Test 2 - Unhealthy state
- [ ] Test 3 - Progressive disclosure
- [ ] Test 4 - Duplication
- [ ] Test 5 - Summary coherence
- [ ] Test 6 - Overlay layering
- [ ] Test 7 - Back navigation

## Acceptance Criteria

- [ ] All target spec rules satisfied
- [ ] All validation tests pass
- [ ] PLANS.md fully completed
- [ ] WORKLOG.md complete
- [ ] No duplicated UI signals remain
- [ ] Healthy state is calm and minimal
- [ ] Progressive disclosure strictly enforced
- [ ] Overlay hierarchy is unambiguous