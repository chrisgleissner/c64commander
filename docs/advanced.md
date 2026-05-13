# Advanced Topics

## Network Security

The C64 Ultimate firmware exposes REST over HTTP and files over plain FTP. C64 Commander follows that model and does not add encryption.

- Password authentication is supported.
- Diagnostics and traces redact sensitive values (including network password headers) before export.

Optional hardening:

1. Run C64 Commander Web behind an HTTPS reverse proxy (Caddy, Nginx).
2. Keep C64 Ultimate and client devices on an isolated VLAN or dedicated LAN segment.
3. Do not expose C64 Commander or C64 Ultimate to the public internet.

## Web Server

### Authentication

- No network password configured: the UI opens directly.
- Network password configured in **Settings > Device > Network password**: login is required. The server injects the password into proxied C64U requests.
- The password is persisted in `/config/web-config.json`. Successful login creates an authenticated session cookie (`HttpOnly`, `SameSite=Lax`; add `Secure` only for HTTPS deployments).

### Security settings

- Plain-HTTP LAN deployments keep session cookies HTTP-compatible by default so the documented Docker flow can authenticate successfully.
- Set `WEB_COOKIE_SECURE=true` only when the app is served over HTTPS or an HTTPS reverse proxy. Set `WEB_COOKIE_SECURE=false` to force HTTP-compatible cookies explicitly.
- FTP host override is disabled by default. Set `WEB_ALLOW_REMOTE_FTP_HOSTS=true` only in trusted setups.

### Logging

Web server logs go to container stdout/stderr and are mirrored in the in-app diagnostics overlay.

### Updating

After deploying a new image, open the app once to activate the new service worker. Reload any tabs still holding the old shell.

```bash
docker pull ghcr.io/chrisgleissner/c64commander:<version>
docker rm -f c64commander
docker run -d --name c64commander -p 8064:8064 -v ./c64commander-config:/config --restart unless-stopped ghcr.io/chrisgleissner/c64commander:<version>
```

Rollback: redeploy the older image and reload.

### Linux auto-update

An updater script is available at [scripts/web-auto-update.sh](../scripts/web-auto-update.sh).

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
