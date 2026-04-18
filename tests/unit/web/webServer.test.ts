import { afterEach, describe, expect, it, vi } from "vitest";
import http from "node:http";
import { mkdtemp, mkdir, writeFile, rm, chmod } from "node:fs/promises";
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
});
