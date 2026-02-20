# PLANS

## Problem summary
Playwright failures on this branch were reported as repeated `404` console errors across many tests, while `main` was green. The goal is to identify the branch-vs-main regression and apply the smallest fix without degrading Web or iOS builds.

## Hypotheses from branch-vs-main diff
- [x] A changed static asset URL in HTML entry points causes missing resources under some serving contexts.
- [ ] Playwright config drift causes wrong server root.
- [ ] Vite/build config drift causes missing build outputs.
- [ ] Test config drift causes incorrect routing/base path.

## Concrete investigation steps
- [x] Attempt local Playwright reproduction and collect context.
- [x] Investigate CI failures via GitHub Actions logs/artifacts (run `22214394010`).
- [x] Compare branch vs `main` in key files (HTML entry points, static assets, build/test config).
- [x] Isolate likely causative diff and apply minimal corrective patch.
- [x] Re-run local verification (build + Playwright + Capacitor sync).

## CI/infra pivot note
Local full Playwright suite is green after browser install, so exact CI-only 404 URL could not be deterministically reproduced locally. I pivoted to CI diagnostics using GitHub Actions logs/artifacts as required.

## Root cause analysis
CI logs for Android workflow run `22214394010` show repeated failures from Playwright’s console guard:
`Unexpected warnings/errors during test: console error: Failed to load resource: the server responded with a status of 404 (Not Found)`.

The branch-vs-main entrypoint diff adds new PWA links in `index.html` and a new `public/manifest.webmanifest`. Those links were hard-coded as root-absolute paths (`/manifest.webmanifest`, `/c64commander.png`) and the manifest also used root-absolute fields (`start_url: "/"`, `icons[].src: "/c64commander.png"`). This is the only static-asset entrypoint delta in the failing branch and is the most probable source of repeated 404s under non-root/base-path serving contexts.

## Minimal fix implemented
- Updated `index.html`:
  - `apple-touch-icon` now uses `%BASE_URL%c64commander.png`
  - `manifest` link now uses `%BASE_URL%manifest.webmanifest`
- Updated `public/manifest.webmanifest`:
  - `start_url` from `"/"` to `"."`
  - icon `src` from `"/c64commander.png"` to `"c64commander.png"`

These are surgical path corrections only; no test guard weakening, no unrelated refactor.

## Risk assessment
- Low risk: changes only affect static asset URL resolution for manifest/icon metadata.
- Benefit: avoids root-path assumptions and aligns with Vite base-path semantics.

## Verification steps and status
- [x] `npm run lint`
- [x] `npm run build`
- [x] `npm run test:e2e` (full suite; local) — `337 passed`
- [x] `npm run cap:build` (web build + Android/iOS sync path)
- [ ] CI Playwright/Web/iOS green confirmation (pending fresh CI run on this branch)
- [ ] `npm run test` and `npm run test:coverage` fully green in this sandbox
  - Blocked by external DNS/network for HVSC fixture host (`hvsc.brona.dk`), unrelated to this change.

## Acceptance criteria checklist
- [x] Root cause documented in this file.
- [x] Minimal corrective change implemented.
- [ ] Playwright tests pass in CI (pending CI rerun).
- [ ] No unexpected console errors in CI Playwright (pending CI rerun).
- [ ] Web build succeeds in CI (pending CI rerun).
- [ ] iOS build succeeds in CI (pending CI rerun).
- [ ] No previously-green CI job regresses (pending CI rerun).
- [x] `PLANS.md` updated with execution trace and current verification state.
