# PLANS.md

## 1. Problem Statement
- [x] Confirm where persistent blue focus/active styles originate
- [x] Identify where SID ON/OFF logic is implemented for UltiSid1/UltiSid2

## 2. Required Button Semantics (Global)
- [x] Audit shared button components and global styles for focus/active behavior
- [x] Define changes to ensure transient feedback only
- [x] Verify Play button exception scope

## 3. SID Section Fixes (Home Page)
- [x] Locate SID section UI and ON/OFF controls
- [x] Fix UltiSid1/UltiSid2 toggle behavior (REST + UI state)
- [x] Align SID ON/OFF styling to green/gray without blue persistence

## 4. Implementation Constraints
- [x] Implement root-cause fixes in shared components/styles
- [ ] Confirm no accessibility regressions
- [ ] Ensure consistency across Home, Play, and other pages

## 5. Verification Requirements
- [ ] Manually verify on Android emulator
- [ ] Add/update tests to prevent regressions
- [ ] Run full local test suite and build

## 6. Completion Criteria
- [ ] Confirm all requirements satisfied and PLANS.md updated
