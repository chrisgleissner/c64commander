# CTA Coverage Certification — Execution Plan

## Current Gate

**PROGRAM COMPLETE — CERTIFY** (2026-06-24)

All gates 0-7 + 6.5 PROVEN. Code modularization complete. See `docs/testing/agentic-tests/full-cta-coverage/final-report.md` and `cleanup-report.md`.

## Proven State (Final)

- Branch: `test/full-cta-coverage` @ `41b0d368ca06d80f9ffc0e40f10a46e1b11fe380`
- Pixel 4: serial `9B081FFAZ001WX`, Android 16, SDK 36 — DroidMind-controllable
- C64U: host=c64u, HTTP=80, FTP=21, Telnet=23, pwd — Connected, live readback confirmed 2026-06-24T16:40Z
- Gates PROVEN: 0, 1, 2, 3, 4, 5, 6, 6.5, 7
- `npm run scope:check`: 51 files, 349 tests, all PASS (last: 2026-06-24T18:13Z)
- **CERTIFICATION STATUS: CERTIFY**

## Nothing Remaining

## Commands To Run

```bash
# Build and check
npm run scope:check

# Gate 3 HIL execution
npm run scope:cta:gate3 -- --serial 9B081FFAZ001WX --target c64u \
  --case CTA-GATE3-C64U-SAVE-CONNECT --settle-ms 1800 --start-app
```

## Expected Artifacts

Under `c64scope/artifacts/cta-<UTC>Z-pixel4-c64u-<sha>/`:
- `environment.json`
- `mcp-capabilities.json`
- `gate3-result.json` — PROVEN or BLOCKED + connection status
- `gate3-summary.md` — human-readable summary
- `replays/CTA-GATE3-C64U-SAVE-CONNECT.json`
- `screenshots/pre-action.png`
- `screenshots/settings-initial.png`
- `screenshots/settings-host-before.png`
- `screenshots/settings-host-after.png`
- `screenshots/pre-save-connect.png`
- `screenshots/post-save-connect.png`
- `hierarchies/settings-initial.xml`
- `hierarchies/settings-host-before.xml`
- `hierarchies/settings-host-after.xml`
- `hierarchies/post-save-connect.xml`

## Safety And Cleanup

- No C64-bound mutation in Gate 3: host change is saved in app only.
- If BLOCKED: preserve failure screenshots and hierarchy, record blocker in ledger.
- Restore: if Gate 3 fails mid-way and the host was partially changed, navigate to
  Settings and restore host to `192.168.1.167`.

## Open Blockers

1. Gate 3 target resolution pending HIL execution.
2. C64Bridge points at VICE (not needed for Gate 3).
3. Capture infrastructure unknown (not needed for Gate 3).

## Completion Criteria

Gate 3 is complete when ONE of:
A) `gate3-result.json` shows `status: "PROVEN"` with screenshots showing host=c64u
   and app-visible connection status confirming C64U target identity.
B) `gate3-result.json` shows `status: "BLOCKED"` with failure screenshots, exact
   failure point, and fallback decision (U64 or continue).

---

# Prior Plan: Menu ⇄ REST config mapping — adversarial hardening (2026-06-23)

Branch: `feat/align-ux-with-device-menu`. Prior task content.
Evidence trail at `WORKLOG.md`. Last commit at `6bfb766a`.

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
- P11 Performance: measure config-section expansion latency (collapse→all-items-rendered)
  and remove the bottleneck without hacks or benchmark-gaming. — DONE. Diagnosed the per-row
  N+1 option-fetch storm (device returns scalars; no bulk endpoint) and that the per-row read
  ignored the existing persistent firmware-namespaced enrichment cache. Fix: made `ConfigItemRow`
  serve firmware-static options synchronously from that cache, falling back to the network only
  on a miss. On-device (real C64U): Modems 7988→223 ms, Printers 821→277 ms, User interface
  880→348 ms; outliers/timeouts eliminated. Regression test added; gates green.

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

- HIL: RESOLVED — validated on real U64E (REST-grouped path) AND real C64U (menu mode +
  residual Advanced section), incl. the live-only ARMSID unknown-category proof. The c64u
  exhibits intermittent overload drop-outs (documented; recovered via Retry), not a regression.
- Moving `C64U Model` / `Tape` / `SoftIEC` / `Data Streams` into the residual Advanced
  section is a deliberate UX change from the prior "dissolve the drawer" goal; it is the
  evidence-based, lossless, honest placement (invariant #7). Trivially reversible per
  category if device-menu evidence later places one.
- Screenshots for the C64U config surface change (a residual Advanced section now exists);
  recapture is P5-priority.

## 8. Final disposition of every known gap

- **C64U on-device validation** — Disposition: **PASSED** on real hardware. Hardening APK
  (`0.8.9-6f367`) built+installed to Pixel `9B081FFAZ001WX`, connected to the real C64U
  (firmware 1.1.0, password supplied by the user and handled without leaking it). Config
  renders the menu hierarchy + the residual **Advanced (REST-only)** section containing
  C64U Model (Starlight Edition), SoftIEC, Tape Playback Rate (0.98 MHz PAL), Data Streams,
  AND the live-only **ARMSID in Socket 1/2** categories (absent from every fixture) —
  proving the unknown-category invariant on real hardware. The c64u flaked once on handover
  (documented overload drop-out); a Retry recovered to HEALTHY. Evidence PNGs in the session
  scratchpad. See WORKLOG P7.
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
