# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yml)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

Control your Commodore 64 Ultimate from your Android device

<img src="./doc/img/c64commander.png" alt="C64 Commander Logo" width="200"/>

C64 Commander is an Android app that connects to a C64 Ultimate device on your local network:

- Browse and edit the entire C64U configuration.
- Quick access to key settings (SID, VIC, CPU, drives) and device actions.

## Screenshots

![Home](doc/img/app-home.png)
![Quick Settings](doc/img/app-quick-settings.png)
![Configuration](doc/img/app-configuration.png)
![U64 Specific](doc/img/app-configuration-u64-specific.png)
![Documentation](doc/img/app-documentation.png)
![Settings](doc/img/app-settings.png)

## Build the Android APK

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

