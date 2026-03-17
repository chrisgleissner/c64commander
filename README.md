# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android.yaml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android.yaml)
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0.en.html)
[![Platform](https://img.shields.io/badge/platforms-Android%20%7C%20iOS%20%7C%20Web-blue)](https://github.com/chrisgleissner/c64commander/releases)

Your C64 Ultimate command center in your pocket.

<img src="./docs/play-store/feature-graphic-1024x500.png" alt="C64 Commander Logo" width="600"/>

C64 Commander lets you control and manage a C64 Ultimate from Android, iOS, or a self-hosted Web deployment on your local network.

> [!NOTE]
> This project is under active development, with frequent improvements across UX, stability, and feature depth.

## 📑 Contents

- [C64 Commander](#c64-commander)
  - [📑 Contents](#-contents)
  - [✨ Why C64 Commander?](#-why-c64-commander)
  - [🚀 Quick Start](#-quick-start)
    - [Current Rollout Boundaries](#current-rollout-boundaries)
    - [Install on Android](#install-on-android)
    - [Install on iOS](#install-on-ios)
    - [Install for Web Access](#install-for-web-access)
      - [Install Docker](#install-docker)
      - [Run the Container](#run-the-container)
    - [First Connection Checklist](#first-connection-checklist)
  - [🧩 What You Can Do](#-what-you-can-do)
    - [Home](#home)
    - [Play](#play)
    - [Disks](#disks)
    - [Configuration](#configuration)
    - [Settings](#settings)
    - [Docs](#docs)
    - [Diagnostics](#diagnostics)
  - [Display Profiles](#display-profiles)
  - [🛟 Troubleshooting](#-troubleshooting)
    - [Connectivity](#connectivity)
      - [Can’t reach the device](#cant-reach-the-device)
      - [Device becomes unresponsive](#device-becomes-unresponsive)
    - [iOS specifics](#ios-specifics)
  - [🔧 Advanced Topics](#-advanced-topics)
    - [Advanced - Network Security](#advanced---network-security)
    - [Web Server Details](#web-server-details)
      - [Network password model](#network-password-model)
      - [Web security](#web-security)
      - [Web logging](#web-logging)
      - [Update to a newer version](#update-to-a-newer-version)
      - [Linux auto-update](#linux-auto-update)
  - [🛠️ For Developers](#️-for-developers)
  - [🙏 Acknowledgments](#-acknowledgments)
    - [High Voltage SID Collection (HVSC)](#high-voltage-sid-collection-hvsc)
    - [Commodore and the C64 Ultimate](#commodore-and-the-c64-ultimate)
    - [Third-Party Libraries](#third-party-libraries)
  - [⚖️ License](#️-license)

## ✨ Why C64 Commander?

Because it gives you full control of your C64 Ultimate from any modern device:

- **Cross-platform access**: Native Android and iOS apps, plus a web interface served via Docker on macOS, Windows, or Linux.
- **Quick dashboard**: Access common actions and advanced controls in a clean mobile interface.
- **Deep configuration**: Browse and edit the full C64 Ultimate configuration from one place.
- **Explore your collection**: Build playlists from local files, C64 Ultimate storage, or the High Voltage SID Collection. Quickly find what you want with powerful search and filtering.
- **Manage disks efficiently**: Mount, unmount, and handle drive workflows with fewer steps.
- **Troubleshoot with confidence**: Inspect logs, traces, and activity when behavior needs a closer look.

## 🚀 Quick Start

### Current Rollout Boundaries

- Android Play upload is already operational for the supported release flow.
- iOS distribution currently remains a sideload flow built around SideStore and signed IPA installation. App Store and TestFlight distribution are not part of the current rollout scope.
- C64 Ultimate connectivity remains HTTP for REST and plain FTP for file operations because that is what current firmware supports.
- GitHub Actions release tags are an intentional contributor policy. Keep release tags aligned with `package.json`.

### Install on Android

1. Download the latest **APK** (e.g. `c64commander-0.6.4-rc2-debug.apk` for debug builds or `c64commander-0.6.4-rc2.apk` for signed release builds) from the [Releases](https://github.com/chrisgleissner/c64commander/releases) page.
2. Open the APK.
3. Allow installs from unknown sources if prompted.
4. Tap **Install** and launch C64 Commander.

### Install on iOS

1. Set up [SideStore](https://docs.sidestore.io/).
2. Download the latest **IPA** (e.g. `c64commander-0.6.4-rc2-ios.ipa`) from the [Releases](https://github.com/chrisgleissner/c64commander/releases) page.
3. In **SideStore → My Apps**, tap **+** and select the IPA.
4. Launch C64 Commander.

SideStore refreshes apps every 7 days to renew the signature automatically.

### Install for Web Access

The Web version is self-hosted and intended for LAN use. The browser connects to a local C64 Commander server, which communicates with your C64U via REST/FTP.

- Runs on Windows, macOS, or Linux.
- Raspberry Pi Zero 2W, 4B, or similar with ≥ 512 MiB RAM recommended.
- If a C64U network password is configured in Settings, it also protects the web interface.

> [!NOTE]
> Intended for trusted LAN use only. Do not expose directly to the public internet.

#### Install Docker

- For Windows and macOS, install [Docker Desktop](https://docs.docker.com/desktop/).
- For Linux, install the [Docker Engine](https://docs.docker.com/engine/install/).

The Docker image supports both `linux/amd64` and `linux/arm64` architectures. Windows and macOS run the image via Docker Desktop virtualization.

#### Run the Container

Create a writable config directory:

```bash
mkdir -p ./c64commander-config
chmod 0777 ./c64commander-config
```

Start the container:

```bash
docker run -d --name c64commander -p 8064:8064 \
  -v ./c64commander-config:/config --restart unless-stopped \
  ghcr.io/chrisgleissner/c64commander:<version>
```

Then launch C64 Commander by opening http://`<host-ip>`:8064 in a browser.

### First Connection Checklist

1. Power on the C64 Ultimate.
2. Ensure C64 Commander and C64U are on the same network.
3. In C64 Commander open **Settings → Device → Connection**.
4. Enter the correct C64U IP address or hostname.
5. Check that the C64U logo on the top-right of C64 Commander turns green.

🎉 **DONE!** C64 Commander is now connected to your C64 Ultimate.

## 🧩 What You Can Do

### Home

Your everyday dashboard: quick access to the controls you touch most often.

<table>
  <tr>
    <td><img src="doc/img/app/home/00-overview-light.png" alt="Home overview (Light)" width="360"/></td>
    <td><img src="doc/img/app/home/01-overview-dark.png" alt="Home overview (Dark)" width="360"/></td>
    <td><img src="doc/img/app/home/sections/02-quick-config-to-keyboard-light.png" alt="Home sections from quick config through keyboard light" width="360"/></td>
  </tr>
  <tr>
    <td><img src="doc/img/app/home/sections/03-quick-config-to-printers.png" alt="Home sections from quick config through printers" width="360"/></td>
    <td><img src="doc/img/app/home/sections/04-printers-to-sid.png" alt="Home sections from printers through SID" width="360"/></td>
    <td><img src="doc/img/app/home/sections/05-sid-to-config.png" alt="Home sections from SID through config" width="360"/></td>
  </tr>
  <tr>
    <td><img src="doc/img/app/home/02-connection-status-popover.png" alt="Connection Status pop-up" width="360"/></td>
    <td><img src="doc/img/app/home/03-demo-mode-interstitial.png" alt="Demo Mode interstitial" width="360"/></td>
    <td><img src="doc/img/app/home/dialogs/01-save-ram-dialog.png" alt="Save RAM type selection" width="360"/></td>
  </tr>
  <tr>
    <td><img src="doc/img/app/home/dialogs/02-save-ram-custom-range.png" alt="Save RAM custom ranges" width="360"/></td>
    <td><img src="doc/img/app/home/dialogs/03-snapshot-manager.png" alt="Load RAM snapshot manager" width="360"/></td>
    <td><img src="doc/img/app/home/dialogs/04-restore-confirmation.png" alt="Load RAM restore confirmation" width="360"/></td>
  </tr>
</table>

### Play

Build playlists from local content, C64 Ultimate storage, or HVSC, then run autoplay or shuffle sessions.

<table>
  <tr>
    <td><img src="doc/img/app/play/01-overview.png" alt="Play overview" width="360"/></td>
    <td><img src="doc/img/app/play/import/01-import-interstitial.png" alt="Play import" width="360"/></td>
    <td><img src="doc/img/app/play/sections/02-playlist.png" alt="Play playlist" width="360"/></td>
  </tr>
</table>

### Disks

View drive state, mount images quickly, and browse disk collections in one place.

<table>
  <tr>
    <td><img src="doc/img/app/disks/01-overview.png" alt="Disks overview" width="360"/></td>
    <td><img src="doc/img/app/disks/sections/02-disks.png" alt="Disks collection" width="360"/></td>
    <td><img src="doc/img/app/disks/collection/01-view-all.png" alt="Disks collection" width="360"/></td>
  </tr>
</table>

### Configuration

Access full C64 Ultimate configuration pages, from basic tuning to hardware-specific settings.

<table>
  <tr>
    <td><img src="doc/img/app/config/01-categories.png" alt="Configuration categories" width="360"/></td>
    <td><img src="doc/img/app/config/sections/05-u64-specific-settings.png" alt="Configuration U64 specific" width="360"/></td>
    <td><img src="doc/img/app/config/sections/06-c64-and-cartridge-settings.png" alt="Configuration C64 and cartridge settings" width="360"/></td>
  </tr>
</table>

### Settings

Tune appearance, connection behavior, diagnostics, playback defaults, HVSC integration, and device-safety limits.

Display profile behavior is summarized in the [Display Profiles](#display-profiles) section. The override lives in **Settings → Appearance → Display profile** and is useful for previewing or locking a profile on tablets and the self-hosted web app.

<table>
  <tr>
    <td><img src="doc/img/app/settings/sections/01-appearance.png" alt="Settings appearance" width="360"/></td>
    <td><img src="doc/img/app/settings/sections/02-connection.png" alt="Settings connection" width="360"/></td>
    <td><img src="doc/img/app/settings/sections/03-diagnostics.png" alt="Settings diagnostics" width="360"/></td>
  </tr>
  <tr>
    <td><img src="doc/img/app/settings/sections/04-play-and-disk.png" alt="Settings play and disk" width="360"/></td>
    <td><img src="doc/img/app/settings/sections/05-config.png" alt="Settings configuration" width="360"/></td>
    <td><img src="doc/img/app/settings/sections/07-device-safety.png" alt="Settings device safety" width="360"/></td>
  </tr>
</table>

### Docs

Built-in guides for setup, workflows, and practical day-to-day usage.

<table>
  <tr>
    <td><img src="doc/img/app/docs/01-overview.png" alt="Docs overview" width="360"/></td>
    <td><img src="doc/img/app/docs/sections/01-getting-started.png" alt="Docs getting started" width="360"/></td>
    <td><img src="doc/img/app/docs/sections/05-swapping-disks.png" alt="Docs swapping disks" width="360"/></td>
  </tr>
</table>

### Diagnostics

Track actions, inspect traces, and export logs when it is time for serious troubleshooting.

- `Share` exports the active diagnostics tab as a ZIP containing one timestamped JSON file.
- `Share All` exports errors, logs, traces, and action summaries together in a single ZIP with a shared UTC timestamp in every filename.

<table>
  <tr>
    <td><img src="doc/img/app/diagnostics/01-actions-detail.png" alt="Diagnostics actions" width="360"/></td>
    <td><img src="doc/img/app/diagnostics/02-traces-detail.png" alt="Diagnostics traces" width="360"/></td>
    <td><img src="doc/img/app/diagnostics/03-logs.png" alt="Diagnostics logs" width="360"/></td>
  </tr>
</table>

Full screenshot set: [doc/img/app/](doc/img/app/)

Profile-specific screenshots:

- See [Display Profiles](#display-profiles) for the naming and automatic-selection model used throughout this README.
- Screenshots outside `profiles/` folders show the default Standard display documentation profile unless the caption says otherwise.
- Profile-specific screenshots live under `doc/img/app/<page>/profiles/compact/`, `doc/img/app/<page>/profiles/medium/`, and `doc/img/app/<page>/profiles/expanded/` when the visible layout differs from the default profile.

## Display Profiles

C64 Commander uses **Display Profiles** so the interface remains comfortable to use on a wide range of screens, from small phones to tablets and desktop browsers:

| Profile name     | Profile ID | Device Type                           |
| ---------------- | ---------- | ------------------------------------- |
| Small display    | compact    | Narrow screens such as smaller phones |
| Standard display | medium     | Most phones                           |
| Large display    | expanded   | Tablets or wide browser windows       |

When **Settings → Appearance → Display profile** is set to **Auto**, C64 Commander automatically chooses the most suitable profile based on the **available width of the app window**.

The following screenshots show the same **Home page** rendered with the three display profiles:

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
          src="doc/img/app/home/profiles/compact/01-overview.png"
          alt="Home page in the Small display profile"
        />
      </td>
      <td valign="top">
        <img
          src="doc/img/app/home/profiles/medium/01-overview.png"
          alt="Home page in the Standard display profile"
        />
      </td>
      <td valign="top">
        <img
          src="doc/img/app/home/profiles/expanded/01-overview.png"
          alt="Home page in the Large display profile"
        />
      </td>
    </tr>
  </tbody>
</table>

## 🛟 Troubleshooting

### Connectivity

#### Can’t reach the device

- Confirm your C64 Ultimate and mobile device are on the same network.
- Confirm IP address / hostname in **Settings → Device → Connection**.

#### Device becomes unresponsive

C64 Commander includes configurable **Device Safety** controls under **Settings → Device Safety** to help avoid overload from REST and FTP traffic. REST mutations are fixed to a single in-flight lane; the presets and advanced controls tune the remaining pacing and FTP pressure. If you spot issues with the default **Balanced** preset, try **Conservative**.

- **Presets**: Relaxed, Balanced (default), Conservative
- **Advanced controls**: FTP concurrency, read coalescing windows, cooldowns, backoff strategy, circuit-breaker thresholds, discovery probe interval
- **Important**: Relaxed settings can overwhelm some setups. Use carefully.

### iOS specifics

- **App expired**: Apps installed via SideStore need a refresh every 7 days which should happen automatically.
- **Account/App ID limits**: Remove unused sideloaded apps and retry.
- **Install/signing errors**: Re-download the IPA and checksum, then verify again.
- **Compatibility note**: CI runtime selection validates iOS `26 -> 18 -> 17`; iOS 17 and 18 are baseline support targets.

## 🔧 Advanced Topics

### Advanced - Network Security

The C64 Ultimate firmware currently exposes REST over HTTP and file operations over plain FTP. C64 Commander follows that firmware model and does not add protocol-level encryption.

- Password authentication remains supported and enabled.
- Device host configuration supports practical LAN usage patterns, including private IPs and local hostnames used in home/lab networks.
- Diagnostics and traces redact sensitive values (including network password headers) before export/display.

Optional hardening you can apply in your environment:

1. Run C64 Commander Web behind an HTTPS reverse proxy (for example, on a Raspberry Pi with Caddy or Nginx).
2. Keep C64 Ultimate and client devices on an isolated VLAN or a dedicated trusted LAN segment.
3. Avoid exposing C64 Commander or C64 Ultimate directly to the public internet.

### Web Server Details

#### Network password model

- If no network password is configured, the UI opens directly.
- If a network password is configured in **Settings → Device → Network password**, login is required and the server injects the password into proxied C64U requests.
- After saving that setting, the web server persists it in `/config/web-config.json`; on the next access (or after logout), login is required with that same password.
- Successful login creates an authenticated session cookie (`HttpOnly`, `SameSite=Lax`, optional `Secure`), so you do not re-enter the password on every request.

#### Web security

- `Secure` cookies are enabled automatically when `NODE_ENV=production` (override with `WEB_COOKIE_SECURE=true|false`).
- FTP host override is disabled by default to prevent open-proxy behavior. Set `WEB_ALLOW_REMOTE_FTP_HOSTS=true` only in trusted/dev setups.

#### Web logging

- Web server logs are emitted to container stdout/stderr (for Docker logs) and mirrored into the in-app diagnostics logs overlay.
- `basic-ftp` is a runtime dependency because FTP list/read requests are executed by the web server process.

#### Update to a newer version

The web app shell is intentionally fetched from the network on each navigation, while hashed static assets roll forward with a build-specific service-worker cache. After deploying a new image, open the app once to let the new service worker activate. If a browser tab is still holding the old shell in memory, reload the tab.

Rollback uses the same flow: redeploy the older image, open the app, and reload once so the browser activates the matching service worker and clears the newer asset cache.

```bash
docker pull ghcr.io/chrisgleissner/c64commander:<version>
docker rm -f c64commander
docker run -d --name c64commander -p 8064:8064 -v ./c64commander-config:/config --restart unless-stopped ghcr.io/chrisgleissner/c64commander:<version>
```

#### Linux auto-update

For Linux hosts (including Raspberry Pi), an updater script is available at [scripts/web-auto-update.sh](scripts/web-auto-update.sh).

Recommended mode (`tags`) tracks new GitHub release tags and restarts the container only when a new release appears.

Development mode (`ref`) tracks any branch/ref commit and rebuilds from source on update.

> [!IMPORTANT]
> Use `--track tags` for normal deployments. Use `--track ref` only when developing/testing branch changes.

Prepare once:

```bash
chmod +x scripts/web-auto-update.sh
mkdir -p ./c64commander-config
```

Run in release-tag mode (recommended):

```bash
./scripts/web-auto-update.sh \
  --track tags \
  --interval 300 \
  --container-name c64commander \
  --config-dir ./c64commander-config
```

Run in branch/ref mode (development):

```bash
./scripts/web-auto-update.sh \
  --track ref \
  --ref feat/web \
  --interval 120 \
  --container-name c64commander-dev \
  --config-dir ./c64commander-config-dev
```

Run as a systemd service (Linux):

```bash
sudo tee /etc/systemd/system/c64commander-updater.service >/dev/null <<'EOF'
[Unit]
Description=C64 Commander Web Auto Updater
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/c64commander
ExecStart=/opt/c64commander/scripts/web-auto-update.sh --track tags --interval 300 --container-name c64commander --config-dir /opt/c64commander/config
Restart=always
RestartSec=10
User=pi
Group=pi

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now c64commander-updater.service
```

Optional GitHub API token (helps with rate limits):

```bash
export GITHUB_TOKEN=<your-token>
```

## 🛠️ For Developers

If you want to build, test, or contribute:

- Documentation index: [doc/index.md](doc/index.md)
- Developer guide: [doc/developer.md](doc/developer.md)
- Chaos/fuzz testing docs: [doc/testing/chaos-fuzz.md](doc/testing/chaos-fuzz.md)
- Web server runtime dependency note: `basic-ftp` is in `dependencies` because the web server uses it at runtime inside the Docker image.
- OSS compliance / notices (Linux-friendly):
  - `npm run notices:generate` to regenerate `THIRD_PARTY_NOTICES.md` at repo root from dependency metadata
  - `npm run notices:check` to enforce deterministic root notice output
  - `npm run build` automatically refreshes notices and packages `THIRD_PARTY_NOTICES.md` into `dist/` for web / Android / iOS app bundles

## 🙏 Acknowledgments

This project would not be possible without the following:

### High Voltage SID Collection (HVSC)

The [High Voltage SID Collection](https://hvsc.c64.org) is an amazing archive of C64 music, preserving decades of SID chip artistry. C64 Commander uses HVSC to provide access to thousands of SID tunes, making it easy to explore and enjoy the rich history of C64 music.

### Commodore and the C64 Ultimate

Heartfelt thanks to [Commodore](https://commodore.net) for creating the Commodore 64, a machine that defined a generation of computing and gaming. Special recognition goes to the creators of the C64 Ultimate (Ultimate 64) for breathing new life into this classic platform with modern hardware that maintains the authentic C64 experience while adding powerful new capabilities.

Commodore and Commodore 64 are trademarks of their respective owners. C64 Commander is an independent project and is not affiliated with, endorsed by, or sponsored by Commodore or C64 Ultimate rights holders.

### Third-Party Libraries

C64 Commander builds on many excellent open-source projects. Notices are generated via `scripts/generate-third-party-notices.mjs` and published as [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## ⚖️ License

This project is licensed under GPL v3. See [LICENSE](LICENSE) for details.
