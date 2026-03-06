import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, chmod } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  createMockFtpServer,
  type MockFtpServer,
} from '../../contract/mockFtpServer.js';

const originalEnv = { ...process.env };

type StartedServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

const tempDirs: string[] = [];
const ftpServers: MockFtpServer[] = [];

const makeTempDir = async (prefix: string) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
};

const startWebServer = async (env: Record<string, string>) => {
  vi.resetModules();
  process.env = { ...originalEnv, ...env };
  const module = await import('../../../web/server/src/index');
  const server = await module.startWebServer();
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Unexpected server address');
  }
  return {
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
};

const loginAndGetCookie = async (baseUrl: string, password: string) => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.get('set-cookie');
  expect(cookie).toBeTruthy();
  return cookie!;
};

afterEach(async () => {
  process.env = { ...originalEnv };
  for (const ftpServer of ftpServers.splice(0)) {
    await ftpServer.close();
  }
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe('web server platform runtime', () => {
  it('serves UI and health endpoint without login when password is unset', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>ok</body></html>',
      'utf8',
    );
    await mkdir(path.join(distDir, 'assets'));
    await writeFile(
      path.join(distDir, 'assets', 'index-abcdef1234.js'),
      'console.log("ok")',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const health = await fetch(`${server.baseUrl}/healthz`);
    expect(health.status).toBe(200);

    const root = await fetch(`${server.baseUrl}/`);
    expect(root.status).toBe(200);
    expect(await root.text()).toContain('ok');
    expect(root.headers.get('x-frame-options')).toBe('DENY');
    expect(root.headers.get('x-content-type-options')).toBe('nosniff');
    expect(root.headers.get('content-security-policy')).toContain(
      "script-src 'self'",
    );

    const hashedAsset = await fetch(
      `${server.baseUrl}/assets/index-abcdef1234.js`,
    );
    expect(hashedAsset.status).toBe(200);
    expect(hashedAsset.headers.get('cache-control')).toBe(
      'public, max-age=31536000, immutable',
    );

    await server.close();
  });

  it('enforces login when password is configured and rejects invalid password', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>private</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: 'secret',
    });

    const unauth = await fetch(`${server.baseUrl}/`);
    expect(unauth.status).toBe(401);

    const wrong = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(wrong.status).toBe(401);

    const cookie = await loginAndGetCookie(server.baseUrl, 'secret');
    const authed = await fetch(`${server.baseUrl}/`, {
      headers: { Cookie: cookie },
    });
    expect(authed.status).toBe(200);

    await server.close();
  });

  it('blocks login after repeated failed attempts from same client', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>private</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: 'secret',
    });

    for (let i = 0; i < 5; i += 1) {
      const wrong = await fetch(`${server.baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'wrong' }),
      });
      expect(wrong.status).toBe(401);
    }

    const blocked = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'secret' }),
    });
    expect(blocked.status).toBe(429);

    await server.close();
  });

  it('returns 405 for unsupported auth and secure storage methods', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>ok</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const loginGet = await fetch(`${server.baseUrl}/auth/login`, {
      method: 'GET',
    });
    expect(loginGet.status).toBe(405);

    const securePatch = await fetch(
      `${server.baseUrl}/api/secure-storage/password`,
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'secret' }),
      },
    );
    expect(securePatch.status).toBe(405);

    await server.close();
  });

  it('issues a session cookie when setting a new password while unauthenticated', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>ok</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const setPassword = await fetch(
      `${server.baseUrl}/api/secure-storage/password`,
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'new-secret' }),
      },
    );
    expect(setPassword.status).toBe(200);
    expect(setPassword.headers.get('set-cookie')).toContain('c64_session=');

    const requiresAuth = await fetch(`${server.baseUrl}/`);
    expect(requiresAuth.status).toBe(401);

    await server.close();
  });

  it('rejects malformed static asset encodings', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>ok</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const malformed = await fetch(`${server.baseUrl}/%E0%A4%A`);
    expect(malformed.status).toBe(400);

    await server.close();
  });

  it('falls back to runtime defaults when config directory is not writable', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-readonly-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>ok</body></html>',
      'utf8',
    );
    await chmod(configDir, 0o555);

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
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

  it('injects network password header in REST proxy requests', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>proxy</body></html>',
      'utf8',
    );

    const seen: Array<string | undefined> = [];
    const upstream = http.createServer((req, res) => {
      seen.push(req.headers['x-password']?.toString());
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ version: '3.12.0', errors: [] }));
    });
    await new Promise<void>((resolve, reject) => {
      upstream.listen(0, '127.0.0.1', () => resolve());
      upstream.once('error', reject);
    });
    const upstreamAddress = upstream.address();
    if (!upstreamAddress || typeof upstreamAddress === 'string') {
      throw new Error('Invalid upstream address');
    }

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: 'secret',
      C64U_DEVICE_HOST: `127.0.0.1:${upstreamAddress.port}`,
    });

    const cookie = await loginAndGetCookie(server.baseUrl, 'secret');
    const response = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
      headers: { Cookie: cookie },
    });

    expect(response.status).toBe(200);
    expect(seen[0]).toBe('secret');

    await server.close();
    await new Promise<void>((resolve, reject) =>
      upstream.close((error) => (error ? reject(error) : resolve())),
    );
  });

  it('proxies FTP list/read responses', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    const ftpRoot = await makeTempDir('c64-web-ftp-root-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>ftp</body></html>',
      'utf8',
    );
    await mkdir(path.join(ftpRoot, 'MUSIC'));
    await writeFile(
      path.join(ftpRoot, 'MUSIC', 'test.sid'),
      'PSID_DATA',
      'utf8',
    );

    const ftpServer = await createMockFtpServer({
      rootDir: ftpRoot,
      host: '127.0.0.1',
      port: 0,
      pasvMin: 42000,
      pasvMax: 42100,
    });
    ftpServers.push(ftpServer);

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: 'secret',
      WEB_ALLOW_REMOTE_FTP_HOSTS: '1',
    });

    const cookie = await loginAndGetCookie(server.baseUrl, 'secret');

    const listRes = await fetch(`${server.baseUrl}/api/ftp/list`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: 'anonymous',
        path: '/MUSIC',
      }),
    });
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as {
      entries: Array<{ name: string }>;
    };
    expect(listPayload.entries.some((entry) => entry.name === 'test.sid')).toBe(
      true,
    );

    const readRes = await fetch(`${server.baseUrl}/api/ftp/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: 'anonymous',
        path: 'MUSIC/test.sid',
      }),
    });
    expect(readRes.status).toBe(200);
    const readPayload = (await readRes.json()) as { data: string };
    expect(Buffer.from(readPayload.data, 'base64').toString('utf8')).toBe(
      'PSID_DATA',
    );

    await server.close();
  });

  it('returns 405 for unsupported FTP endpoint methods', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>ftp</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const listGet = await fetch(`${server.baseUrl}/api/ftp/list`, {
      method: 'GET',
    });
    expect(listGet.status).toBe(405);

    const readGet = await fetch(`${server.baseUrl}/api/ftp/read`, {
      method: 'GET',
    });
    expect(readGet.status).toBe(405);

    await server.close();
  });

  it('supports logout and secure storage get/delete lifecycle', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>secure</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: 'secret',
    });

    const cookie = await loginAndGetCookie(server.baseUrl, 'secret');

    const readPassword = await fetch(
      `${server.baseUrl}/api/secure-storage/password`,
      {
        headers: { Cookie: cookie },
      },
    );
    expect(readPassword.status).toBe(200);
    expect(await readPassword.json()).toEqual({ value: 'secret' });

    const deletePassword = await fetch(
      `${server.baseUrl}/api/secure-storage/password`,
      {
        method: 'DELETE',
        headers: { Cookie: cookie },
      },
    );
    expect(deletePassword.status).toBe(200);

    const statusAfterDelete = await fetch(`${server.baseUrl}/auth/status`);
    const authStatusPayload = (await statusAfterDelete.json()) as {
      requiresLogin: boolean;
    };
    expect(authStatusPayload.requiresLogin).toBe(false);

    const logout = await fetch(`${server.baseUrl}/auth/logout`, {
      method: 'POST',
      headers: { Cookie: cookie },
    });
    expect(logout.status).toBe(200);

    const unauthRoot = await fetch(`${server.baseUrl}/`);
    expect(unauthRoot.status).toBe(200);

    await server.close();
  });

  it('handles diagnostics and static path edge cases', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await mkdir(path.join(distDir, 'docs'));
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>root</body></html>',
      'utf8',
    );
    await writeFile(
      path.join(distDir, 'docs', 'index.html'),
      '<html><body>docs</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
    });

    const diagnosticsMethod = await fetch(
      `${server.baseUrl}/api/diagnostics/server-logs`,
      { method: 'POST' },
    );
    expect(diagnosticsMethod.status).toBe(405);

    const diagnostics = await fetch(
      `${server.baseUrl}/api/diagnostics/server-logs`,
    );
    expect(diagnostics.status).toBe(200);
    const diagnosticsPayload = (await diagnostics.json()) as {
      logs: Array<{ message: string }>;
    };
    expect(Array.isArray(diagnosticsPayload.logs)).toBe(true);

    const directoryIndex = await fetch(`${server.baseUrl}/docs`);
    expect(directoryIndex.status).toBe(200);
    expect(await directoryIndex.text()).toContain('<body>docs</body>');

    const traversal = await fetch(`${server.baseUrl}/..%2F..%2Fetc/passwd`);
    expect(traversal.status).toBe(403);

    await server.close();
  });

  it('returns proxy and ftp host-override errors for denied targets', async () => {
    const distDir = await makeTempDir('c64-web-dist-');
    const configDir = await makeTempDir('c64-web-config-');
    await writeFile(
      path.join(distDir, 'index.html'),
      '<html><body>proxy</body></html>',
      'utf8',
    );

    const server = await startWebServer({
      HOST: '127.0.0.1',
      PORT: '0',
      WEB_DIST_DIR: distDir,
      WEB_CONFIG_DIR: configDir,
      C64U_NETWORK_PASSWORD: 'secret',
      C64U_DEVICE_HOST: '127.0.0.1:1',
    });

    const cookie = await loginAndGetCookie(server.baseUrl, 'secret');
    const proxyFailure = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
      headers: { Cookie: cookie },
    });
    expect(proxyFailure.status).toBe(502);

    const restDenied = await fetch(`${server.baseUrl}/api/rest/v1/version`, {
      headers: {
        Cookie: cookie,
        'X-C64U-Host': 'example.com',
      },
    });
    expect(restDenied.status).toBe(403);

    const ftpDenied = await fetch(`${server.baseUrl}/api/ftp/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Cookie: cookie,
      },
      body: JSON.stringify({
        host: '192.0.2.1',
        port: 21,
        username: 'anonymous',
        path: '/MUSIC/test.sid',
      }),
    });
    expect(ftpDenied.status).toBe(403);

    await server.close();
  });
});
