# C64 Commander

[![Build](https://github.com/chrisgleissner/c64commander/actions/workflows/android.yaml/badge.svg?branch=main)](https://github.com/chrisgleissner/c64commander/actions/workflows/android.yaml)
[![codecov](https://codecov.io/gh/chrisgleissner/c64commander/graph/badge.svg?token=hGEe09SZch)](https://codecov.io/gh/chrisgleissner/c64commander)
[![License: GPL v3](https://img.shields.io/badge/License-GPL%20v3-blue.svg)](https://www.gnu.org/licenses/gpl-3.0.en.html)
[![Platform](https://img.shields.io/badge/platforms-Android%20%7C%20iOS%20%7C%20Web-blue)](https://github.com/chrisgleissner/c64commander/releases)

Control and manage a C64 Ultimate from Android, iOS, or a self-hosted web deployment on your local network.

<img src="./docs/site/play-store/feature-graphic-1024x500.png" alt="C64 Commander" width="600"/>

## Features

- **Cross-platform**: Native Android and iOS apps, plus a Docker-based web interface for macOS, Windows, or Linux.
- **Dashboard**: Machine controls, Telnet-backed quick actions, drive and printer shortcuts, SID mixer, and streams on a single page.
- **Configuration**: Browse and edit the full C64 Ultimate configuration tree.
- **Playlists**: Build playlists from local files, C64U storage, the High Voltage SID Collection (HVSC), or CommoServe search results. Autoplay, shuffle, and subsong selection.
- **Disk management**: Mount, unmount, and rotate multi-disk groups across drives.
- **Diagnostics**: Inspect activity logs, traces, latency, and connection health across App, REST, FTP, and Telnet activity.

## Quick Start

### Android

1. Download the latest APK from [Releases](https://github.com/chrisgleissner/c64commander/releases).
2. Open the APK and allow installs from unknown sources if prompted.
3. Tap **Install**.

### iOS

1. Set up [SideStore](https://docs.sidestore.io/).
2. Download the latest IPA from [Releases](https://github.com/chrisgleissner/c64commander/releases).
3. In **SideStore > My Apps**, tap **+** and select the IPA.

SideStore refreshes the app signature automatically every 7 days.

### Web (Docker)

The web version is self-hosted for LAN use. Requirements: Docker on Windows, macOS, or Linux. A Raspberry Pi Zero 2W or 4B with 512 MiB RAM or more is sufficient.

Install Docker: [Docker Desktop](https://docs.docker.com/desktop/) (Windows/macOS) or [Docker Engine](https://docs.docker.com/engine/install/) (Linux). The image supports `linux/amd64` and `linux/arm64`.

```bash
mkdir -p ./c64commander-config && chmod 0777 ./c64commander-config

docker run -d --name c64commander -p 8064:8064 \
  -v ./c64commander-config:/config --restart unless-stopped \
  ghcr.io/chrisgleissner/c64commander:<version>
```

Open `http://<host-ip>:8064` in a browser.

If a network password is configured in **Settings > Device > Network password**, the web interface requires login with the same password.

### First Connection

Ensure the C64 Ultimate is on your local network with required services enabled:

![Network services & timezone menu](docs/img/setup/enable_services.png)

On the C64 Ultimate:

1. Press **CBM+Restore** and open **Network services & timezone**.
2. Enable:
   - **Web Remote Control Service** - REST API used for most control and status operations
   - **FTP File Service** - required for browsing and transferring files for playlists and disk collections
   - **Telnet Remote Menu Service** - used for a small set of advanced operations not available via REST, such as power cycle
3. Note the IP address from **Wired Network Setup** or **WI-FI Network Setup**.

In C64 Commander:

1. Open **Settings > Device > Connection**.
2. Enter the C64 Ultimate IP address or hostname.
3. A green health indicator at the top right confirms the successful connection:

![Connected C64U badge](docs/img/app/home/02-connection-status-popover.png)

## Pages

### Home

Operational dashboard: machine controls, quick actions, light effects, drives, printer, SID mixer, streams, and configuration snapshots.

<table>
  <tr>
    <td><img src="docs/img/app/home/00-overview-light.png" alt="Home overview (Light)" width="360"/></td>
    <td><img src="docs/img/app/home/01-overview-dark.png" alt="Home overview (Dark)" width="360"/></td>
    <td><img src="docs/img/app/home/sections/02-quick-config-to-keyboard-light.png" alt="Home sections from quick config through keyboard light" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/home/sections/03-quick-config-to-printers.png" alt="Home sections from quick config through printers" width="360"/></td>
    <td><img src="docs/img/app/home/sections/04-printers-to-sid.png" alt="Home sections from printers through SID" width="360"/></td>
    <td><img src="docs/img/app/home/sections/05-sid-to-config.png" alt="Home sections from SID through config" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/home/dialogs/05-lighting-studio-medium.png" alt="Lighting Studio bottom sheet" width="360"/></td>
    <td><img src="docs/img/app/home/03-demo-mode-interstitial.png" alt="Demo Mode interstitial" width="360"/></td>
    <td><img src="docs/img/app/home/dialogs/01-save-ram-dialog.png" alt="Save RAM type selection" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/home/dialogs/02-save-ram-custom-range.png" alt="Save RAM custom ranges" width="360"/></td>
    <td><img src="docs/img/app/home/dialogs/03-snapshot-manager.png" alt="Load RAM snapshot manager" width="360"/></td>
    <td><img src="docs/img/app/home/dialogs/04-restore-confirmation.png" alt="Load RAM restore confirmation" width="360"/></td>
  </tr>
</table>

### Play

Build playlists for programs and songs sourced from the local device, C64U storage, CommoServe, or HVSC. Supports autoplay, shuffle, repeat, subsong selection, and automatic song length discovery.

<table>
  <tr>
    <td><img src="docs/img/app/play/01-overview.png" alt="Play overview" width="360"/></td>
    <td><img src="docs/img/app/play/sections/02-playlist.png" alt="Play playlist" width="360"/></td>
    <td><img src="docs/img/app/play/playlist/01-view-all.png" alt="Play playlist view all" width="360"/></td>
  </tr>
</table>

### Browse & Import

Choose an import source from the same playlist workflow: add local folders from your device, browse your C64U storage, or search CommoServe and import the matching results.

<table>
  <tr>
    <td><img src="docs/img/app/play/import/01-import-interstitial.png" alt="Import source chooser" width="360"/></td>
    <td><img src="docs/img/app/play/import/02-c64u-file-picker.png" alt="C64U file browser" width="360"/></td>
    <td><img src="docs/img/app/play/import/03-local-file-picker.png" alt="Local folder import" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/play/import/04-commoserve-search.png" alt="CommoServe search form" width="360"/></td>
    <td><img src="docs/img/app/play/import/05-commoserve-results-selected.png" alt="CommoServe results with selection" width="360"/></td>
    <td></td>
  </tr>
</table>

### Disks

View drive state, mount and eject images, and manage disk collections with multi-disk group rotation.

<table>
  <tr>
    <td><img src="docs/img/app/disks/01-overview.png" alt="Disks overview" width="360"/></td>
    <td><img src="docs/img/app/disks/sections/02-disks.png" alt="Disks collection" width="360"/></td>
    <td><img src="docs/img/app/disks/collection/01-view-all.png" alt="Disks collection" width="360"/></td>
  </tr>
</table>

### Configuration

Browse and edit the full C64 Ultimate configuration: categories, items, sliders, toggles, and per-item refresh.

<table>
  <tr>
    <td><img src="docs/img/app/config/01-categories.png" alt="Configuration categories" width="360"/></td>
    <td><img src="docs/img/app/config/sections/05-u64-specific-settings.png" alt="Configuration U64 specific" width="360"/></td>
    <td><img src="docs/img/app/config/sections/06-c64-and-cartridge-settings.png" alt="Configuration C64 and cartridge settings" width="360"/></td>
  </tr>
</table>

### Settings

Connection, appearance, diagnostics, playback defaults, HVSC integration, and device-safety controls.

<table>
  <tr>
    <td><img src="docs/img/app/settings/sections/01-appearance.png" alt="Settings appearance" width="360"/></td>
    <td><img src="docs/img/app/settings/sections/02-connection.png" alt="Settings connection" width="360"/></td>
    <td><img src="docs/img/app/settings/sections/03-diagnostics.png" alt="Settings diagnostics" width="360"/></td>
  </tr>
  <tr>
    <td><img src="docs/img/app/settings/sections/04-play-and-disk.png" alt="Settings play and disk" width="360"/></td>
    <td><img src="docs/img/app/settings/sections/05-config.png" alt="Settings configuration" width="360"/></td>
    <td><img src="docs/img/app/settings/sections/07-device-safety.png" alt="Settings device safety" width="360"/></td>
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

Accessible via the C64U connectivity badge in the top-right corner. Provides health checks, activity logs, trace inspection, filter editor, and latency analysis across App, REST, FTP, and Telnet contributors.

<table>
  <tr>
    <td><img src="docs/img/app/diagnostics/tools/01-menu.png" alt="Diagnostics overview" width="360"/></td>
    <td><img src="docs/img/app/diagnostics/activity/07-problems-only.png" alt="Diagnostics activity list" width="360"/></td>
    <td><img src="docs/img/app/diagnostics/filters/02-editor.png" alt="Diagnostics filter editor" width="360"/></td>
  </tr>
</table>

## Display Profiles

The layout adapts automatically based on viewport width: Small (phones), Standard (large phones and small tablets), and Large (tablets and desktops). Override in **Settings > Display Profile**.

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

## Troubleshooting

### Can't reach the device

- Confirm the C64 Ultimate and your device are on the same network.
- Verify the IP address or hostname in **Settings > Device > Connection**.

### Device becomes unresponsive

C64 Commander includes **Device Safety** controls under **Settings > Device Safety** to throttle REST and FTP traffic. REST mutations use a single in-flight lane; presets and advanced controls tune FTP concurrency and backoff behavior.

- **Presets**: Relaxed, Balanced (default), Conservative.
- **Advanced controls**: FTP concurrency, read coalescing, cooldowns, backoff strategy, circuit-breaker thresholds, discovery probe interval.
- The Relaxed preset can overwhelm some setups. Start with Balanced or Conservative.

### iOS specifics

- **App expired**: SideStore refreshes every 7 days automatically.
- **Account/App ID limits**: Remove unused sideloaded apps and retry.
- **Install/signing errors**: Re-download the IPA and verify its checksum.

## Advanced Topics

### Network Security

The C64 Ultimate firmware exposes REST over HTTP and files over plain FTP. C64 Commander follows that model and does not add encryption.

- Password authentication is supported.
- Diagnostics and traces redact sensitive values (including network password headers) before export.

Optional hardening:

1. Run C64 Commander Web behind an HTTPS reverse proxy (Caddy, Nginx).
2. Keep C64 Ultimate and client devices on an isolated VLAN or dedicated LAN segment.
3. Do not expose C64 Commander or C64 Ultimate to the public internet.

### Web Server

#### Authentication

- No network password configured: the UI opens directly.
- Network password configured in **Settings > Device > Network password**: login is required. The server injects the password into proxied C64U requests.
- The password is persisted in `/config/web-config.json`. Successful login creates an authenticated session cookie (`HttpOnly`, `SameSite=Lax`, optional `Secure`).

#### Security settings

- `Secure` cookies are enabled when `NODE_ENV=production`. Override with `WEB_COOKIE_SECURE=true|false`.
- FTP host override is disabled by default. Set `WEB_ALLOW_REMOTE_FTP_HOSTS=true` only in trusted setups.

#### Logging

Web server logs go to container stdout/stderr and are mirrored in the in-app diagnostics overlay.

#### Updating

After deploying a new image, open the app once to activate the new service worker. Reload any tabs still holding the old shell.

```bash
docker pull ghcr.io/chrisgleissner/c64commander:<version>
docker rm -f c64commander
docker run -d --name c64commander -p 8064:8064 -v ./c64commander-config:/config --restart unless-stopped ghcr.io/chrisgleissner/c64commander:<version>
```

Rollback: redeploy the older image and reload.

#### Linux auto-update

An updater script is available at [scripts/web-auto-update.sh](scripts/web-auto-update.sh).

- `--track tags` (recommended): tracks GitHub release tags.
- `--track ref`: tracks a branch/ref and rebuilds from source on update.

> [!IMPORTANT]
> Use `--track tags` for normal deployments. Use `--track ref` only for development.

```bash
chmod +x scripts/web-auto-update.sh
mkdir -p ./c64commander-config
```

Release-tag mode:

```bash
./scripts/web-auto-update.sh \
  --track tags \
  --interval 300 \
  --container-name c64commander \
  --config-dir ./c64commander-config
```

Branch/ref mode:

```bash
./scripts/web-auto-update.sh \
  --track ref \
  --ref feat/web \
  --interval 120 \
  --container-name c64commander-dev \
  --config-dir ./c64commander-config-dev
```

systemd service:

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

Optional GitHub API token (avoids rate limits):

```bash
export GITHUB_TOKEN=<your-token>
```

## For Developers

- [Documentation index](docs/index.md)
- [Developer guide](docs/developer.md)
- [Chaos/fuzz testing](docs/testing/chaos-fuzz.md)

Third-party notices: `npm run notices:generate` regenerates [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). `npm run build` packages notices into distribution bundles automatically.

## Acknowledgments

### High Voltage SID Collection (HVSC)

The [High Voltage SID Collection](https://hvsc.c64.org) is an archive of C64 SID music. C64 Commander integrates HVSC for browsing, searching, and playing SID tunes with metadata and song-length support.

### Commodore and the C64 Ultimate

Thanks to [Commodore](https://commodore.net) for creating the Commodore 64 and to the creators of the C64 Ultimate for extending the platform with modern hardware.

### Third-Party Libraries

C64 Commander uses many open-source libraries. Notices are generated via `scripts/generate-third-party-notices.mjs` and published as [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## License

GPL v3. See [LICENSE](LICENSE).
