import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import dgram from "node:dgram";
import { mkdtemp, mkdir, writeFile, rm, chmod, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createMockFtpServer, type MockFtpServer } from "../../contract/mockFtpServer.js";

const originalEnv = { ...process.env };

type StartedServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const tempDirs: string[] = [];
const ftpServers: MockFtpServer[] = [];
const webServers: StartedServer[] = [];

const makeTempDir = async (prefix: string) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const startWebServer = async (env: Record<string, string>) => {
  vi.resetModules();
  process.env = { ...originalEnv, ...env };
  const module = await import("../../../web/server/src/index");
  const server = await module.startWebServer();
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Unexpected server address");
  }
  const started = {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  } satisfies StartedServer;
  webServers.push(started);
  return started;
};

const loginAndGetCookie = async (baseUrl: string, password: string) => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get("set-cookie");
  expect(cookie).toBeTruthy();
  return cookie!;
};

const expectCookieSecurity = (cookie: string, secure: boolean) => {
  expect(cookie.includes("; Secure")).toBe(secure);
};

afterEach(async () => {
  process.env = { ...originalEnv };
  for (const server of webServers.splice(0)) {
    await server.close().catch(() => {});
  }
  for (const ftpServer of ftpServers.splice(0)) {
    await ftpServer.close();
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("web server platform runtime", () => {
  it("serves UI and health endpoint without login when password is unset", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");
    await mkdir(path.join(distDir, "assets"));
    await writeFile(path.join(distDir, "assets", "index-abcdef1234.js"), 'console.log("ok")', "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const health = await fetch(`${server.baseUrl}/healthz`);
    expect(health.status).toBe(200);

    const root = await fetch(`${server.baseUrl}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain("ok");
    expect(root.headers.get("x-frame-options")).toBe("DENY");
    expect(root.headers.get("x-content-type-options")).toBe("nosniff");
    expect(root.headers.get("content-security-policy")).toContain("script-src 'self'");

    const hashedAsset = await fetch(`${server.baseUrl}/assets/index-abcdef1234.js`);
    expect(hashedAsset.status).toBe(200);
    expect(hashedAsset.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");

    await server.close();
  });

  it("applies the production header matrix through the running web server", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>headers</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      // HARD27-008: HSTS now follows the forwarded protocol only behind a proxy
      // the operator has declared.
      WEB_TRUST_PROXY: "1",
    });

    const expectedHeaders = {
      csp: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
      frameOptions: "DENY",
      contentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      hsts: "max-age=31536000; includeSubDomains",
    };

    const shell = await fetch(`${server.baseUrl}/`, {
      headers: { "x-forwarded-proto": "https" },
    });
    const authStatus = await fetch(`${server.baseUrl}/auth/status`, {
      headers: { "x-forwarded-proto": "https" },
    });
    const health = await fetch(`${server.baseUrl}/healthz`, {
      headers: { "x-forwarded-proto": "http" },
    });

    for (const response of [shell, authStatus]) {
      expect(response.headers.get("content-security-policy")).toBe(expectedHeaders.csp);
      expect(response.headers.get("x-frame-options")).toBe(expectedHeaders.frameOptions);
      expect(response.headers.get("x-content-type-options")).toBe(expectedHeaders.contentTypeOptions);
      expect(response.headers.get("referrer-policy")).toBe(expectedHeaders.referrerPolicy);
      expect(response.headers.get("strict-transport-security")).toBe(expectedHeaders.hsts);
    }

    expect(health.headers.get("content-security-policy")).toBe(expectedHeaders.csp);
    expect(health.headers.get("x-frame-options")).toBe(expectedHeaders.frameOptions);
    expect(health.headers.get("x-content-type-options")).toBe(expectedHeaders.contentTypeOptions);
    expect(health.headers.get("referrer-policy")).toBe(expectedHeaders.referrerPolicy);
    expect(health.headers.get("strict-transport-security")).toBeNull();

    await server.close();
  });

  it("enforces login when password is configured and rejects invalid password", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>private</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      NODE_ENV: "production",
      C64U_NETWORK_PASSWORD: "secret",
    });

    const unauth = await fetch(`${server.baseUrl}/`);
    expect(unauth.status).toBe(401);

    const wrong = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(wrong.status).toBe(401);

    const cookie = await loginAndGetCookie(server.baseUrl, "secret");
    expectCookieSecurity(cookie, false);
    const authed = await fetch(`${server.baseUrl}/`, {
      headers: { Cookie: cookie },
    });
    expect(authed.status).toBe(200);

    await server.close();
  });

  it("blocks login after repeated failed attempts from same client", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>private</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
    });

    for (let i = 0; i < 5; i += 1) {
      const wrong = await fetch(`${server.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(wrong.status).toBe(401);
    }

    const blocked = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    });
    expect(blocked.status).toBe(429);

    await server.close();
  });

  it("returns 405 for unsupported auth and secure storage methods", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const loginGet = await fetch(`${server.baseUrl}/auth/login`, {
      method: "GET",
    });
    expect(loginGet.status).toBe(405);

    const securePatch = await fetch(`${server.baseUrl}/api/secure-storage/password`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "secret" }),
    });
    expect(securePatch.status).toBe(405);

    await server.close();
  });

  it("issues a session cookie when setting a new password while unauthenticated", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "production",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const setPassword = await fetch(`${server.baseUrl}/api/secure-storage/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "new-secret" }),
    });
    expect(setPassword.status).toBe(200);
    const cookie = setPassword.headers.get("set-cookie");
    expect(cookie).not.toBeNull();
    const sessionCookie = cookie as string;
    expect(sessionCookie).toContain("c64_session=");
    expectCookieSecurity(sessionCookie, false);

    const authStatus = await fetch(`${server.baseUrl}/auth/status`, {
      headers: { Cookie: sessionCookie },
    });
    expect(authStatus.status).toBe(200);
    expect(await authStatus.json()).toEqual({ requiresLogin: true, authenticated: true });

    const requiresAuth = await fetch(`${server.baseUrl}/`);
    expect(requiresAuth.status).toBe(401);

    await server.close();
  });

  // HARD27-015: web-config.json holds the network password in plaintext and sits
  // on a bind-mounted volume, so it must not be readable by other users on the
  // host. It was written with the default 0644.
  it("keeps the config file readable only by the server's own user", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");
    const configFile = path.join(configDir, "web-config.json");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    // Startup creates the file when it is absent.
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);

    const setPassword = await fetch(`${server.baseUrl}/api/secure-storage/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "stored-secret" }),
    });
    expect(setPassword.status).toBe(200);
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);

    await server.close();

    // A file left world-readable by an older release is tightened on load.
    await chmod(configFile, 0o644);
    const restarted = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });
    expect((await stat(configFile)).mode & 0o777).toBe(0o600);
    await restarted.close();
  });

  // HARD27-001: the app used to send its per-device password envelope here, and
  // the server stored it as the single network password. That broke the device
  // X-Password header, FTP and the login page at once, so the envelope is now
  // rejected at the boundary.
  it("rejects the app's per-device password envelope with 400", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "production",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const envelope = JSON.stringify({
      version: 1,
      legacyDefaultPassword: null,
      passwordsByDeviceId: { "device-1": "plain-secret" },
    });
    const rejected = await fetch(`${server.baseUrl}/api/secure-storage/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: envelope }),
    });
    expect(rejected.status).toBe(400);
    expect(rejected.headers.get("set-cookie")).toBeNull();

    // The rejected write must not have been stored.
    const status = await fetch(`${server.baseUrl}/auth/status`);
    expect(await status.json()).toEqual({ requiresLogin: false, authenticated: false });

    // A plaintext password on a brace-prefixed value is still accepted.
    const accepted = await fetch(`${server.baseUrl}/api/secure-storage/password`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: "{not-json-secret" }),
    });
    expect(accepted.status).toBe(200);

    await server.close();
  });

  it("emits secure session cookies only for explicitly secure deployments", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>secure</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "production",
      WEB_COOKIE_SECURE: "1",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
    });

    const cookie = await loginAndGetCookie(server.baseUrl, "secret");
    expectCookieSecurity(cookie, true);

    await server.close();
  });

  it("reports auth status with production headers and secure cookies across login and logout", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>secure-auth</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "production",
      WEB_COOKIE_SECURE: "1",
      WEB_TRUST_PROXY: "1",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
    });

    const secureHeaders = { "x-forwarded-proto": "https" };

    const unauthStatus = await fetch(`${server.baseUrl}/auth/status`, {
      headers: secureHeaders,
    });
    expect(unauthStatus.status).toBe(200);
    expect(await unauthStatus.json()).toEqual({ requiresLogin: true, authenticated: false });
    expect(unauthStatus.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains");

    const login = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { ...secureHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({ password: "secret" }),
    });
    expect(login.status).toBe(200);
    const sessionCookie = login.headers.get("set-cookie");
    expect(sessionCookie).toBeTruthy();
    expectCookieSecurity(sessionCookie as string, true);

    const authStatus = await fetch(`${server.baseUrl}/auth/status`, {
      headers: { ...secureHeaders, Cookie: sessionCookie as string },
    });
    expect(authStatus.status).toBe(200);
    expect(await authStatus.json()).toEqual({ requiresLogin: true, authenticated: true });
    expect(authStatus.headers.get("content-security-policy")).toContain("script-src 'self'");

    const logout = await fetch(`${server.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { ...secureHeaders, Cookie: sessionCookie as string },
    });
    expect(logout.status).toBe(200);
    expect(logout.headers.get("set-cookie")).toContain("; Secure");

    const clearedStatus = await fetch(`${server.baseUrl}/auth/status`, {
      headers: secureHeaders,
    });
    expect(clearedStatus.status).toBe(200);
    expect(await clearedStatus.json()).toEqual({ requiresLogin: true, authenticated: false });

    await server.close();
  });

  it("rejects malformed static asset encodings", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const malformed = await fetch(`${server.baseUrl}/%E0%A4%A`);
    expect(malformed.status).toBe(400);

    await server.close();
  });

  it("falls back to runtime defaults when config directory is not writable", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-readonly-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");
    await chmod(configDir, 0o555);

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    try {
      const health = await fetch(`${server.baseUrl}/healthz`);
      expect(health.status).toBe(200);

      const authStatus = await fetch(`${server.baseUrl}/auth/status`);
      expect(authStatus.status).toBe(200);
      const payload = (await authStatus.json()) as {
        requiresLogin: boolean;
        authenticated: boolean;
      };
      expect(payload.requiresLogin).toBe(false);
      expect(payload.authenticated).toBe(false);
    } finally {
      await server.close();
      await chmod(configDir, 0o755);
    }
  });

  it("authenticates the production HTTP LAN path and proxies control requests", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>proxy</body></html>", "utf8");

    const seen: Array<{ method?: string; path?: string; password?: string; body: string }> = [];
    const upstream = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      req.on("end", () => {
        seen.push({
          method: req.method,
          path: req.url,
          password: req.headers["x-password"]?.toString(),
          body: Buffer.concat(chunks).toString("utf8"),
        });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errors: [] }));
      });
    });
    await new Promise<void>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve());
      upstream.once("error", reject);
    });
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === "string") {
      throw new Error("Invalid upstream address");
    }

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      NODE_ENV: "production",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
      C64U_DEVICE_HOST: `127.0.0.1:${upstreamAddress.port}`,
    });

    const cookie = await loginAndGetCookie(server.baseUrl, "secret");
    expectCookieSecurity(cookie, false);

    const response = await fetch(`${server.baseUrl}/api/rest/v1/machine:menu_button`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({ pressed: true }),
    });

    expect(response.status).toBe(200);
    expect(seen[0]).toEqual({
      method: "PUT",
      path: "/v1/machine:menu_button",
      password: "secret",
      body: JSON.stringify({ pressed: true }),
    });

    await server.close();
    await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
  });

  // HARD27-016: the configured password authenticates the configured device.
  // Before the fix the proxy attached it to any private-range host a client
  // named, so a browser session could make the server deliver it to a host the
  // operator never configured.
  it("sends the configured password only to the configured device", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>proxy</body></html>", "utf8");

    const startUpstream = async (seen: Array<string | undefined>) => {
      const upstream = http.createServer((req, res) => {
        seen.push(req.headers["x-password"]?.toString());
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ errors: [] }));
      });
      await new Promise<void>((resolve, reject) => {
        upstream.listen(0, "127.0.0.1", () => resolve());
        upstream.once("error", reject);
      });
      const address = upstream.address();
      if (!address || typeof address === "string") {
        throw new Error("Invalid upstream address");
      }
      return { upstream, port: address.port };
    };

    const configuredSeen: Array<string | undefined> = [];
    const foreignSeen: Array<string | undefined> = [];
    const configured = await startUpstream(configuredSeen);
    const foreign = await startUpstream(foreignSeen);

    try {
      const server = await startWebServer({
        HOST: "127.0.0.1",
        PORT: "0",
        WEB_DIST_DIR: distDir,
        WEB_CONFIG_DIR: configDir,
        C64U_NETWORK_PASSWORD: "server-device-secret",
        C64U_DEVICE_HOST: `127.0.0.1:${configured.port}`,
      });
      const cookie = await loginAndGetCookie(server.baseUrl, "server-device-secret");

      const toConfigured = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
        headers: { Cookie: cookie, "X-C64U-Host": `127.0.0.1:${configured.port}` },
      });
      expect(toConfigured.status).toBe(200);
      expect(configuredSeen).toEqual(["server-device-secret"]);

      const toForeign = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
        headers: { Cookie: cookie, "X-C64U-Host": `127.0.0.1:${foreign.port}` },
      });
      expect(toForeign.status).toBe(200);
      expect(foreignSeen).toEqual([undefined]);

      // The other host stays reachable; the client supplies that device's own
      // password, and the server neither replaces it nor appends to it.
      const withClientPassword = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
        headers: {
          Cookie: cookie,
          "X-C64U-Host": `127.0.0.1:${foreign.port}`,
          "X-Password": "other-device-secret",
        },
      });
      expect(withClientPassword.status).toBe(200);
      expect(foreignSeen[1]).toBe("other-device-secret");
    } finally {
      await new Promise<void>((resolve) => configured.upstream.close(() => resolve()));
      await new Promise<void>((resolve) => foreign.upstream.close(() => resolve()));
    }
  });

  // HARD27-016 on the FTP paths. The REST proxy now attaches the configured
  // password only to the configured device, but the four FTP handlers still
  // read `config.networkPassword ?? payload.password`, so they send it to every
  // host they accept. That set used to be the configured device alone; the
  // HARD27-030 LAN policy widened it to any private-range host, which makes the
  // configured device's password reachable by a browser session that names
  // another host, and makes that host's own password unusable.
  it("sends the configured password over FTP only to the configured device", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    const ftpRoot = await makeTempDir("c64-web-ftp-pw-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ftp</body></html>", "utf8");
    await writeFile(path.join(ftpRoot, "test.sid"), "PSID_DATA", "utf8");

    const foreignFtp = await createMockFtpServer({
      rootDir: ftpRoot,
      password: "other-device-secret",
      pasvMin: 40410,
      pasvMax: 40460,
    });
    ftpServers.push(foreignFtp);

    const foreignServer = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "server-device-secret",
      C64U_DEVICE_HOST: "c64u",
    });
    const foreignCookie = await loginAndGetCookie(foreignServer.baseUrl, "server-device-secret");

    // The client names a LAN host that is not the configured device and supplies
    // that host's own password.
    const toForeign = await fetch(`${foreignServer.baseUrl}/api/ftp/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: foreignCookie },
      body: JSON.stringify({
        host: foreignFtp.host,
        port: foreignFtp.port,
        username: "tester",
        password: "other-device-secret",
        path: "/",
      }),
    });
    expect(toForeign.status).toBe(200);
    expect(foreignFtp.passwords).toEqual(["other-device-secret"]);
    expect(foreignFtp.passwords).not.toContain("server-device-secret");

    // The configured device is still authenticated by the server's own password,
    // with no password in the request body.
    const configuredFtp = await createMockFtpServer({
      rootDir: ftpRoot,
      password: "server-device-secret",
      pasvMin: 40461,
      pasvMax: 40510,
    });
    ftpServers.push(configuredFtp);

    // Its own config directory: the first server persists its defaults, and a
    // shared directory would give this one the previous defaultDeviceHost.
    const configuredConfigDir = await makeTempDir("c64-web-config-");
    const configuredServer = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configuredConfigDir,
      C64U_NETWORK_PASSWORD: "server-device-secret",
      C64U_DEVICE_HOST: configuredFtp.host,
    });
    const configuredCookie = await loginAndGetCookie(configuredServer.baseUrl, "server-device-secret");

    const toConfigured = await fetch(`${configuredServer.baseUrl}/api/ftp/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: configuredCookie },
      body: JSON.stringify({
        host: configuredFtp.host,
        port: configuredFtp.port,
        username: "tester",
        path: "/",
      }),
    });
    expect(toConfigured.status).toBe(200);
    expect(configuredFtp.passwords).toEqual(["server-device-secret"]);
  });

  // HARD27-008: the login limiter keyed on getClientIp, which returned the first
  // X-Forwarded-For value whenever the header was present. The shipped Docker
  // image binds 0.0.0.0:8064 with no proxy in front, so any LAN client could
  // send a fresh forwarded address per attempt, be counted against a different
  // key each time, and never be blocked.
  it("blocks brute-forced logins that vary X-Forwarded-For when no proxy is trusted", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
    });

    const attempt = (forwardedFor: string) =>
      fetch(`${server.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": forwardedFor },
        body: JSON.stringify({ password: "wrong" }),
      });

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await attempt(`198.51.100.${index}`)).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);

    // The block holds even for a correct password, and even from a seventh
    // forwarded address, because the key is the socket the request arrived on.
    const correct = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "203.0.113.9" },
      body: JSON.stringify({ password: "secret" }),
    });
    expect(correct.status).toBe(429);
  });

  // HARD27-008: the same switch has to govern every proxy-dependent behaviour.
  // Behind a declared proxy the forwarded address keys the limiter again, and
  // the session cookie is marked Secure from the forwarded protocol rather than
  // needing a second env variable.
  it("keys the limiter on the forwarded address and derives Secure from it when a proxy is trusted", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
      WEB_TRUST_PROXY: "1",
    });

    // Five failures from one forwarded address block that address.
    for (let index = 0; index < 5; index += 1) {
      const response = await fetch(`${server.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.5" },
        body: JSON.stringify({ password: "wrong" }),
      });
      expect(response.status).toBe(401);
    }
    const blocked = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Forwarded-For": "198.51.100.5" },
      body: JSON.stringify({ password: "wrong" }),
    });
    expect(blocked.status).toBe(429);

    // A different forwarded address is a different key and is not blocked yet.
    const other = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "198.51.100.6",
        "X-Forwarded-Proto": "https",
      },
      body: JSON.stringify({ password: "secret" }),
    });
    expect(other.status).toBe(200);
    // No WEB_COOKIE_SECURE is set; Secure comes from the forwarded protocol.
    expect(other.headers.get("set-cookie")).toContain("; Secure");
  });

  // HARD27-008: a per-key limiter alone cannot stop a client that varies its
  // key, so a budget across all keys backs it up once the forwarded address is
  // trusted.
  it("stops a key-rotating brute force with the global attempt budget", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
      WEB_TRUST_PROXY: "1",
    });

    const statuses: number[] = [];
    for (let index = 0; index < 31; index += 1) {
      const response = await fetch(`${server.baseUrl}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Forwarded-For": `198.51.100.${index}` },
        body: JSON.stringify({ password: "wrong" }),
      });
      statuses.push(response.status);
    }
    // Thirty distinct keys each get their first failure counted, and the
    // thirty-first attempt is refused by the budget rather than the per-key rule.
    expect(statuses.slice(0, 30).every((status) => status === 401)).toBe(true);
    expect(statuses[30]).toBe(429);
  });

  // HARD27-009: /auth/login read its body before any authentication and with no
  // cap, so any LAN client could stream an unbounded body into the process.
  it("rejects an oversized body on the unauthenticated login endpoint", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
    });

    const oversized = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: Buffer.alloc(200 * 1024, 0x61),
    });
    expect(oversized.status).toBe(413);
    expect(oversized.headers.get("set-cookie")).toBeNull();

    // The server is still serving, and a normal login still works.
    const cookie = await loginAndGetCookie(server.baseUrl, "secret");
    expect(cookie).toContain("c64_session=");
  });

  // HARD27-017: the upstream fetch had no signal, so a wedged device held the
  // socket and the buffered request body until the OS tore the connection down,
  // once per browser retry.
  it("answers 504 when the device does not respond within the proxy timeout", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ok</body></html>", "utf8");

    const openSockets: import("node:net").Socket[] = [];
    const upstream = http.createServer((req) => {
      openSockets.push(req.socket);
      // Never answer, exactly as a wedged device does.
    });
    await new Promise<void>((resolve, reject) => {
      upstream.listen(0, "127.0.0.1", () => resolve());
      upstream.once("error", reject);
    });
    const address = upstream.address();
    if (!address || typeof address === "string") {
      throw new Error("Invalid upstream address");
    }

    try {
      const server = await startWebServer({
        HOST: "127.0.0.1",
        PORT: "0",
        WEB_DIST_DIR: distDir,
        WEB_CONFIG_DIR: configDir,
        C64U_DEVICE_HOST: `127.0.0.1:${address.port}`,
        WEB_REST_PROXY_TIMEOUT_MS: "400",
      });

      const startedAt = Date.now();
      const response = await fetch(`${server.baseUrl}/api/rest/v1/version`);
      const elapsedMs = Date.now() - startedAt;
      expect(response.status).toBe(504);
      expect(await response.json()).toEqual({ error: "REST proxy upstream timed out" });
      expect(elapsedMs).toBeLessThan(5000);
    } finally {
      for (const socket of openSockets) socket.destroy();
      await new Promise<void>((resolve) => upstream.close(() => resolve()));
    }
  });

  // HARD27-009: the FTP read handler collected the whole remote file in memory
  // and then base64-encoded it into one JSON response, holding roughly three
  // times the file size in the heap. The Android FTP plugin caps the same
  // operation at 32 MiB; the server now does too.
  it("refuses an FTP read over the size limit instead of buffering the file", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    const ftpRoot = await makeTempDir("c64-web-ftp-big-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ftp</body></html>", "utf8");
    // One MiB over the 32 MiB limit.
    await writeFile(path.join(ftpRoot, "huge.d64"), Buffer.alloc(33 * 1024 * 1024, 0x41));
    await writeFile(path.join(ftpRoot, "small.prg"), "SMALL", "utf8");

    const ftpServer = await createMockFtpServer({
      rootDir: ftpRoot,
      host: "127.0.0.1",
      port: 0,
      pasvMin: 42300,
      pasvMax: 42400,
    });
    ftpServers.push(ftpServer);

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
      WEB_ALLOW_REMOTE_FTP_HOSTS: "1",
    });
    const cookie = await loginAndGetCookie(server.baseUrl, "secret");

    const readBig = await fetch(`${server.baseUrl}/api/ftp/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: "anonymous",
        path: "huge.d64",
      }),
    });
    expect(readBig.status).toBe(413);
    expect((await readBig.json()) as { error: string }).toEqual({
      error: `File exceeds the ${32 * 1024 * 1024}-byte read limit`,
    });

    // The endpoint still serves a file inside the limit afterwards.
    const readSmall = await fetch(`${server.baseUrl}/api/ftp/read`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: "anonymous",
        path: "small.prg",
      }),
    });
    expect(readSmall.status).toBe(200);
    const smallPayload = (await readSmall.json()) as { data: string };
    expect(Buffer.from(smallPayload.data, "base64").toString("utf8")).toBe("SMALL");
  }, 60_000);

  it("proxies FTP list/read responses", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    const ftpRoot = await makeTempDir("c64-web-ftp-root-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ftp</body></html>", "utf8");
    await mkdir(path.join(ftpRoot, "MUSIC"));
    await writeFile(path.join(ftpRoot, "MUSIC", "test.sid"), "PSID_DATA", "utf8");

    const ftpServer = await createMockFtpServer({
      rootDir: ftpRoot,
      host: "127.0.0.1",
      port: 0,
      pasvMin: 42000,
      pasvMax: 42100,
    });
    ftpServers.push(ftpServer);

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
      WEB_ALLOW_REMOTE_FTP_HOSTS: "1",
    });

    const cookie = await loginAndGetCookie(server.baseUrl, "secret");

    const listRes = await fetch(`${server.baseUrl}/api/ftp/list`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: "anonymous",
        path: "/MUSIC",
      }),
    });
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as {
      entries: Array<{ name: string }>;
    };
    expect(listPayload.entries.some((entry) => entry.name === "test.sid")).toBe(true);

    const readRes = await fetch(`${server.baseUrl}/api/ftp/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: "anonymous",
        path: "MUSIC/test.sid",
      }),
    });
    expect(readRes.status).toBe(200);
    const readPayload = (await readRes.json()) as { data: string };
    expect(Buffer.from(readPayload.data, "base64").toString("utf8")).toBe("PSID_DATA");

    const pingRes = await fetch(`${server.baseUrl}/api/ftp/ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: "anonymous",
      }),
    });
    expect(pingRes.status).toBe(200);
    await expect(pingRes.json()).resolves.toEqual({ ok: true });

    await server.close();
  });

  it("returns 405 for unsupported FTP endpoint methods", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ftp</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const listGet = await fetch(`${server.baseUrl}/api/ftp/list`, {
      method: "GET",
    });
    expect(listGet.status).toBe(405);

    const readGet = await fetch(`${server.baseUrl}/api/ftp/read`, {
      method: "GET",
    });
    expect(readGet.status).toBe(405);

    const pingGet = await fetch(`${server.baseUrl}/api/ftp/ping`, {
      method: "GET",
    });
    expect(pingGet.status).toBe(405);

    await server.close();
  });

  it("supports logout and secure storage get/delete lifecycle", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>secure</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
    });

    const cookie = await loginAndGetCookie(server.baseUrl, "secret");

    const readPassword = await fetch(`${server.baseUrl}/api/secure-storage/password`, {
      headers: { Cookie: cookie },
    });
    expect(readPassword.status).toBe(200);
    expect(await readPassword.json()).toEqual({ value: "secret" });

    const deletePassword = await fetch(`${server.baseUrl}/api/secure-storage/password`, {
      method: "DELETE",
      headers: { Cookie: cookie },
    });
    expect(deletePassword.status).toBe(200);

    const statusAfterDelete = await fetch(`${server.baseUrl}/auth/status`);
    const authStatusPayload = (await statusAfterDelete.json()) as {
      requiresLogin: boolean;
    };
    expect(authStatusPayload.requiresLogin).toBe(false);

    const logout = await fetch(`${server.baseUrl}/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(200);

    const unauthRoot = await fetch(`${server.baseUrl}/`);
    expect(unauthRoot.status).toBe(200);

    await server.close();
  });

  it("handles diagnostics and static path edge cases", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await mkdir(path.join(distDir, "docs"));
    await writeFile(path.join(distDir, "index.html"), "<html><body>root</body></html>", "utf8");
    await writeFile(path.join(distDir, "docs", "index.html"), "<html><body>docs</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const diagnosticsMethod = await fetch(`${server.baseUrl}/api/diagnostics/server-logs`, { method: "POST" });
    expect(diagnosticsMethod.status).toBe(405);

    const diagnostics = await fetch(`${server.baseUrl}/api/diagnostics/server-logs`);
    expect(diagnostics.status).toBe(200);
    const diagnosticsPayload = (await diagnostics.json()) as {
      logs: Array<{ message: string }>;
    };
    expect(Array.isArray(diagnosticsPayload.logs)).toBe(true);

    const directoryIndex = await fetch(`${server.baseUrl}/docs`);
    expect(directoryIndex.status).toBe(200);
    expect(await directoryIndex.text()).toContain("<body>docs</body>");

    const traversal = await fetch(`${server.baseUrl}/..%2F..%2Fetc/passwd`);
    expect(traversal.status).toBe(403);

    await server.close();
  });

  it("returns proxy and ftp host-override errors for denied targets", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>proxy</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
      C64U_DEVICE_HOST: "127.0.0.1:1",
    });

    const cookie = await loginAndGetCookie(server.baseUrl, "secret");
    const proxyFailure = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
      headers: { Cookie: cookie },
    });
    expect(proxyFailure.status).toBe(502);

    const restDenied = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
      headers: {
        Cookie: cookie,
        "X-C64U-Host": "example.com",
      },
    });
    expect(restDenied.status).toBe(403);

    const ftpDenied = await fetch(`${server.baseUrl}/api/ftp/read`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: JSON.stringify({
        host: "192.0.2.1",
        port: 21,
        username: "anonymous",
        path: "/MUSIC/test.sid",
      }),
    });
    expect(ftpDenied.status).toBe(403);

    await server.close();
  });

  it("bridges UDP datagrams to a WebSocket client when the stream bridge is enabled", async () => {
    const videoPort = 52123;
    const server = await startWebServer({
      PORT: "0",
      WEB_STREAM_BRIDGE: "1",
      WEB_STREAM_VIDEO_PORT: String(videoPort),
      WEB_STREAM_AUDIO_PORT: "52124",
    });

    const ws = new WebSocket(`${server.baseUrl.replace(/^http/, "ws")}/streams/video`);
    ws.binaryType = "arraybuffer";
    const received: Uint8Array[] = [];
    ws.onmessage = (event) => received.push(new Uint8Array(event.data as ArrayBuffer));
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error("ws error"));
    });

    // onopen fires after the server added this client, so a datagram now round-trips.
    const payload = Buffer.from([0xc6, 0x40, 0x01, 0x02, 0x03]);
    const sender = dgram.createSocket("udp4");
    await new Promise<void>((resolve, reject) =>
      sender.send(payload, videoPort, "127.0.0.1", (err) => (err ? reject(err) : resolve())),
    );

    const start = Date.now();
    while (received.length === 0) {
      if (Date.now() - start > 3000) throw new Error("no bridged datagram received");
      await new Promise((r) => setTimeout(r, 5));
    }
    expect(Buffer.from(received[0])).toEqual(payload);

    sender.close();
    ws.close();
    await server.close();
  });

  it("does not open the stream bridge unless it is enabled", async () => {
    const server = await startWebServer({ PORT: "0" });
    const ws = new WebSocket(`${server.baseUrl.replace(/^http/, "ws")}/streams/video`);
    // With no bridge, the server has no upgrade handler, so the socket is destroyed.
    const closedWithoutOpen = await new Promise<boolean>((resolve) => {
      let opened = false;
      ws.onopen = () => {
        opened = true;
      };
      ws.onerror = () => resolve(!opened);
      ws.onclose = () => resolve(!opened);
    });
    expect(closedWithoutOpen).toBe(true);
    await server.close();
  });

  it("gates the stream bridge behind login when a password is configured", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html></html>", "utf8");
    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      NODE_ENV: "production",
      C64U_NETWORK_PASSWORD: "secret",
      WEB_STREAM_BRIDGE: "1",
      WEB_STREAM_VIDEO_PORT: "52131",
      WEB_STREAM_AUDIO_PORT: "52132",
    });

    // An unauthenticated WebSocket handshake must be cleanly rejected (not hang): the server
    // returns 401 to the upgrade, so a real client fires error/close without ever opening.
    const wsUrl = `${server.baseUrl.replace(/^http/, "ws")}/streams/video`;
    const outcome = await new Promise<"open" | "rejected">((resolve) => {
      const ws = new WebSocket(wsUrl);
      const guard = setTimeout(() => resolve("open"), 6000); // treat a hang as a failure to reject
      const done = (result: "open" | "rejected") => {
        clearTimeout(guard);
        resolve(result);
      };
      ws.onopen = () => done("open");
      ws.onerror = () => done("rejected");
      ws.onclose = () => done("rejected");
    });
    expect(outcome).toBe("rejected");

    await server.close();
  });
});

describe("web server session gate and LAN host policy", () => {
  // HARD27-029: the documented entry point is the root, but every path except
  // /login answered 401 JSON when a password was configured.
  it("serves the login page for an unauthenticated navigation to any path", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>app</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
    });

    for (const requestPath of ["/", "/play", "/settings"]) {
      const response = await fetch(`${server.baseUrl}${requestPath}`, {
        headers: { Accept: "text/html,application/xhtml+xml" },
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain('<form id="login-form">');
    }
  });

  // HARD27-029: the client maps a 401 to "the device wants its network
  // password". The server's own gate must be distinguishable from that.
  it("marks its own session gate so the client does not raise the device password dialog", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>app</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: "secret",
    });

    const response = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
      headers: { Accept: "application/json" },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("c64commander-session");
    expect(response.headers.get("x-c64commander-gate")).toBe("session-expired");
  });

  // HARD27-030: a second Ultimate on the LAN got REST but no file browsing,
  // because the FTP handlers compared the requested host with the configured
  // default instead of applying a LAN policy.
  it("proxies FTP for a second private-range device under the default policy", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    const ftpRoot = await makeTempDir("c64-web-ftp-root-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>ftp</body></html>", "utf8");
    await mkdir(path.join(ftpRoot, "MUSIC"));
    await writeFile(path.join(ftpRoot, "MUSIC", "second.sid"), "PSID_DATA", "utf8");

    const ftpServer = await createMockFtpServer({
      rootDir: ftpRoot,
      host: "127.0.0.1",
      port: 0,
      pasvMin: 42200,
      pasvMax: 42300,
    });
    ftpServers.push(ftpServer);

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_DEVICE_HOST: "c64u",
    });

    const listRes = await fetch(`${server.baseUrl}/api/ftp/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: "anonymous",
        path: "/MUSIC",
      }),
    });
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as { entries: Array<{ name: string }> };
    expect(listPayload.entries.some((entry) => entry.name === "second.sid")).toBe(true);
  });

  // HARD27-030: a policy rejection must not be answered with a status the
  // client reads as the device demanding a password.
  it("refuses a public host with a policy signal of its own", async () => {
    const distDir = await makeTempDir("c64-web-dist-");
    const configDir = await makeTempDir("c64-web-config-");
    await writeFile(path.join(distDir, "index.html"), "<html><body>app</body></html>", "utf8");

    const server = await startWebServer({
      HOST: "127.0.0.1",
      PORT: "0",
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_DEVICE_HOST: "c64u",
    });

    const restRes = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
      headers: { "X-C64U-Host": "example.com" },
    });
    expect(restRes.status).toBe(403);
    expect(restRes.headers.get("x-c64commander-gate")).toBe("host-policy");

    const ftpRes = await fetch(`${server.baseUrl}/api/ftp/list`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ host: "example.com", path: "/" }),
    });
    expect(ftpRes.status).toBe(403);
    expect(ftpRes.headers.get("x-c64commander-gate")).toBe("host-policy");
  });
});
