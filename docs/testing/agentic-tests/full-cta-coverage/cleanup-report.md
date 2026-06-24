# Full CTA Coverage — Cleanup Report

**Date:** 2026-06-24  
**Branch:** `test/full-cta-coverage`  
**Git SHA:** `41b0d368ca06d80f9ffc0e40f10a46e1b11fe380`  
**Device:** Pixel 4, serial `9B081FFAZ001WX`  
**Target:** C64U at hostname `c64u`

---

## Pre-Test Baseline (Gate 3 Confirmed)

The following connection settings were the established baseline, confirmed in Gate 3 artifact `cta-20260624T122143Z-pixel4-c64u-41b0d368ca06/gate3-result.json`:

| Field | Baseline Value | Resource ID |
|-------|---------------|-------------|
| Device Name | `U64` | `settings-device-name` |
| Host | `c64u` | `settings-device-host` |
| HTTP Port | `80` | `settings-device-http` |
| FTP Port | `21` | `settings-device-ftp` |
| Telnet Port | `23` | `settings-device-telnet` |
| Password | `pwd` | `password` |

---

## Mutations Applied (Gate 7)

Gate 7 applied and restored three connection mutations. Evidence in `cta-20260624T153459Z-pixel4-c64u-41b0d368ca06/`:

| Scenario | Field | Wrong Value | Correct Value | Restored? | Evidence |
|----------|-------|-------------|---------------|-----------|----------|
| G7-S1 | Host (`settings-device-host`) | `invalid-host` | `c64u` | YES — restoredConnected=true | `state-ledger-g7-s1.json` |
| G7-S2 | Password (`password`) | `wrongpwd` | `pwd` | YES — restoredConnected=true | `state-ledger-g7-s2.json` |
| G7-S3 | HTTP Port (`settings-device-http`) | `9999` | `80` | YES — restoredConnected=true | `state-ledger-g7-s3.json` |

All three scenarios tapped "Save & Connect" with the restored correct values and the app subsequently showed a Connected badge (`restoredConnected=true`).

---

## Other Settings Mutations

| Gate | Setting Mutated | Restored? | Evidence |
|------|----------------|-----------|----------|
| Gate 4 | Theme (Dark) | YES — auto-restored to Auto | `cta-20260624T123001Z-pixel4-c64u-41b0d368ca06/state-ledger.json`, `screenshots/restored.png` |
| Gate 5 | Theme (Dark, Light) + Display Profile (Small, Large) | YES — auto-restored to Auto each time | `cta-20260624T123633Z-pixel4-c64u-41b0d368ca06/` screenshots and gate5-result.json |
| Gate 6 | Screen Orientation (Portrait, Auto) | Auto — tapping Auto re-enables auto-rotation | `cta-20260624T150019Z-pixel4-c64u-41b0d368ca06/screenshots/orientation-portrait.png` |
| Gate 6 | Full Screen / Hide Status Bar (toggled ON then OFF) | YES — toggled off within same run | `cta-20260624T150019Z-pixel4-c64u-41b0d368ca06/` scroll-fullscreen-hide-statusbar-restore-scroll-0.xml |
| Gate 6 | Full Screen / Hide Navigation Bar (toggled ON then OFF) | YES — toggled off within same run | `cta-20260624T150019Z-pixel4-c64u-41b0d368ca06/screenshots/fullscreen-hide-navbar-restored.png` |

---

## Post-Test Device State

After Gate 7, the C64U connection settings are confirmed restored:
- **Host:** `c64u` (restored by G7-S1 + "Save & Connect")
- **Password:** `pwd` (restored by G7-S2 + "Save & Connect")
- **HTTP Port:** `80` (restored by G7-S3 + "Save & Connect")
- **FTP Port:** `21` (not mutated — unchanged from baseline)
- **Telnet Port:** `23` (not mutated — unchanged from baseline)
- **Theme:** `Auto` (restored at end of Gate 5 + Gate 4)
- **Display Profile:** `Auto` (restored at end of Gate 5)
- **Screen Orientation:** `Auto` (tapping Auto at end of Gate 6 orientation wave)
- **Full Screen options:** Unchecked (restored at end of Gate 6 fullscreen wave)

Connection status after restoration:
- `restoredConnected=true` confirmed by UIAutomator hierarchy content-desc on the app's connection badge (Gate 7 runner).
- Live readback at 2026-06-24T16:40Z (post-Gate-7): UIAutomator showed `settings-device-host text="c64u"`, `settings-device-http text="80"`, and `Connected=true` / `Offline=false`.

---

## Cleanup Status

**CLEAN** — All mutated settings have been restored to their baseline values. The device is in the same connection state as at the start of testing. No persistent side-effects remain.
