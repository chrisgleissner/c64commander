# PLANS

## Problem summary
Playwright tests fail on this branch with repeated 404-related console errors, while main passes. Goal: isolate the branch-vs-main regression and apply the smallest fix that restores Playwright without regressing Web or iOS builds.

## Hypotheses from branch-vs-main diff
- [ ] A changed base path, route, or static asset URL causes missing resources in Playwright runtime.
- [ ] Vite/build config drift changed output paths referenced by HTML/test harness.
- [ ] Playwright config or web server startup changed and now serves from wrong root.
- [ ] A required asset/file was renamed/removed in this branch but still referenced.

## Concrete investigation steps
- [ ] Reproduce Playwright failure locally (or collect exact CI failure evidence if local is unreliable).
- [ ] Capture exact failing 404 URLs and request initiators.
- [ ] Compare this branch to `main` for HTML entry points, static asset references, Vite/build config, Playwright config, routing/base-path code.
- [ ] Identify single concrete causative change and validate reasoning.
- [ ] Implement minimal patch to correct resource path/serving behavior.
- [ ] Run targeted Playwright validation, then full Playwright suite.
- [ ] Run Web build and iOS build validation commands.
- [ ] Confirm no new unexpected console errors.

## Risk assessment
- Main risk is over-fixing by changing unrelated routing/build behavior; mitigate via surgical diff and focused verification.
- Secondary risk is environment instability for local Playwright/iOS tooling; if encountered, pivot to CI logs/artifacts and document pivot.
- Regression risk for Web/iOS if base path handling changes globally; mitigate via explicit build checks.

## Verification steps
- [ ] `npm run lint`
- [ ] `npm run test`
- [ ] `npm run build`
- [ ] `npm run test:e2e` (full Playwright suite) when feasible
- [ ] iOS build validation command used by repo (`npm run cap:build` and/or CI confirmation)
- [ ] CI checks: Playwright, Web, iOS green and no regressions

## Acceptance criteria checklist
- [ ] Root cause documented clearly in this file.
- [ ] Minimal corrective code change implemented.
- [ ] Playwright tests pass in CI.
- [ ] No unexpected console errors during Playwright tests.
- [ ] Web build succeeds in CI.
- [ ] iOS build succeeds in CI.
- [ ] No previously-green CI job regresses.
- [ ] This plan file reflects completed tasks and final verification status.

## Progress log
- [x] Replaced stale plan content with issue-specific execution plan and checklist.
