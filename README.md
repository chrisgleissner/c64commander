# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml)
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)

Control your Commodore 64 Ultimate from your Android device.

<img src="./docs/play-store/feature-graphic-1024x500.png" alt="C64 Commander Logo" width="600"/>

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

This page is the central dashboard for the most important device settings. All settings can also be adjusted from the Configuration or Disk pages.

<table>
  <tr>
    <td><img src="doc/img/app/home/00-overview-light.png" alt="Home overview (Light)" width="360"/></td>
    <td><img src="doc/img/app/home/01-overview-dark.png" alt="Home overview (Dark)" width="360"/></td>
    <td><img src="doc/img/app/home/sections/03-quick-config.png" alt="Home quick config" width="360"/></td>
  </tr>
  <tr>
    <td><img src="doc/img/app/home/sections/04-drives.png" alt="Home drives" width="360"/></td>
    <td><img src="doc/img/app/home/sections/06-sid.png" alt="Home SID" width="360"/></td>
    <td><img src="doc/img/app/home/sections/07-streams.png" alt="Home streams" width="360"/></td>
  </tr>
</table>

### Play

Control music and program playback, adjust playback settings and manage playlists, imported from local device, C64U or HVSC. Supports automatic playlist advance and random shuffle.

<table>
  <tr>
    <td><img src="doc/img/app/play/01-overview.png" alt="Play overview" width="360"/></td>
    <td><img src="doc/img/app/play/import/01-import-interstitial.png" alt="Play import" width="360"/></td>
    <td><img src="doc/img/app/play/sections/02-playlist.png" alt="Play playlist" width="360"/></td>
  </tr>
</table>

### Disks

Monitor drive status, mount images, and browse your disk collections.

<table>
  <tr>
    <td><img src="doc/img/app/disks/01-overview.png" alt="Disks overview" width="360"/></td>
    <td><img src="doc/img/app/disks/sections/02-disks.png" alt="Disks collection" width="360"/></td>
    <td><img src="doc/img/app/disks/collection/01-view-all.png" alt="Disks collection" width="360"/></td>
  </tr>
</table>

### Configuration

Browse configuration categories, tune audio and SID settings, and edit drive-specific options.

<table>
  <tr>
    <td><img src="doc/img/app/config/01-categories.png" alt="Configuration categories" width="360"/></td>
    <td><img src="doc/img/app/config/sections/05-u64-specific-settings.png" alt="Configuration U64 specific" width="360"/></td>
    <td><img src="doc/img/app/config/sections/06-c64-and-cartridge-settings.png" alt="Configuration U64 specific" width="360"/></td>
  </tr>
</table>

### Settings

Adjust appearance, connections, diagnostics, playback defaults, HVSC library access, and device safety.

<table>
  <tr>
    <td><img src="doc/img/app/settings/sections/01-appearance.png" alt="Settings appearance" width="360"/></td>
    <td><img src="doc/img/app/settings/sections/02-connection.png" alt="Settings connection" width="360"/></td>
    <td><img src="doc/img/app/settings/sections/03-diagnostics.png" alt="Settings diagnostics" width="360"/></td>
  </tr>
  <tr>
    <td><img src="doc/img/app/settings/sections/04-play-and-disk.png" alt="Settings play and disk" width="360"/></td>
    <td><img src="doc/img/app/settings/sections/05-config.png" alt="Settings configuration" width="360"/></td>
    <td><img src="doc/img/app/settings/sections/07-device-safety.png" alt="Settings Device Safety" width="360"/></td>
  </tr>
</table>

### Docs

Read in-app documentation, getting started guides, and per-page walkthroughs with external references.

<table>
  <tr>
    <td><img src="doc/img/app/docs/01-overview.png" alt="Docs overview" width="360"/></td>
    <td><img src="doc/img/app/docs/sections/01-getting-started.png" alt="Docs getting started" width="360"/></td>
    <td><img src="doc/img/app/docs/sections/05-swapping-disks.png" alt="Docs swapping disks" width="360"/></td>
  </tr>
