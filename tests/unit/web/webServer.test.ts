import { afterEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createMockFtpServer, type MockFtpServer } from '../../contract/mockFtpServer.js';

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
        await writeFile(path.join(distDir, 'index.html'), '<html><body>ok</body></html>', 'utf8');

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

        await server.close();
    });

    it('enforces login when password is configured and rejects invalid password', async () => {
        const distDir = await makeTempDir('c64-web-dist-');
        const configDir = await makeTempDir('c64-web-config-');
        await writeFile(path.join(distDir, 'index.html'), '<html><body>private</body></html>', 'utf8');

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

    it('injects network password header in REST proxy requests', async () => {
        const distDir = await makeTempDir('c64-web-dist-');
        const configDir = await makeTempDir('c64-web-config-');
        await writeFile(path.join(distDir, 'index.html'), '<html><body>proxy</body></html>', 'utf8');

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
        await new Promise<void>((resolve, reject) => upstream.close((error) => (error ? reject(error) : resolve())));
    });

    it('proxies FTP list/read responses', async () => {
        const distDir = await makeTempDir('c64-web-dist-');
        const configDir = await makeTempDir('c64-web-config-');
        const ftpRoot = await makeTempDir('c64-web-ftp-root-');
        await writeFile(path.join(distDir, 'index.html'), '<html><body>ftp</body></html>', 'utf8');
        await mkdir(path.join(ftpRoot, 'MUSIC'));
        await writeFile(path.join(ftpRoot, 'MUSIC', 'test.sid'), 'PSID_DATA', 'utf8');

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
        const listPayload = await listRes.json() as { entries: Array<{ name: string }> };
        expect(listPayload.entries.some((entry) => entry.name === 'test.sid')).toBe(true);

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
        const readPayload = await readRes.json() as { data: string };
        expect(Buffer.from(readPayload.data, 'base64').toString('utf8')).toBe('PSID_DATA');

        await server.close();
    });

});
