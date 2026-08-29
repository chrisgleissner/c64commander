# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android.yaml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android.yaml)
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0.en.html)
[![Platform](https://img.shields.io/badge/platforms-Android%20%7C%20iOS%20%7C%20Web-blue)](https://github.com/chrisgleissner/c64commander/releases)

Control and manage a Commodore 64 Ultimate from Android, iOS, or a self-hosted web deployment on your local network.

<img src="./docs/site/play-store/feature-graphic-1024x500.png" alt="C64 Commander" width="600"/>

## Features

- **Cross-platform**: Android and iOS apps, plus a self-hosted Docker web app for Windows, macOS, and Linux.
- **Device support**: Works with the C64 Ultimate, Ultimate 64 Elite I/II, and Ultimate-II+(L) cartridges.
- **Search**: Find any page, setting, action, tune or disk by name. Three ways in — the field at the top of Home, the Quick menu, or the `7` key. A result you cannot use yet is still listed, with the reason.
- **Guided tour**: A first-run walk through every part of the app — playing music with nothing attached, playlists and where content comes from, disks, connecting and controlling a machine, watching and steering it, its configuration, getting around with a keypad, the built-in guides, and appearance. It drives the real app rather than showing pictures of it, and is skippable at any step and restartable from Docs or Settings > About.
- **Dashboard**: Control the machine, drives, printer, SID mixer, lighting, and streams from one page.
- **Playlists and SID Radio**: Play programs and SID music from local files, device storage, HVSC, or CommoServe.
- **Remote Input and Live View**: Use an on-screen joystick or keyboard, and stream audio or video from the running machine.
- **Disk tools**: Mount images, manage multi-disk collections, inspect image contents, and create blank disks.
- **Configuration**: Browse and edit the complete C64 Ultimate configuration.
- **Diagnostics**: Review connection health, activity, traces, and latency.
- **Multiple devices**: Save several devices, check their health, and switch between them.
- **Appearance styles**: Seven color styles on top of the Light/Dark theme, or match your C64 Ultimate's own Color Scheme.

## Getting Started

Setup takes three steps: install the app, enable the C64 Ultimate's network services, then connect the two over your local network.

### Step 1: Install C64 Commander

Install the app on a phone, tablet, or host that is on the **same local network** as the C64 Ultimate.

**Android**

1. Download the latest APK from [Releases](https://github.com/chrisgleissner/c64commander/releases).
2. Open the APK and allow installs from unknown sources if prompted.
3. Tap **Install**.

**iOS**

1. Set up [SideStore](https://docs.sidestore.io/).
2. Download the latest IPA from [Releases](https://github.com/chrisgleissner/c64commander/releases).
3. In **SideStore > My Apps**, tap **+** and select the IPA.

SideStore refreshes the app signature automatically every 7 days.

**Web (Docker)**

The web app runs on your local network using Docker. Install [Docker Desktop](https://docs.docker.com/desktop/) on Windows or macOS, or [Docker Engine](https://docs.docker.com/engine/install/) on Linux. The image supports `linux/amd64` and `linux/arm64`; a Raspberry Pi Zero 2W or 4B with at least 512 MiB RAM is sufficient.

```bash
mkdir -p ./c64commander-config && chmod 0777 ./c64commander-config

docker run -d --name c64commander -p 8064:8064 \
  -v ./c64commander-config:/config --restart unless-stopped \
  ghcr.io/chrisgleissner/c64commander:<version>
```

Open `http://<host-ip>:8064` in a browser. If you configure a network password under **Settings > Device > Network password**, use it to sign in to the web app.

### Step 2: Enable Network Services on the C64 Ultimate

Enable the network services used by C64 Commander.

![Network services & timezone menu](docs/img/setup/enable_services.png)

1. On the C64 Ultimate, press **C=** and **RESTORE** together to open the menu, then select **Network Services & Timezone**.
2. Enable the required services:
   - **Web Remote Control Service**: required for control and status.
   - **FTP File Service**: required for browsing and transferring files.
   - **Telnet Remote Menu Service**: required for actions such as power cycling.
3. Connect both devices to the same local network. Note the Ultimate's IP address under **Wired Network Setup** or **Wi-Fi Network Setup** in case manual setup is needed.

### Step 3: Connect to Your Device

1. Start C64 Commander. If no reachable device is configured, the app scans the local network automatically.
2. Tap **Use** to connect to a discovered device, or **Save** to keep it for later. Enter the network password when prompted.

   <img src="docs/img/app/launch/discovery/startup-autodiscovery-interstitial.png" alt="C64 systems found during a network scan" width="320"/>

3. To scan again later, open **Settings > Device > Connection** and tap **Discover devices**.
4. If discovery does not find your device, enter its IP address or hostname manually under **Settings > Device > Connection**.
5. A green health indicator at the top right confirms a successful connection.

![Connected C64U badge](docs/img/app/home/02-connection-status-popover.png)

C64 Commander reconnects to saved devices automatically on later launches.

## Pages

### Home

Home opens on search, then **Quick Actions** — one grid in four bands: watch (Live, Game, Input), listen (Radio, Last, Recent), operate (Menu, Pause, Backup, Restore), and last the ones that interrupt the machine: Reset, and a Power tile holding Reboot, Power Cycle and Power Off. Every tile is one word on one line, so the grid is three rows rather than four. Below that are the cards for lighting, drives, printer, SID mixer, streams, and configuration snapshots, and the system information last.

With nothing connected, Home does not become a wall of "Not available": search stays where it is, the promoted tiles are drawn on their own — Radio, Last and Recent need no machine at all, and Live is listed greyed with the reason rather than hidden — a card explains how to connect one, and the device cards are drawn as titles with their contents put away until one answers.

<table>
  <tr>
    <td><img src="docs/img/app/home/00-overview-light.png" alt="C64 Commander intro" width="360"/></td>
    <td><img src="docs/img/app/home/sections/01-quick-actions-to-live-view.png" alt="Home search field and quick actions (Light)" width="360"/></td>
    <td><img src="docs/img/app/home/01-overview-dark.png" alt="Home top row and quick actions (Dark)" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/home/sections/05-video-to-audio.png" alt="Home sections from video through audio" width="360"/></td>
    <td><img src="docs/img/app/home/sections/09-lighting-to-keyboard-light.png" alt="Home sections through lighting" width="360"/></td>
    <td><img src="docs/img/app/home/sections/12-drives-to-printers.png" alt="Home sections from drives through printers" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/home/sections/14-streams-to-system-info.png" alt="Home sections from streams through system info" width="360"/></td>
    <td><img src="docs/img/app/home/dialogs/05-lighting-studio-medium.png" alt="Lighting Studio bottom sheet" width="360"/></td>
    <td><img src="docs/img/app/home/03-demo-mode-interstitial.png" alt="Demo Mode interstitial" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/home/dialogs/01-save-ram-dialog.png" alt="Backup snapshot type selection" width="360"/></td>
    <td><img src="docs/img/app/home/dialogs/02-save-ram-custom-range.png" alt="Backup custom ranges" width="360"/></td>
    <td><img src="docs/img/app/home/dialogs/03-snapshot-manager.png" alt="Restore snapshot manager" width="360"/></td>
  </tr>
</table>

### Remote Input

Use your phone as a wireless joystick or C64 keyboard. Open **Remote Input** from **Home**, or from **Play** while a program is running.

Remote Input includes:

- **Joystick**: Analog, D-pad, and swipe controls, with fire, autofire, port selection, and Game mode.
- **Keys**: A touchscreen C64 keyboard with common control, edit, function, and system keys.

Joystick input requires an Ultimate 64 with firmware 3.15 or later. It is not available on Ultimate-II+(L) cartridges.

#### Joystick Control

Joystick controls in standard and Game mode:

<table>
  <tr>
    <td><img src="docs/img/app/home/remote-input/profiles/medium/01-joystick.png" alt="Remote Input Joystick tab with a large adjustable stick and fire button" width="360"/></td>
    <td><img src="docs/img/app/home/remote-input/profiles/medium/02-game-mode.png" alt="Remote Input Game mode with an edge-anchored stick and fire button" width="360"/></td>
    <td width="360"></td>
  </tr>
</table>

#### Keyboard Control

Keyboard layouts for small, standard, and large displays:

<table>
  <tr>
    <td><img src="docs/img/app/home/remote-input/03-keyboard-compact.png" alt="Remote Input Keys tab on a small phone: isolated cursor pad, pinned RETURN and SPACE, and a scrollable key grid" width="240"/></td>
    <td><img src="docs/img/app/home/remote-input/04-keyboard-medium.png" alt="Remote Input Keys tab on a phone with recognizable C64 key ordering" width="240"/></td>
    <td><img src="docs/img/app/home/remote-input/05-keyboard-expanded.png" alt="Remote Input Keys tab on a tablet or desktop showing the full physical C64 keyboard layout with an aligned F-key box" width="360"/></td>
  </tr>
</table>

### Live View

Stream audio and video from the running machine. Use **Listen** for audio only, or **Watch** for an expandable screen preview.

<table>
  <tr>
    <td><img src="docs/img/app/home/content-explorer/profiles/medium/01-live-view.png" alt="Live View on Home: Listen and Watch toggles with a small live preview" width="300"/></td>
    <td><img src="docs/img/app/home/content-explorer/02-live-view-expanded.png" alt="Live View expanded to a larger inline preview of the C64 screen" width="300"/></td>
  </tr>
</table>

In **Remote Input**, Live View provides a full-width screen with zoom, pan, a minimap, and automatic tracking. A view lock switches physical controls between the C64 and the screen view. Game mode keeps the screen visible above the controls.

<img src="docs/img/app/home/remote-input/profiles/medium/06-av-mirror-immersive.png" alt="Remote Input immersive mirror: the C64 screen with a Driving-C64 view-lock chip and zoom/pan controls" width="300"/>

Live View prioritises continuous audio and can reduce the video frame rate when needed. The optional **Stats** panel shows frame rate, buffering, packet loss, and CPU use.

Enable **Audio Mirror** and **Video Mirror** under **Settings > Features**. Video is more demanding and disabled by default. Stream ports can be changed under **Settings > Play and disk behaviour**.

### Play

Build playlists from local files, C64 Ultimate storage, HVSC, or CommoServe. Use autoplay, shuffle, repeat, subsong selection, and automatic song lengths.

<table>
  <tr>
    <td><img src="docs/img/app/play/01-overview.png" alt="Play overview" width="360"/></td>
    <td><img src="docs/img/app/play/sections/02-playlist.png" alt="Play playlist" width="360"/></td>
    <td><img src="docs/img/app/play/playlist/01-view-all.png" alt="Play playlist view all" width="360"/></td>
  </tr>
</table>

### SID Radio

Create an endless playlist of similar SID tunes from HVSC. Start with the current song, choose a mood, or build from your liked tunes. Use ♥ and ✕ to shape future selections. A station never repeats a tune, and never plays two pieces from the same SID file back to back.

Tunes normally play on the connected C64 Ultimate. You can also stream the audio back from your C64U and listen on your local device.

For SID music on the go, the built-in player runs entirely on your phone and requires no network connection. It picks the SID chip each tune names, and for tunes that name none you can have it match the chip in your own C64.

<table>
  <tr>
    <td><img src="docs/img/app/play/sid-radio/profiles/medium/01-controls.png" alt="SID Radio and Liked Tunes controls with the heart/cross ranking on the playback card" width="360"/></td>
    <td><img src="docs/img/app/play/sid-radio/profiles/medium/02-stations.png" alt="SID Radio station launcher: song, mood (nine style tiles) and taste seeds" width="360"/></td>
    <td><img src="docs/img/app/settings/sid-radio.png" alt="SID Radio settings: enable stations, ranking, and the experimental on-device playback engine, with the similarity corpus status" width="360"/></td>
  </tr>
</table>

### Browse & Import

Choose an import source, browse its contents, then add files to your playlist or disk collection.

<table>
  <tr>
    <td><img src="docs/img/app/play/import/01-import-interstitial.png" alt="Import source chooser" width="360"/></td>
    <td><img src="docs/img/app/play/import/06-hvsc-preparing.png" alt="HVSC preparation" width="360"/></td>
    <td><img src="docs/img/app/play/import/07-hvsc-ready.png" alt="HVSC ready" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/play/import/08-hvsc-browser.png" alt="HVSC browser after preparation" width="360"/></td>
    <td><img src="docs/img/app/play/import/04-commoserve-search.png" alt="CommoServe search form" width="360"/></td>
    <td><img src="docs/img/app/play/import/05-commoserve-results-selected.png" alt="CommoServe results with selection" width="360"/></td>
  </tr>
</table>

### Disks

View drive state, mount and eject images, and manage disk collections with multi-disk group rotation.

<table>
  <tr>
    <td><img src="docs/img/app/disks/01-overview.png" alt="Disks overview" width="360"/></td>
    <td><img src="docs/img/app/disks/sections/02-disks.png" alt="Disks section" width="360"/></td>
    <td><img src="docs/img/app/disks/collection/01-view-all.png" alt="Disks collection" width="360"/></td>
  </tr>
</table>

### Content Explorer

Create blank disks, inspect disk images, launch individual programs, search inside images, and handle cartridge boot menus with Launch Safety.

<table>
  <tr>
    <td><img src="docs/img/app/disks/content-explorer/01-new-disk.png" alt="New disk dialog: create a formatted blank D64/D71/D81/DNP image on the device" width="360"/></td>
    <td><img src="docs/img/app/settings/content-explorer/01-launch-safety.png" alt="Settings: search inside disk images and answer a cartridge boot menu after reset" width="360"/></td>
    <td width="360"></td>
  </tr>
</table>

### Configuration

Browse and edit the complete C64 Ultimate configuration.

<table>
  <tr>
    <td><img src="docs/img/app/config/01-categories.png" alt="Configuration menu pages" width="360"/></td>
    <td><img src="docs/img/app/config/sections/03-video-setup.png" alt="Configuration video setup" width="360"/></td>
    <td><img src="docs/img/app/config/sections/04-audio-mixer.png" alt="Configuration audio mixer" width="360"/></td>
  </tr>
</table>

### Settings

Configure connections, appearance, diagnostics, playback, HVSC, and device safety.

<table>
  <tr>
    <td><img src="docs/img/app/settings/sections/01-appearance.png" alt="Settings appearance" width="360"/></td>
    <td><img src="docs/img/app/settings/sections/03-diagnostics.png" alt="Settings diagnostics" width="360"/></td>
    <td><img src="docs/img/app/settings/sections/04-play-and-disk.png" alt="Settings play and disk" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/settings/sections/05-config.png" alt="Settings configuration" width="360"/></td>
    <td><img src="docs/img/app/settings/sections/07-device-safety.png" alt="Settings device safety" width="360"/></td>
    <td><img src="docs/img/app/settings/sections/09-hvsc.png" alt="Settings HVSC" width="360"/></td>
  </tr>
</table>

### Docs

Built-in guides for setup, workflows, and day-to-day usage.

<table>
  <tr>
    <td><img src="docs/img/app/docs/01-overview.png" alt="Docs overview" width="360"/></td>
    <td><img src="docs/img/app/docs/sections/01-getting-started.png" alt="Docs getting started" width="360"/></td>
    <td><img src="docs/img/app/docs/sections/05-swapping-disks.png" alt="Docs swapping disks" width="360"/></td>
  </tr>
</table>

### Diagnostics

Tap the top-right status badge to review connection health, activity logs, traces, filters, and latency.

<table>
  <tr>
    <td><img src="docs/img/app/diagnostics/01-overview.png" alt="Diagnostics overview" width="360"/></td>
    <td><img src="docs/img/app/diagnostics/activity/07-problems-only.png" alt="Diagnostics activity list" width="360"/></td>
    <td><img src="docs/img/app/diagnostics/filters/02-editor.png" alt="Diagnostics filter editor" width="360"/></td>
  </tr>
</table>

### Switch Device

Long-press the top-right status badge to view saved devices, compare their health, and switch between them.

<table>
  <tr>
    <td><img src="docs/img/app/diagnostics/switch-device/profiles/medium/01-picker.png" alt="Switcher (Connecting)" width="360"/></td>
    <td><img src="docs/img/app/diagnostics/switch-device/profiles/medium/02-picker-expanded.png" alt="Switcher expanded details" width="360"/></td>
    <td><img src="docs/img/app/diagnostics/switch-device/profiles/medium/06-picker-one-unhealthy-expanded.png" alt="Switcher expanded unhealthy device" width="360"/></td>
  </tr>
</table>

## Appearance Styles

Pick one of seven color styles under **Settings > Appearance > Style**, on top of the existing Light/Dark theme. Two of them are dark only. **Match my device** follows your C64 Ultimate's own Color Scheme instead, read on connect rather than polled. A style changes color, corner rounding, and shading only — never layout or type size, and never the colors that show what the hardware is doing.

<table>
  <thead>
    <tr>
      <th align="left">Cool Grey (default)</th>
      <th align="left">Breadbin Beige</th>
      <th align="left">Vault Black (dark only)</th>
    </tr>
  </thead>
  <tr>
    <td><img src="docs/img/app/styles/showcase-cool-grey-light.png" alt="Home in Cool Grey, the default style" width="360"/></td>
    <td><img src="docs/img/app/styles/showcase-breadbin-beige-light.png" alt="Home in Breadbin Beige" width="360"/></td>
    <td><img src="docs/img/app/styles/showcase-vault-black-dark.png" alt="Home in Vault Black, one of the two dark-only styles" width="360"/></td>
  </tr>
</table>

## Display Profiles

The layout adapts to the screen size: Small for phones, Standard for large phones and small tablets, and Large for tablets and desktops. Override it under **Settings > Display Profile**.

<table>
  <thead>
    <tr>
      <th align="left">Small display</th>
      <th align="left">Standard display</th>
      <th align="left">Large display</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td valign="top">
        <img
          src="docs/img/app/home/profiles/compact/01-overview.png"
          alt="Home page in the Small display profile"
        />
      </td>
      <td valign="top">
        <img
          src="docs/img/app/home/profiles/medium/01-overview.png"
          alt="Home page in the Standard display profile"
        />
      </td>
      <td valign="top">
        <img
          src="docs/img/app/home/profiles/expanded/01-overview.png"
          alt="Home page in the Large display profile"
        />
      </td>
    </tr>
  </tbody>
</table>

## Keyboard & Keypad Navigation

Use a hardware keyboard, D-pad, joystick, or numeric keypad to navigate the app. The highlighted control shows the current selection. Use Up/Down to move, OK/Enter to activate, and Back/Escape to close or return.

`1`–`6` jump to the six pages, `7` opens search, `0` starts Game Mode, `*` opens Diagnostics and `#` opens the device switcher. On a keypad handset `F1` is play/pause and `F3` is next tune, from any page. `7` keeps working even with keypad navigation switched off, because search is how you get around when the keys are not doing it for you.

**Diagnostics > Key Explorer** reports what any key you press actually sends — the `key`, `code` and `keyCode`, and what the app resolves it to. It records the key's identity only, never a typed character.

Disable directional navigation under **Settings > Experimental > Keyboard and keypad navigation** for touch-only use. T9 text entry is used only in keypad-first mode; hardware keyboard input remains unchanged.

## Troubleshooting

### Cannot reach the device

- Confirm the C64 Ultimate and your device are on the same network.
- Verify the IP address or hostname in **Settings > Device > Connection**.

### Device becomes unresponsive

Open **Settings > Device Safety** and select **Balanced** (default) or **Conservative** to reduce network load. Use **Relaxed** only on stable setups. Advanced controls are available for further tuning.

### iOS specifics

- **App expired**: SideStore refreshes every 7 days automatically.
- **Account/App ID limits**: Remove unused sideloaded apps and retry.
- **Install/signing errors**: Re-download the IPA and verify its checksum.
- **Unavailable controls**: Actions not supported by the connected device remain visible but disabled, with an explanation.

## For Developers

- [Documentation index](docs/index.md)
- [DeepWiki architecture and design guide](https://deepwiki.com/chrisgleissner/c64commander)
- [Developer guide](docs/developer.md)
- [Chaos/fuzz testing](docs/testing/chaos-fuzz.md)

## Advanced Topics

Network security, web server configuration, authentication, and Linux auto-update are covered in [docs/advanced.md](docs/advanced.md).

## Acknowledgments

### High Voltage SID Collection (HVSC)

The [High Voltage SID Collection](https://hvsc.c64.org) is an archive of C64 SID music. C64 Commander integrates HVSC for browsing, searching, and playing SID tunes with metadata and song-length support.

### Commodore and the C64 Ultimate

Thanks to [Commodore](https://commodore.net) for creating the Commodore 64 and to the creators of the C64 Ultimate for extending the platform with modern hardware.

### Third-Party Libraries

C64 Commander uses many open-source libraries. Notices are generated via `scripts/generate-third-party-notices.mjs` and published as [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

GPL v3. See [LICENSE](LICENSE).