</table>

### Diagnostics

Inspect and export logs, traces, and the effect of user/system actions.

<table>
  <tr>
    <td><img src="doc/img/app/diagnostics/01-actions-expanded.png" alt="Diagnostics actions" width="360"/></td>
    <td><img src="doc/img/app/diagnostics/02-traces-expanded.png" alt="Diagnostics traces" width="360"/></td>
    <td><img src="doc/img/app/diagnostics/03-logs.png" alt="Diagnostics logs" width="360"/></td>
  </tr>
</table>

Full screenshot set lives under [doc/img/app/](doc/img/app/).

## Install the APK on your Android phone

1. Download the APK from the latest GitHub release (`c64commander-<version>.apk` for normal installs; use `c64commander-<version>-debug.apk` only if you need a debug build).
2. Open the downloaded file on your phone (Files app or notification).
3. If prompted, allow installs from unknown sources for the browser or files app.
4. Tap Install to finish.

## Install on iPhone via AltStore (iOS)

1. Install AltStore on your iPhone and sign in with an Apple ID.
2. Open GitHub Actions for this repository and download these artifacts from the `iOS CI` workflow:
  - `c64commander-altstore-unsigned.ipa`
  - `c64commander-altstore-unsigned.ipa.sha256`
3. Verify the checksum locally (`shasum -a 256 c64commander-altstore-unsigned.ipa`) matches the `.sha256` file.
4. In AltStore, choose “+” and select `c64commander-altstore-unsigned.ipa`.
5. Launch C64 Commander from the home screen after installation completes.

### iOS troubleshooting (AltStore)

- **App expired**: free Apple ID installs must be refreshed in AltStore about every 7 days.
- **App ID/account limits reached**: remove unused sideloaded apps from your Apple ID account and retry.
- **Install/signing errors**: retry with a fresh download of both IPA and checksum and confirm they match.
- **Compatibility note**: CI runtime selection validates iOS `26 -> 18 -> 17` in that order; iOS 17/18 are the baseline support targets.

## Device safety settings

C64 Commander includes a configurable device safety system to reduce REST and FTP load.
You can find these controls in Settings → Device Safety.

- **Safety mode presets**: Relaxed, Balanced (default), and Conservative.
- **Advanced controls**: REST and FTP concurrency, read coalescing windows, cooldowns, backoff strategy, circuit breaker thresholds, and discovery probe interval.
- **Warning**: Lower safety settings can overwhelm the device. Use relaxed settings only if you understand the risks.

## Developer documentation

For build instructions, testing, and contribution guidelines, see [doc/developer.md](doc/developer.md).

iOS CI/bootstrap helpers:

- `npm run cap:add:ios` to generate the iOS platform.
- `npm run cap:sync:ios` to sync web/native assets for iOS.
- `npm run ios:build:sim` to build the simulator app on macOS.
- `npm run ios:build:device` to build a device-targeted app on macOS.
- GitHub iOS simulator CI is defined in [.github/workflows/ios-ci.yaml](.github/workflows/ios-ci.yaml).
- AltStore packaging lane publishes `c64commander-altstore-unsigned.ipa` plus `.sha256` as CI artifacts.
- Paid-signing lane is disabled by default and only runs when `IOS_PAID_SIGNING_ENABLED=true`.
- Paid-signing lane expects `IOS_BUILD_CERTIFICATE_BASE64`, `IOS_P12_PASSWORD`, `IOS_PROVISIONING_PROFILE_BASE64`, `IOS_TEAM_ID`, and `IOS_SIGNING_IDENTITY` secrets.
- Rollout stage policy uses `IOS_ROLLOUT_STAGE` (`A`, `B`, `C`) to transition iOS checks from informative to required.

Fuzz testing is documented in [doc/testing/chaos-fuzz.md](doc/testing/chaos-fuzz.md).
