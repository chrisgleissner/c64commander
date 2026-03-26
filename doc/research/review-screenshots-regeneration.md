# Screenshot Regeneration Review

Date: 2026-03-26
Classification: DOC_PLUS_CODE
Rule set: git metadata plus deterministic regeneration only

## Scope

- All PNG screenshots under `doc/img/app/`
- References from `README.md`, `doc/**/*.md`, and `docs/**/*.md`
- Screenshot generator logic in `playwright/screenshots.spec.ts`
- Home slice planning in `playwright/homeScreenshotLayout.ts`

Image contents were not inspected during this review. Decisions were based on path inventory, git history, reference scanning, and deterministic regeneration runs.

## Inventory and Git-Date Classification

- Total tracked screenshots under `doc/img/app`: `149`
- Screenshots already dated `2026-03-26` by git history before regeneration: `42`
- Screenshots classified as outdated and deleted for regeneration: `107`

## Regeneration Actions

1. Audited the existing screenshot pipeline and identified image-decoding comparison logic that would violate the no-image-access constraint for this task.
2. Added a force-regeneration path in `playwright/screenshots.spec.ts` so screenshots can be recreated without loading prior PNGs.
3. Deleted the stale screenshot corpus under `doc/img/app` and regenerated the suite output from Playwright.
4. Verified screenshot-test coverage still existed for the full documented surface area.
5. Extended Home screenshot generation so the top-level `README.md` canonical storytelling assets are recreated exactly.
6. Fixed Home section capture to scroll and measure the active swipe-slot container instead of `window`.
7. Added canonical Home slice selection in `playwright/homeScreenshotLayout.ts` plus a regression test in `tests/unit/playwright/homeScreenshotLayout.test.ts`.
8. Cleaned stale doc references so live Markdown does not point at nonexistent screenshot paths.

## Canonical README Contract

The top-level `README.md` screenshot set was treated as mandatory output.

Final result:

- Missing `README.md` screenshot paths after regeneration: `0`

The Home storytelling section now deterministically recreates these canonical files:

- `doc/img/app/home/sections/01-system-info-to-cpu-ram.png`
- `doc/img/app/home/sections/02-quick-config-to-keyboard-light.png`
- `doc/img/app/home/sections/03-quick-config-to-printers.png`
- `doc/img/app/home/sections/04-printers-to-sid.png`
- `doc/img/app/home/sections/05-sid-to-config.png`

## Live Documentation Reference Check

After cleanup, the live Markdown reference scan found:

- Real missing screenshot paths in `README.md`, `doc/**/*.md`, and `docs/**/*.md`: `0`

One historical audit note and one placeholder path in developer documentation were updated so they no longer look like broken screenshot references.

## Validation Performed

- Re-ran the Home screenshot capture after the container-scroll fix and after canonical slice selection.
- Ran `tests/unit/playwright/homeScreenshotLayout.test.ts` and confirmed the canonical selector regression coverage passed.
- Re-ran the path-only `README.md` screenshot existence check and confirmed zero missing files.
- Re-ran the live Markdown screenshot reference scan and confirmed zero real missing paths.

## PASS / FAIL Checklist

- PASS: Every outdated screenshot was removed before regeneration.
- PASS: Regeneration was performed without inspecting image contents.
- PASS: The screenshot suite now recreates the canonical `README.md` Home section assets.
- PASS: Live documentation references resolve to existing screenshot paths.
- PASS: Regression coverage was added for Home canonical slice selection.
- PENDING: Commit, push, and CI remediation are handled in the follow-up closure phase.
