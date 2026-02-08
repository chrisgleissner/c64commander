# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml)
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

Control your Commodore 64 Ultimate from your Android device

<img src="./doc/img/c64commander.png" alt="C64 Commander Logo" width="200"/>

> [!NOTE]
> This project is under active development. Some features are still being finalised.

C64 Commander is an Android app that connects to a C64 Ultimate on your local network:

- **Configuration**: View and adjust the full C64 Ultimate configuration.
- **Control**: Operate the C64 and its disk drives from a mobile-friendly interface.
- **Playback**: Browse and play music, programs, and disk images from local storage or via the C64 Ultimate, with playlist and automatic playback support.
- **Disks**: Work with disks and disk collections, including mounting, unmounting, and multi-disk workflows.
- **Collections**: Browse and play the HVSC music library via your C64 Ultimate.
- **Diagnostics**: Inspect device state and use diagnostic tools for troubleshooting.

## Screenshots

### Home

Track device status at a glance, control the machine and drives, and access quick configuration actions.

<table>
  <tr>
    <td>
      <img src="doc/img/app/home/00-overview-light.png" alt="Home overview (Light)" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/home/01-overview-dark.png" alt="Home overview (Dark)" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app/home/sections/02-machine.png" alt="Home machine" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/home/sections/06-sid.png" alt="Home SID" width="480"/>
    </td>
  </tr>
</table>

### Play

Control SID playback, adjust playback settings, manage playlists, select SID subsongs, and explore HVSC playback modes.

<table>
  <tr>
    <td>
      <img src="doc/img/app/play/01-overview.png" alt="Play overview" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/play/sections/02-playlist.png" alt="Play playlist" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app/play/sections/03-hvsc-library.png" alt="Play HVSC library" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/play/05-demo-mode.png" alt="Play demo mode" width="480"/>
    </td>
  </tr>
</table>

### Disks

Monitor drive status, mount images, and browse your disk collections.

<table>
  <tr>
    <td>
      <img src="doc/img/app/disks/01-overview.png" alt="Disks overview" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/disks/collection/01-view-all.png" alt="Disks collection" width="480"/>
    </td>
  </tr>
</table>

### Configuration

Browse configuration categories, tune audio and SID settings, and edit drive-specific options.

<table>
  <tr>
    <td>
      <img src="doc/img/app/config/01-categories.png" alt="Configuration categories" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/config/sections/05-u64-specific-settings.png" alt="Configuration U64 specific" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app/config/sections/01-audio-mixer.png" alt="Configuration audio mixer" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/config/sections/03-ultisid-configuration.png" alt="Configuration UltiSID" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app/config/sections/15-drive-a-settings.png" alt="Configuration drive A settings" width="480"/>
    </td>
    <td></td>
  </tr>
</table>

### Settings

Adjust appearance, connections, diagnostics, playback defaults, HVSC library access, and device safety.

<table>
  <tr>
    <td>
      <img src="doc/img/app/settings/sections/01-appearance.png" alt="Settings appearance" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/settings/sections/02-connection.png" alt="Settings connection" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app/settings/sections/03-diagnostics.png" alt="Settings diagnostics" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/settings/sections/04-play-and-disk.png" alt="Settings play and disk" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app/settings/sections/05-config.png" alt="Settings configuration" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/settings/sections/06-hvsc-library.png" alt="Settings HVSC library" width="480"/>
    </td>
  </tr>
</table>

### Docs

Read in-app documentation, getting started guides, and per-page walkthroughs with external references.

<table>
  <tr>
    <td>
      <img src="doc/img/app/docs/01-overview.png" alt="Docs overview" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/docs/sections/01-getting-started.png" alt="Docs getting started" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app/docs/sections/02-home.png" alt="Docs home" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/docs/sections/03-play-files.png" alt="Docs play files" width="480"/>
    </td>
  </tr>
</table>

### Diagnostics

Trigger diagnostic actions, inspect traces, review logs, and triage errors.

<table>
  <tr>
    <td>
      <img src="doc/img/app/diagnostics/01-actions-expanded.png" alt="Diagnostics actions" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/diagnostics/02-traces-expanded.png" alt="Diagnostics traces" width="480"/>
    </td>
  </tr>
  <tr>
    <td>
      <img src="doc/img/app/diagnostics/03-logs.png" alt="Diagnostics logs" width="480"/>
    </td>
    <td>
      <img src="doc/img/app/diagnostics/04-errors.png" alt="Diagnostics errors" width="480"/>
    </td>
  </tr>
</table>

Full screenshot set lives under [doc/img/app/](doc/img/app/).

## Install the APK on your Android phone

1. Download the APK from the latest GitHub release (`c64commander-<version>.apk` for normal installs; use `c64commander-<version>-debug.apk` only if you need a debug build).
2. Open the downloaded file on your phone (Files app or notification).
3. If prompted, allow installs from unknown sources for the browser/files app.
4. Tap Install to finish.

## Device safety settings

C64 Commander includes a configurable device safety system to reduce REST/FTP overload on fragile hardware.
You can find these controls in Settings → Device Safety.

- **Safety mode presets**: Relaxed, Balanced (default), and Conservative.
- **Advanced controls**: REST/FTP concurrency, read coalescing windows, cooldowns, backoff strategy, circuit breaker thresholds, and discovery probe interval.
- **Warning**: Lower safety settings can overwhelm the device. Use relaxed settings only if you understand the risks.

## Developer documentation

For build instructions, testing, and contribution guidelines, see [doc/developer.md](doc/developer.md).

Chaos/fuzz testing is documented in [doc/testing/chaos-fuzz.md](doc/testing/chaos-fuzz.md).
