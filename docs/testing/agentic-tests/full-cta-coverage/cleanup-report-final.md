# Cleanup Report — final-bugfree run (HEAD fe212a59 / 0.9.0-rc1-fe212)

UTC: 2026-06-26 (session 06:30–~09:2xZ). Pixel 4 `9B081FFAZ001WX`, target c64u.

## Final device + app state (verified)

- App: connected to **c64u**, badge **HEALTHY**, route Home, App `0.9.0-rc1-fe212` (vc2036, SHA 56ec881f).
- c64u: **HTTP 200** (/v1/info authed, ~0.01s) + **FTP 226** (~0.08s) + ICMP alive — fully healthy.
- Drive A: ON / 1541 / **No disk mounted**. Drive B: OFF / **No disk mounted**.
- Playlist: **empty** (fresh install; the 3 test SIDs from earlier were on a prior install that was uninstalled during rebuilds).
- Settings: Appearance restored to **Auto** (toggled Dark→Auto during the theme check). Display profile / Orientation untouched (Auto). No orientation change made (avoided the Landscape trap).
- Saved device: **c64u** (host c64u / pwd / 80 / 21 / 23) — this is the desired baseline, retained.

## Mutations made this session and their disposition

| Mutation | Restored? |
| --- | --- |
| Installed APK (baseline → 0.9.0-rc1 → 0.9.0-rc1-fe212 cascade-cut build) | Current build is the intended one (HEAD + 3 fixes); intentional |
| Added 3 test SIDs to playlist (early) | Gone (install wiped by later rebuild); playlist empty |
| Songlengths file auto-selected on the wiped install | Gone with the install |
| Appearance theme Dark (test) | **Restored to Auto** |
| Saved c64u device (re-added via discovery after uninstalls) | Retained (desired baseline) |
| No Config values written; no disks mounted; no orientation/display changes | n/a (none made) |

## Residual differences vs a pristine first-run

- The app has the **three uncommitted source fixes** built in (health-poll, songlengths no-timeout, FTP cascade cut). This is the point of the session — intentional. Working tree is dirty (see status report); **no commit was made** (none requested).
- The c64u was **power-cycled twice by the user** during the session (songlengths FTP wedge). It is healthy now.

## Cleanup status

**Clean.** No test residue requiring removal (playlist empty, no disks mounted, no config/orientation/display changes, theme restored). Device left connected + healthy. The only non-pristine items are intentional (the fixed build + the saved c64u baseline).
