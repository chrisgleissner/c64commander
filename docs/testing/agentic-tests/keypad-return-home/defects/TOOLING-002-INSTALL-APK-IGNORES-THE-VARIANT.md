# TOOLING-002 — `--install-apk` cannot install any edition but the default

- Severity: TOOLING
- Priority: P2
- Product area: Build
- First reproduced UTC: `2026-09-19T08:36Z`
- Reproduction rate: 1/1 for `APP_VARIANT=c64u-remote ./build --skip-tests --install-apk`

## Previous behaviour

`resolve_apk_default_path` in `build` built the APK path from the literal `c64commander-`, and the
launch step after a successful install ran `monkey -p uk.gleissner.c64commander`.

## The defect

Gradle names the APK after the selected variant's `exportedFileBasename`
(`android/app/build.gradle:351`), so a `c64u-remote` build produces
`c64u-remote-1.0.5-rc1-6ba84-debug.apk`. `build` looked for `c64commander-1.0.5-rc1-6ba84-debug.apk`,
did not find it, and exited with `APK not found` — after having run the whole web and Gradle build.
The 8020 edition, which is the one the keypad user holds, could not be installed by the documented
command at all. Had a stale APK of the default edition been present, the run would instead have
installed and launched the wrong edition without saying so.

`APK_DEFAULT` was also resolved before the build ran, while `src/generated/variant.json` still
described the previous variant.

## The implemented change

`build` reads `exportedFileBasename` and `platform.android.applicationId` from
`src/generated/variant.json`, and resolves the APK path at install time rather than before the
build, because `variant:generate` runs as part of the build. The launch step uses the same
application id.

## How the change was verified

`APP_VARIANT=c64u-remote ./build --skip-tests --install-apk` previously stopped at
`APK not found: .../c64commander-1.0.5-rc1-6ba84-debug.apk` with the built APK sitting beside that
path as `c64u-remote-1.0.5-rc1-6ba84-debug.apk`.

## User impact

None directly. It is the reason the 8020 edition had to be installed by hand for this hunt.
