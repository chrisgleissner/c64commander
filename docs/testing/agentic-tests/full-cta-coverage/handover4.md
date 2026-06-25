# Full CTA Coverage — Handover 4

## Role

You are the Principal Android QA Engineer continuing the C64 Commander Full-CTA Coverage certification program. Read everything in this document before touching any tools.

---

## Where We Are

Gates 0–5 are fully PROVEN. Gate 6 is IN_PROGRESS with a partial run (10/15 PASS).

| Gate | Status | Artifact |
|------|--------|----------|
| 0 — Smoke + MCP capabilities | PROVEN | `cta-20260624T105207Z-pixel4-c64u-41b0d368ca06/` |
| 1 — Runtime CTA discovery (all 6 tabs + Licenses) | PROVEN | `cta-discover-20260624T111144Z/` |
| 2 — Keypad canary (digits 1-6 tabs, KEY_*, KEY_#, D-pad) | PROVEN | `cta-20260624T113125Z-pixel4-c64u-41b0d368ca06/` |
| 3 — App-driven Save-and-Connect to c64u | PROVEN | `cta-20260624T122143Z-pixel4-c64u-41b0d368ca06/` |
| 4 — Reversible mutation canary (theme Auto→Dark→Auto) | PROVEN | `cta-20260624T123001Z-pixel4-c64u-41b0d368ca06/` |
| 5 — Generic R0/R1 contracts (12/12: 6 tab nav + 3 theme + 3 display-profile) | PROVEN | `cta-20260624T123633Z-pixel4-c64u-41b0d368ca06/` |
| 6 — Page coverage waves | IN_PROGRESS | `cta-20260624T124831Z-pixel4-c64u-41b0d368ca06/` (10/15 PASS) |
| 7 — Risky/destructive scenarios | NOT_STARTED | — |
| 8 — Final HIL certification | NOT_STARTED | — |

---

## Device and Network Facts

| Item | Value |
|------|-------|
| Pixel 4 serial | `9B081FFAZ001WX` |
| Android | 16 / SDK 36 |
| App package | `uk.gleissner.c64commander` |
| C64U hostname | `c64u` / `192.168.1.167` |
| C64U password | `pwd` |
| U64 hostname | `u64` / `192.168.1.13` |
| Screen (portrait) | 1080×2280 px |
| SAFE_TAP_MAX_Y | 1990 (below bottom tab bar which starts at y=1993) |
| `scrollDown` | `swipe(540, 1700, 540, 650, 300)` — finger UP → content moves UP → items move to smaller y → lower items come into view |
| scroll to top | `swipe(540, 650, 540, 1700, 250)` — finger DOWN → content moves DOWN → top of list comes into view |

Screen geometry (Pixel 4):
- App content area: y=0 to y≈1993
- App bottom tab bar: y=1993 to y=2148
- System nav bar: y=2148 to y=2280

---

## Keypad Mapping (proven in Gate 2)

| Key event code | Tab |
|---------------|-----|
| 8 (KEY_1) | HOME |
| 9 (KEY_2) | PLAY |
| 10 (KEY_3) | DISKS |
| 11 (KEY_4) | CONFIG |
| 12 (KEY_5) | SETTINGS |
| 13 (KEY_6) | DOCS |
| 17 (KEY_*) | Opens Diagnostics overlay from any page |
| 3 (KEYCODE_HOME) | Android HOME — goes to launcher, dismisses notification shade + Quick Settings |
| 4 (KEYCODE_BACK) | Android BACK |
| 123 (KEYCODE_MOVE_END) | Moves cursor to end of text field |
| 67 (KEYCODE_DEL) | Backspace/delete in text field |

---

## Non-Negotiable Constraints

These apply to EVERY action in this session. Violating any of them voids the gate's evidence.

1. **Product Android actions must go through DroidMind via `DroidmindClient`**. The client is at `c64scope/src/validation/droidmindClient.ts`. Every tap, key press, swipe, text input, screenshot, UIAutomator capture must go through `DroidmindClient` methods.

2. **Do not use raw ADB, raw UIAutomator, Playwright/CDP, Maestro, DOM mutation, localStorage mutation, or coordinate-only random clicking** as product-action paths. Raw ADB is permitted ONLY for infrastructure evidence (device identity, logcat, file staging, bootstrap checks).

3. **Do not claim a gate is PROVEN from historical claims, static docs, or demo behavior**. PROVEN requires an existing artifact path in `c64scope/artifacts/` with a `gate*-result.json` or `coverage.json` containing `"status": "PASS"` records produced by `toCoverageJson()`.

4. **Do not merge C64U and U64 evidence**. Artifacts for c64u and u64 must remain separate. `--target=c64u` must appear in every runner invocation.

5. **`CALIBRATION_ONLY` does not count as coverage proof**. `PASS` is the only status that counts.

6. **`npm run scope:check` must pass (51 files, 349 tests) after any code change before running a gate**.

---

## First Action: Gate 6 Second Run

The Gate 6 runner (`c64scope/src/ctaGate6.ts`) has been updated with three fixes since the partial run:

1. **Docs accordion fix**: `scrollUntilInSafeZone()` now keeps scrolling until the item is both visible AND at y≤1990. Items in forward order without resetting scroll between items. "Disks & Drives" (not "Disks") search text.
2. **Landscape rotation avoided**: Only "Portrait" and "Auto" are tested; "Landscape" causes physical device rotation which breaks scroll geometry.
3. **Fullscreen checkboxes**: `launchFresh()` (HOME + startApp) before the fullscreen wave guarantees portrait mode before searching for `full-screen-hide-status-bar` and `full-screen-hide-navigation-bar`.

### Run Gate 6 (second attempt):

```bash
npm run scope:check                                                                           # must pass 51/51 first
npm run scope:cta:gate6 -- --serial 9B081FFAZ001WX --target c64u --start-app --settle-ms 1800
```

Expected: ≥15/18 PASS across docs items (8), diagnostics (2), home (1), settings-orientation (2), settings-fullscreen (2), home-tabs (up to 2 if PORTS/VIDEO found).

If checkboxes still show [0,0][0,0] bounds after the HOME + startApp reset, note in the ledger that the fullscreen section requires deeper scrolling or has conditional rendering — it's a spec gap, not a regression.

### PROVEN criteria for Gate 6:

Gate 6 is PROVEN when the second-run artifact has a `coverage.json` with ≥10 PASS records across at least 3 distinct featureIds. Record the artifact path in the progress ledger under Gate 6.

---

## Docs Page Layout (from docs-initial.xml)

All items are `android.widget.Button` clickable=true at initial scroll-to-top position:

| Text | Bounds (initial, top of page) | center Y |
|------|-------------------------------|----------|
| Getting Started | [24,297][1056,500] | 398 |
| Home | [24,547][1056,748] | 647 |
| Play Files | [24,797][1056,998] | 897 |
| Disks & Drives | [24,1045][1056,1248] | 1146 |
| Swapping Disks | [24,1295][1056,1498] | 1396 |
| Config | [24,1545][1056,1746] | 1645 |
| Settings | [24,1795][1056,1996] | 1895 |
| Diagnostics | [24,2043][1056,2246] | 2144 (behind tab bar — needs scrollDown) |

**Critical**: Tapping "Getting Started" expands an accordion IN-PLACE, pushing all subsequent items DOWN by ~1500px. "Home" moves from y=647 to y=2043; "Play Files" to y=2235+. The updated `scrollUntilInSafeZone()` handles this by scrolling until each item arrives at y≤1990.

---

## Settings Page Findings

### Known IDs and positions (portrait, top of page):
- Theme buttons (Appearance section): Auto at [88,440][376,657], Light at [396,440][684,657], Dark at [704,440][990,657] — already PROVEN in Gate 5
- Display profile buttons: Auto/Small display/Standard display/Large display — PROVEN in Gate 5
- Screen Orientation: "Portrait", "Landscape", "Auto" — below display profile section
- Full Screen section: resource-id `full-screen-hide-status-bar` and `full-screen-hide-navigation-bar` — below screen orientation section; requires 4+ scrollDown from top to reach
- Connection section: host field (`resource-id` contains "host"), password field (`resource-id="password"`), port fields

**Warning on "Landscape" orientation**: Tapping "Landscape" in the app Settings physically rotates the Pixel 4 to landscape (screen becomes 2280×1080). SAFE_TAP_MAX_Y=1990 is INVALID in landscape. The updated Gate 6 runner avoids "Landscape" and only tests "Portrait" + "Auto".

---

## State of Runners

| Script | Source | Status |
|--------|--------|--------|
| `npm run scope:cta:gate3 -- --serial ... --target c64u --start-app` | `c64scope/src/ctaGate3.ts` | PROVEN |
| `npm run scope:cta:gate4 -- --serial ... --target c64u --start-app` | `c64scope/src/ctaGate4.ts` | PROVEN |
| `npm run scope:cta:gate5 -- --serial ... --target c64u --start-app --settle-ms 1800` | `c64scope/src/ctaGate5.ts` | PROVEN (12/12) |
| `npm run scope:cta:gate6 -- --serial ... --target c64u --start-app --settle-ms 1800` | `c64scope/src/ctaGate6.ts` | UPDATED — needs second run |

All scripts are wired in both `c64scope/package.json` and root `package.json`.

---

## Gate 7 (After Gate 6 is PROVEN)

Gate 7 covers risky/destructive scenarios. These must be planned with an explicit scenario manifest before execution. Before writing Gate 7 code:

1. Read the Gate 4 state-ledger pattern: `c64scope/artifacts/cta-20260624T123001Z-pixel4-c64u-41b0d368ca06/state-ledger.json`
2. Write a scenario manifest listing each scenario, its R-level (R0–R4), what it mutates, and the restoration procedure
3. Only proceed with scenarios once the manifest is approved (user must acknowledge)

Candidate Gate 7 scenarios (NOT exhaustive — derive from spec):
- Connection to invalid host → verify error state → restore to c64u
- Port number change → verify connection fails → restore original port
- Factory reset / clear settings (if available in app — check first)

**Gate 7 is NOT in scope for this session if Gate 6 is not yet PROVEN**. Complete Gate 6 first.

---

## Gate 8 (After Gate 7)

Gate 8 is the final HIL certification: produce a `final-report.md` summarising all gate evidence, a `cleanup-report.md` confirming the device was restored to the initial c64u/pwd state, and a release decision (CERTIFY / CONDITIONAL / REJECT).

---

## UIAutomator Parsing Notes

- XML is SINGLE LINE — split on `<node ` not `\n`
- `[0,0][0,0]` bounds = element exists in hierarchy but is off-screen or not laid out → `isVisible()` returns false → keep scrolling
- `resource-id` for masked/password fields: `text=""` even when populated — rely on cursor movement + DEL + inputText to set value, not on reading the text back
- Landscape mode indicator: top-level node bounds = `[0,0][2280,1080]` (width > height)

---

## Progress Ledger

Always read `docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md` at the start of each session and update it after each proven gate. The ledger is the authoritative source of truth.

---

## Session Handover Protocol

At ~85-90% session usage, write `handover5.md` to `docs/testing/agentic-tests/full-cta-coverage/` and schedule via:

```bash
llm-scheduler --tool claude --prompt-file docs/testing/agentic-tests/full-cta-coverage/handover5.md --suspend-until-ready
```

---

## First Three Actions (in order)

1. `cat docs/testing/agentic-tests/full-cta-coverage/runs/progress-ledger.md` — read current state
2. `npm run scope:check` — confirm 51/51 pass before running any gate
3. `npm run scope:cta:gate6 -- --serial 9B081FFAZ001WX --target c64u --start-app --settle-ms 1800` — Gate 6 second run
