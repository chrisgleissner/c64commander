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
- Network password configured in **Settings > Device > Network password**: login is required. The server injects the password into requests proxied to the configured device.
- The password is persisted in `/config/web-config.json`. Successful login creates an authenticated session cookie (`HttpOnly`, `SameSite=Lax`; add `Secure` only for HTTPS deployments).
- Sessions are held in the server's memory with a 24-hour lifetime, so restarting the container signs every browser out. An unauthenticated page navigation is answered with the login page whatever the path, and the app's own requests get a 401 carrying `X-C64Commander-Gate: session-expired`, which sends the browser back to the login page instead of asking for the device's network password.
- The password is stored in plaintext, so the server writes `/config/web-config.json` with mode `0600` and tightens an existing file to `0600` on startup. Give the host directory behind the `/config` volume to the user the container runs as, and do not make it group- or world-readable.

### Security settings

- Set `WEB_TRUST_PROXY=true` when a reverse proxy you control sits in front of the server. One switch governs all three proxy-dependent behaviours: the login rate limiter keys on `X-Forwarded-For`, `X-Forwarded-Proto: https` produces an HSTS header, and it also marks the session cookie `Secure`.
- Leave `WEB_TRUST_PROXY` unset for the default Docker deployment, which binds `0.0.0.0:8064` directly. Both forwarded headers are then ignored, because any client on the LAN can send them: the rate limiter keys on the socket address instead, and no HSTS or `Secure` flag is emitted.
- Failed logins are limited per key (5 in 10 minutes, then a 5-minute block) and across all keys (30 in 10 minutes). The second budget stops a client that varies its forwarded address to get a fresh key per attempt. A successful login clears both.
- Plain-HTTP LAN deployments keep session cookies HTTP-compatible by default so the documented Docker flow can authenticate successfully.
- `WEB_COOKIE_SECURE` overrides the cookie flag in either direction. Set it to `true` for an HTTPS deployment you have not marked as proxied, or to `false` to force HTTP-compatible cookies behind a trusted proxy.
- FTP and REST both reach any host that resolves entirely to private-range addresses, which covers a device saved under a LAN name such as `u64` or `c64u.lan` and a second Ultimate alongside the configured one. A name that resolves to a public address is refused with 403 and `X-C64Commander-Gate: host-policy`, which the app reports as a policy rejection rather than a password prompt. Resolution results are cached for a minute.
- Set `WEB_ALLOW_REMOTE_FTP_HOSTS=true` to lift the FTP restriction entirely, for example for a device reached over a VPN. Only do so in trusted setups.
- The configured network password is sent only to the configured device host. A REST request that names another host still reaches it, but the browser has to supply that device's own password; the server never forwards its configured password to a host you did not configure.
- Set `WEB_ALLOW_REMOTE_REST_HOSTS=true` to lift the REST restriction entirely and allow any target.

### Request limits

- JSON request bodies are capped at 64 KiB and file-carrying bodies (the FTP write and REST proxy endpoints) at 48 MiB. An oversized body is answered with 413 and the connection is closed.
- An FTP read is capped at 32 MiB, the same limit the Android FTP plugin enforces, and a larger file is answered with 413 rather than being buffered.
- A proxied REST request to the device is aborted after 15 seconds and answered with 504. Set `WEB_REST_PROXY_TIMEOUT_MS` to a different number of milliseconds if a device on a slow link needs longer.

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
