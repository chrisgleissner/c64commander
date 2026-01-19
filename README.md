# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

Control your Commodore 64 Ultimate from your Android device

<img src="./doc/img/c64commander.png" alt="C64 Commander Logo" width="200"/>

C64 Commander is an Android app that connects to a C64 Ultimate device on your local network:

- Browse and edit the entire C64U configuration.
- Quick access to key settings (SID, VIC, CPU, drives) and device actions.
- Play SID files from local folders or the HVSC library.

## HVSC Library

The app ingests HVSC archives directly on-device via native Kotlin code and stores metadata and SID binaries in a local SQLite database. Baseline installs and incremental updates are applied atomically, and the Play page remains source-agnostic between local folders and HVSC.

## Screenshots

![Home](doc/img/app-home.png)
![Quick Settings](doc/img/app-quick-settings.png)
![Configuration](doc/img/app-configuration.png)
![Configuration Expanded](doc/img/app-configuration-expanded.png)
![Music](doc/img/app-music.png)
![Settings](doc/img/app-settings.png)
![Documentation](doc/img/app-documentation.png)

## Install the APK on your Android phone

1. Download the APK from the latest GitHub release (`app-release.apk` for normal installs; use `app-debug.apk` only if you need a debug build).
2. Open the downloaded file on your phone (Files app or notification).
3. If prompted, allow installs from unknown sources for the browser/files app.
4. Tap Install to finish.

## Build the Android APK

Ensure JDK 17 is installed (Gradle requires it for Android builds).

```sh
./linux-build.sh
```

You can then find it at:

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

## Run it in Android Emulator

```sh
./linux-build.sh --emulator
```

## Run it on your Device

Device (one-time): Auto Blocker Off (Samsung), enable Developer options, enable USB debugging, approve the USB prompt.

Then run:

```sh
./linux-build.sh --install
```

## Tests

```sh
npm run test
npm run test:e2e
cd android && ./gradlew test
```

## Update screenshots

This refreshes the app screenshots in `doc/img` and captures extra states (including expanded configuration sliders).

```sh
./local-build.sh --screenshots
```
