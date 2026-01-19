# Third-Party Notices

This project includes third-party components. The notices below are provided to comply with their license requirements.

## Apache Commons Compress

Project: <https://commons.apache.org/proper/commons-compress/>
License: Apache License 2.0. Used for 7z archive parsing in the native HVSC ingestion pipeline.

## XZ for Java

Project: <https://tukaani.org/xz/java.html>
License: Public Domain / BSD-style (see project). Used by Commons Compress for LZMA/XZ decompression.

## Other bundled dependencies

The Android APK bundles additional open-source components. Notable runtime components include:

- Capacitor Android runtime and Cordova bridge (MIT) via `@capacitor/android` and `:capacitor-cordova-android-plugins`.
- AndroidX libraries (Apache-2.0): `appcompat`, `coordinatorlayout`, `core-splashscreen`, `documentfile`.
- Kotlin standard library (Apache-2.0) via the Kotlin Android plugin.
- React + React DOM (MIT) and other npm dependencies compiled into the web bundle.

The full list of JavaScript dependencies is tracked in package.json and package-lock.json. Android runtime dependencies are declared in android/app/build.gradle.
