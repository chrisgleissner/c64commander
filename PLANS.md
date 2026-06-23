# Menu ⇄ REST config mapping — adversarial hardening (2026-06-23)

Branch: `feat/align-ux-with-device-menu`. This file is the authoritative execution
plan for the adversarial review/cleanup of the "device-menu terminology + hierarchy
over a REST source-of-truth" feature. `WORKLOG.md` (repo root) carries the timestamped
evidence trail. Prior task content for this file lives in git history (last at
`6bfb766a`).

## 1. Scope boundaries

In scope:
- Adversarial review + cleanup of the menu⇄REST mapping: `src/lib/config/menuMapping/*`,
  `src/pages/config/*`, `src/pages/ConfigBrowserPage.tsx`, the compiler
  (`scripts/compile-menu-mapping.mjs`), association YAML, authoring helper
  (`scripts/menu-mapping/draft_association.py`), `.github/skills/menu-mapping-authoring/SKILL.md`,
  and the feature's unit/E2E tests + screenshots.
- Closing the named gaps (routing of `C64U Model` / `Tape Playback Rate`; `Disk swap delay`
  / `Loop delay` units; residual Advanced fallback; on-device validation disposition).
- Deterministic regression tests for every behavior change.

Out of scope (explicit):
- Broad UI redesign outside the config browser; firmware/REST contract changes;
  replacing the config edit pipeline; large dep upgrades; cosmetic churn outside
  touched areas; weakening tests to go green.
- Generic `details.format` rendering in the shared `ConfigItemRow` (see Phase 3 — it
  affects ~108 items across devices and is a separate, app-wide change).

## 2. Assumptions

- REST `GET /v1/configs` is the source of truth; menu hierarchy + terminology are
  presentation layers (confirmed in code: `projectConfigToMenu`, `resolveMenuMapping`).
- The captured `c64u-menu.yaml` is the label/structure authority for C64U 1.1.0; it is
  an extraction and may be incomplete (its own header says so). Items absent from it
  have no evidence-backed menu home.
- Only C64U has a captured hierarchy; U64/U64E/U2/unknown → REST-grouped layout.
- HIL hardware may be unavailable / C64U password-protected; that is an external
  blocker to record, not a pass.

## 3. Ordered phases

- P0 Baseline + evidence inventory (architecture map, baseline gates). — DONE
- P1 Verification matrix (lossless + write-back proofs across device/firmware/alias). — DONE
- P2 Advanced-routing adversarial review (resolve `C64U Model`, `Tape Playback Rate`,
  audit every keyword/default/sole-owner rule). — DONE
- P3 Unit/multiplier verification (`Disk swap delay`, `Loop delay`). — DONE
- P4 Overlay/label cleanup. — DONE (verified already-correct; minimal change)
- P5 Source pipeline + authoring cleanup (compiler/association/SKILL/draft helper). — DONE
- P6 UI integration review (hierarchy vs REST-grouped, aliases, hooks, residual). — DONE
- P7 E2E / screenshots / HIL. — IN PROGRESS (E2E run; HIL disposition recorded)
- P8 Cleanup + regression hardening. — DONE
- P9 Final validation loop. — IN PROGRESS
- P10 GitHub completion (commit / push / PR). — PENDING

## 4. Task checklist

- [x] Map real architecture; record in WORKLOG.
- [x] Baseline: `menu-mapping:check` + targeted unit tests green.
- [x] P2: remove evidence-less `categoryDefaults`; keep keyword + sole-owner tiers;
      route unplaceable leftovers to the labelled residual Advanced section.
- [x] P2: update `advancedRouting.test.ts`, `projectConfigToMenu.test.ts`,
      `ConfigBrowserPageMenuMode.test.tsx` to encode evidence-based routing.
- [x] P3: document verified units; add raw display+write-back regression test.
- [x] P1: confirm/extend matrix tests (later-firmware fallback, U64E null, U2 synthetic,
      never-seen category, alias, primary edit, Audio Mixer).
- [x] P4/P5: README + SKILL doc accuracy; `restKey` collision robustness; dead-code finding.
- [ ] P9: full unit suite + lint/typecheck/build + relevant E2E config specs.
- [ ] P7: screenshots if UI changed; HIL attempt or documented blocker.
- [ ] P10: commit, push, PR, converge.

## 5. Acceptance gates

- `menu-mapping:compile` succeeds; `menu-mapping:check` reports no drift.
- Targeted mapping + config-browser tests pass; full unit suite passes.
- `lint` (format + eslint + typecheck + drift checks) passes; `build` succeeds.
- Lossless invariant holds on every fixture: `renderedRestKeySet == liveRestKeySet`.
- Every edit writes the canonical REST `{category,item}` (PUT), aliases share one cell.
- Residual Advanced fallback is lossless, explicitly labelled, and tested.
- No known gap without a final disposition here + in WORKLOG.

## 6. Current status

P0–P6, P8 complete. Code + tests changed for P2 + P3. P9 (full gates) and P7/P10
(E2E/screenshots/HIL/PR) in progress. See WORKLOG for the evidence trail.

## 7. Open risks

- HIL on real C64U/U64 hardware may be blocked (no device / password) → recorded as an
  external dependency, not a pass.
- Moving `C64U Model` / `Tape` / `SoftIEC` / `Data Streams` into the residual Advanced
  section is a deliberate UX change from the prior "dissolve the drawer" goal; it is the
  evidence-based, lossless, honest placement (invariant #7). Trivially reversible per
  category if device-menu evidence later places one.
- Screenshots for the C64U config surface change (a residual Advanced section now exists);
  recapture is P5-priority.

## 8. Final disposition of every known gap

- **C64U on-device validation** — Disposition: attempted; recorded as the path + result
  in WORKLOG (external dependency if hardware/credentials unavailable). Not claimed as a
  pass unless a real probe ran.
- **`C64U Model` routing** — Was: `categoryDefaults["U64 Specific Settings"]="Video setup"`
  (only this item reached it; misleading — it is a hardware edition, not a video setting).
  Evidence: absent from `c64u-menu.yaml`; REST options BASIC Beige/Starlight/Founders.
  Disposition: removed the default → renders in the labelled residual **Advanced (REST-only)**
  section (lossless, canonical write-back, tested).
- **`Tape Playback Rate` routing** — Was: `categoryDefaults["Tape Settings"]="Built-in drive A"`
  (topically wrong — a cassette setting on the disk-drive page). Evidence: no Tape page in
  `c64u-menu.yaml`. Disposition: removed the default → residual Advanced section.
- **`Disk swap delay` units** — VERIFIED from REST schema `format: "%d00 ms"` (value×100 ms;
  min 1 max 10 → 100..1000 ms). The shared control ignores `details.format` app-wide (dead
  `mergedDetails` in `ConfigItemRow`), affecting ~108 items — a generic fix is out of scope.
  Disposition: value kept RAW; verified unit documented; regression test pins raw display +
  raw write-back. No invented multiplier in the menu layer.
- **`Loop delay` units** — VERIFIED from REST schema `format: "%d0 ms"` (value×10 ms; min 1
  max 20 → 10..200 ms). Same disposition as Disk swap delay.
- **Residual Advanced fallback** — Confirmed lossless + explicitly labelled
  ("Advanced (REST-only) settings"), self-hiding when empty. Now legitimately non-empty on
  C64U (holds `C64U Model`, SoftIEC, Tape, Data Streams). Tested.
