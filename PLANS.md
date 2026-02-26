# Connection Status Pop-up Layout Correction Plan

- [x] Check latest GitHub Actions workflow runs and inspect failing job logs.
- [x] Refine pop-up to strict two-group structure with spacing-only separation and no nested visual surfaces.
- [x] Promote the `C64U`/`C64U Demo` heading to the largest typography in the panel.
- [x] Move non-editing `Host` + `Change` control onto one inline row while preserving edit flow behavior.
- [x] Enforce `Last request: …` line contract directly (without extra wrapper label text).
- [x] Remove diagnostics row indentation/surface styling while keeping deterministic navigation.
- [x] Align close/transition behavior with diagnostics modal patterns and cover it in Playwright.
- [x] Update unit + Playwright tests for revised layout and interaction contracts.
- [x] Refresh screenshot output for the Connection Status pop-up and keep docs references correct.
- [x] Run full validation (`npm run test`, targeted Playwright, `npm run lint`, `npm run build`, `npm run test:coverage`).
- [x] Run `code_review` then `codeql_checker` and address findings.
- [ ] Reply to the new PR comment with commit hash + screenshot.
