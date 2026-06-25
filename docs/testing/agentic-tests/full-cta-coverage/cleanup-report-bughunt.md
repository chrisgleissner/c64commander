# Cleanup Report — bughunt-20260625T164637Z (HEAD b86877f4 + keep-alive fix)

Final state captured 2026-06-25 after the S1 root-cause/fix session.

## App + device final state (verified)

- App: **Connected to c64u, system healthy** (badge green).
- Installed APK: `0.8.9-b8687`, versionCode 2047 (**fixed build**, SHA-256 `2ffb16450416dd08ff8994f39040e0dee7fd1b5600167206b12cf66c6c33072f`).
- Drive A: **ON / No disk mounted / status OK**; Drive B: OK. Device `/v1/drives`: Drive A `enabled:true, image_file:'', errors:[]`.
- Device `/v1/info`: `c64u`, `C64 Ultimate`, fw `1.1.0`, `errors:[]`.
- Selected device: `c64u` (no accidental switch from the Device Switcher test). Connection settings untouched (host c64u / HTTP 80 / FTP 21 / Telnet 23).

## Mutations made this session and their restoration

| Mutation | Restored? | Note |
|---|---|---|
| Drive A mount Boulder Dash 2.d64 (readonly) → eject | ✅ ejected, `image_file:''` | S1 fix verification. Drive left clean. |
| Display profile (found on **"Small display"**) → set to **Auto** | ✅ Auto | Pre-existing drift (not set by me); restored to documented baseline. |
| Installed APK cf84d → b8687(fixed) | n/a | Intentional: the fixed build is the correct end state. |
| Reformatted 2 pre-existing prettier-dirty files (UnifiedHealthBadge.tsx, DriveManager.tsx) | n/a | Whitespace-only; unblocked the lint gate (see report finding). |

## Residual differences (explained)

1. **"Hide status bar" = checked** (Settings → Full screen). **Pre-existing** (not changed this session). Left as-is to avoid flipping an untouched user preference; flagged for owner confirmation (cleanup baseline lists fullscreen unchecked).
2. **Working tree dirty** (the fix + QA artefacts + the prettier cleanup) — see report §working-tree. No commit made (not requested).
3. **JS error collector** (`window.__qaErrors`, CDP-injected for the route sweep) was in-memory only; gone after relaunch. No residual app instrumentation.
4. c64u was **power-cycled twice by the user** during the session to recover from the unfixed-build wedge. After the fix, no further wedges; device healthy at session end.

## Quality gates (final)

- `npm run scope:check`: PASS (55 files / 361 tests)
- Kotlin `MainActivityTest`: PASS (incl. 2 new keep-alive regression tests)
- `npm run lint` (format + eslint + typecheck + display-profiles + bundle-budgets + stale-names + variant/feature-flags/menu-mapping checks): **PASS**
- `tsc --noEmit`: PASS
- APK build (`assembleDebug`): BUILD SUCCESSFUL

## Cleanup status: COMPLETE

All session-induced device mutations restored (drive ejected, display profile → Auto, c64u connected/healthy). One pre-existing residual (Hide status bar) documented. No destructive C64U config writes performed.
