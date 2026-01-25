# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml)
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

Control your Commodore 64 Ultimate from your Android device

<img src="./doc/img/c64commander.png" alt="C64 Commander Logo" width="200"/>

> [!NOTE]
> This project is under active development. Some features are still being finalised.

C64 Commander is an Android app that connects to a C64 Ultimate device on your local network:

- Browse and edit the entire C64U configuration.
- Device controls and disk management from a mobile-friendly dashboard.
- Play files from local storage (work in progress) or the Ultimate 64 with a playlist-first workflow.
- Diagnostics and developer tools for troubleshooting.

## Screenshots

<table>
  <tr>
    <td>
      <img src="doc/img/app-home.png" alt="Home" width="480"/>
    </td>
    <td>
      <img src="doc/img/app-home-dark.png" alt="Home (Dark)" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app-play.png" alt="Play" width="480"/>
    </td>
    <td>
      <img src="doc/img/app-disks.png" alt="Disks" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app-configuration.png" alt="Configuration" width="480"/>
    </td>
    <td>
      <img src="doc/img/app-configuration-expanded.png" alt="Configuration Expanded" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app-settings.png" alt="Settings" width="480"/>
    </td>
    <td>
      <img src="doc/img/app-documentation.png" alt="Documentation" width="480"/>
    </td>
  </tr>
</table>

## Install the APK on your Android phone

1. Download the APK from the latest GitHub release (`c64commander-<version>.apk` for normal installs; use `c64commander-<version>-debug.apk` only if you need a debug build).
2. Open the downloaded file on your phone (Files app or notification).
3. If prompted, allow installs from unknown sources for the browser/files app.
4. Tap Install to finish.

## Developer documentation

For build instructions, testing, and contribution guidelines, see [doc/developer.md](doc/developer.md).
