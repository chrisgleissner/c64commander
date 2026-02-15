# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android-apk.yaml)
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
[![License: GPL v2](https://img.shields.io/badge/License-GPL%20v2-blue.svg)](https://www.gnu.org/licenses/old-licenses/gpl-2.0.en.html)
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
    - [Install on Android](#install-on-android)
    - [Install on iOS](#install-on-ios)
    - [Install for Web Access](#install-for-web-access)
      - [Docker installation](#docker-installation)
      - [Run Docker container](#run-docker-container)
    - [First Connection Checklist](#first-connection-checklist)
  - [🧩 What You Can Do](#-what-you-can-do)
    - [Home](#home)
    - [Play](#play)
    - [Disks](#disks)
    - [Configuration](#configuration)
    - [Settings](#settings)
    - [Docs](#docs)
    - [Diagnostics](#diagnostics)
  - [🛟 Troubleshooting](#-troubleshooting)
    - [Connectivity](#connectivity)
      - [Can’t reach the device](#cant-reach-the-device)
      - [Device becomes unresponsive](#device-becomes-unresponsive)
    - [iOS specifics](#ios-specifics)
  - [🛠️ For Developers](#️-for-developers)
  - [� Advanced Topics](#-advanced-topics)
    - [Linux auto-update service](#linux-auto-update-service)
  - [� Acknowledgments](#-acknowledgments)
    - [High Voltage SID Collection (HVSC)](#high-voltage-sid-collection-hvsc)
    - [Commodore and the C64 Ultimate](#commodore-and-the-c64-ultimate)
    - [Third-Party Libraries](#third-party-libraries)
  - [⚖️ License](#️-license)

## ✨ Why C64 Commander?

Because it gives you full control of your C64 Ultimate from any modern device:

- **Cross-platform access**: Native Android and iOS apps, plus a web interface served via Docker on macOS, Windows, or Linux.
- **Quick dashboard**: Access common actions and advanced controls in a clean mobile interface.
- **Deep configuration**: Browse and edit the full C64 Ultimate configuration from one place.
- **Explore your collection**: Build playlists from local files, C64 Ultimate storage, or the High Voltage SID Collection ([HVSC](https://hvsc.c64.org)). Quickly find what you want with powerful search and filtering.
- **Manage disks efficiently**: Mount, unmount, and handle drive workflows with fewer steps.
- **Troubleshoot with confidence**: Inspect logs, traces, and activity when behavior needs a closer look.


## 🚀 Quick Start

### Install on Android

1. Download `c64commander-<version>.apk` from the latest GitHub release.
2. Open the file on your phone.
3. Allow installs from unknown sources if prompted.
4. Tap **Install**.
5. Launch C64 Commander from your home screen.

Done.

### Install on iOS

iOS builds are distributed via AltStore.

1. Install **AltServer** on a Mac or Windows PC from https://altstore.io, then connect your iPhone via USB.
2. In AltServer, choose **Install AltStore → [your iPhone]** and sign in with your Apple ID.
3. Open **AltStore** on your iPhone.
4. Download `c64commander-altstore-<version>.ipa` from the latest GitHub release and transfer it to your iPhone.
5. In **AltStore → My Apps**, tap `+` and select the IPA.
6. Launch C64 Commander from your home screen.

Done.

AltStore automatically refreshes installed apps in the background when your iPhone can reach AltServer on your local network.

### Install for Web Access

The Web platform is self-hosted and LAN-accessible. The browser talks to a local C64 Commander server which in turn calls your C64U via REST/FTP.
- The C64 Commander web server can be hosted on Windows, Mac, or Linux.
- Using a Raspberry Pi Zero 2W, 4B or above with at least 512MiB RAM is recommended due to its low cost and power use.
- If desired, access can be secured via the same Network password that also protects your C64 Ultimate.

#### Docker installation

- Windows (Docker Desktop): https://docs.docker.com/desktop/setup/install/windows-install/
- macOS (Docker Desktop): https://docs.docker.com/desktop/setup/install/mac-install/
- Linux (Docker Engine): https://docs.docker.com/engine/install/

Supported container architectures (MVP only):

- `linux/amd64`
- `linux/arm64`

These images also run on Windows/macOS through Docker Desktop virtualization.

#### Run Docker container

```bash
docker run -d \
  --name c64commander \
  -p 8064:8064 \
  -v ./c64commander-config:/config \
  --restart unless-stopped \
  ghcr.io/chrisgleissner/c64commander:<version>
```

Then open:

`http://<host-ip>:8064`

Raspberry Pi example (64-bit OS):

```bash
docker run -d --name c64commander -p 8064:8064 -v /home/pi/c64commander-config:/config --restart unless-stopped ghcr.io/chrisgleissner/c64commander:<version>
```

Ensure Docker starts on boot:
```bash
sudo systemctl enable --now docker
```

Network password model:

- If no network password is configured, the UI opens directly.
- If a network password is configured, login is required and the server injects the password into proxied C64U requests.
- You do **not** need to set a password when starting the Docker container.
- Preferred flow: start without a password, then set **Settings → Device → Network password** in the app.
- After saving that setting, the web server persists it in `/config/web-config.json`; on the next access (or after logout), login is required with that same password.
- Successful login creates an authenticated session cookie (`HttpOnly`, `SameSite=Lax`, optional `Secure`), so you do not re-enter the password on every request.

Update to a newer version:

```bash
docker pull ghcr.io/chrisgleissner/c64commander:<version>
docker rm -f c64commander
docker run -d --name c64commander -p 8064:8064 -v ./c64commander-config:/config --restart unless-stopped ghcr.io/chrisgleissner/c64commander:<version>
```

> [!WARNING]
> Web mode is intended for trusted LAN use. Do not expose it directly to the public internet.

Additional web security defaults:

- Session cookies are `HttpOnly` + `SameSite=Lax`.
- `Secure` cookies are enabled automatically when `NODE_ENV=production` (override with `WEB_COOKIE_SECURE=true|false`).
- FTP host override is disabled by default to prevent open-proxy behavior. Set `WEB_ALLOW_REMOTE_FTP_HOSTS=true` only in trusted/dev setups.

Web logging behavior:

- Web server logs are emitted to container stdout/stderr (for Docker logs) and mirrored into the in-app diagnostics logs overlay.
- `basic-ftp` is a runtime dependency because FTP list/read requests are executed by the web server process.

### First Connection Checklist

Before first use:

1. Power on your C64 Ultimate.
2. Make sure your phone and C64 Ultimate are on the same network.
3. In the app, open **Settings → Device → Connection**.
4. Enter the correct C64 Ultimate IP address or hostname.

## 🧩 What You Can Do

### Home

Your everyday dashboard: quick access to the controls you touch most often.

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

<table>
  <tr>
    <td><img src="doc/img/app/diagnostics/01-actions-expanded.png" alt="Diagnostics actions" width="360"/></td>
    <td><img src="doc/img/app/diagnostics/02-traces-expanded.png" alt="Diagnostics traces" width="360"/></td>
    <td><img src="doc/img/app/diagnostics/03-logs.png" alt="Diagnostics logs" width="360"/></td>
  </tr>
</table>

Full screenshot set: [doc/img/app/](doc/img/app/)

## 🛟 Troubleshooting

### Connectivity

#### Can’t reach the device

- Confirm your C64 Ultimate and mobile device are on the same network.
- Confirm IP address / hostname in **Settings → Device → Connection**.

#### Device becomes unresponsive

C64 Commander includes configurable **Device Safety** controls under **Settings → Device Safety** to help avoid overload from REST and FTP traffic. If you spot issues with the default **Balanced** preset, try **Conservative**.

- **Presets**: Relaxed, Balanced (default), Conservative
- **Advanced controls**: REST/FTP concurrency, read coalescing windows, cooldowns, backoff strategy, circuit-breaker thresholds, discovery probe interval
- **Important**: Relaxed settings can overwhelm some setups. Use carefully.

### iOS specifics

- **App expired**: Free Apple ID sideloads in AltStore usually need refresh roughly every 7 days.
- **Account/App ID limits**: Remove unused sideloaded apps and retry.
- **Install/signing errors**: Re-download the IPA and checksum, then verify again.
- **Compatibility note**: CI runtime selection validates iOS `26 -> 18 -> 17`; iOS 17 and 18 are baseline support targets.

## 🛠️ For Developers

If you want to build, test, or contribute:

- Developer guide: [doc/developer.md](doc/developer.md)
- Chaos/fuzz testing docs: [doc/testing/chaos-fuzz.md](doc/testing/chaos-fuzz.md)
- Web server runtime dependency note: `basic-ftp` is in `dependencies` because the web server uses it at runtime inside the Docker image.

## 🔧 Advanced Topics

### Linux auto-update service

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

## � Acknowledgments

This project would not be possible without the following:

### High Voltage SID Collection (HVSC)

The [High Voltage SID Collection](https://hvsc.c64.org) is an amazing archive of C64 music, preserving decades of SID chip artistry. C64 Commander uses HVSC to provide access to thousands of SID tunes, making it easy to explore and enjoy the rich history of C64 music.

### Commodore and the C64 Ultimate

Heartfelt thanks to [Commodore](https://commodore.net) for creating the Commodore 64, a machine that defined a generation of computing and gaming. Special recognition goes to the creators of the C64 Ultimate (Ultimate 64) for breathing new life into this classic platform with modern hardware that maintains the authentic C64 experience while adding powerful new capabilities.

### Third-Party Libraries

C64 Commander builds on many excellent open-source projects. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for a detailed list of third-party components and their licenses.

## ⚖️ License

This project is licensed under GPL v3. See [LICENSE](LICENSE) for details.
