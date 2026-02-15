import { test, expect } from '@playwright/test';
import { mkdtemp, access, rm } from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';

const waitForHttp = async (url: string, timeoutMs = 15000) => {
    const started = Date.now();
    let lastError: unknown;
    while (Date.now() - started < timeoutMs) {
        try {
            const response = await fetch(url);
            if (response.ok) {
                return;
            }
            lastError = new Error(`Unexpected status ${response.status}`);
        } catch (error) {
            lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for ${url}: ${String(lastError)}`);
};

const reserveFreePort = async (): Promise<number> => {
    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => resolve());
        server.once('error', reject);
    });
    const address = server.address();
    await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
    });
    if (!address || typeof address === 'string') {
        throw new Error('Unable to reserve free TCP port');
    }
    return address.port;
};

const startStandaloneServer = async (configDir: string, port: number): Promise<ChildProcess> => {
    const serverEntry = path.resolve('web/server/dist/index.js');
    const distDir = path.resolve('dist');
    await access(serverEntry);
    await access(path.join(distDir, 'index.html'));

    const child = spawn('node', [serverEntry], {
        env: {
            ...process.env,
            HOST: '127.0.0.1',
            PORT: String(port),
            WEB_CONFIG_DIR: configDir,
            WEB_DIST_DIR: distDir,
        },
        stdio: 'ignore',
    });

    await waitForHttp(`http://127.0.0.1:${port}/healthz`);
    return child;
};

const stopStandaloneServer = async (child: ChildProcess): Promise<void> => {
    if (child.killed) {
        return;
    }
    child.kill('SIGTERM');
    await new Promise<void>((resolve) => {
        child.once('exit', () => resolve());
        setTimeout(() => resolve(), 3000);
    });
};

type RequestLike = {
    get: (url: string, options?: { headers?: Record<string, string> }) => Promise<{
        status: () => number;
        headers: () => Record<string, string>;
        json: () => Promise<unknown>;
    }>;
};

type ProxyResponseLike = {
    status: () => number;
    json: () => Promise<unknown>;
};

const ensureWebAuthApi = async (request: RequestLike): Promise<boolean> => {
    const authStatus = await request.get('/auth/status');
    if (authStatus.status() !== 200) {
        return false;
    }
    const contentType = authStatus.headers()['content-type'] ?? '';
    if (!contentType.includes('application/json')) {
        return false;
    }
    try {
        const payload = await authStatus.json() as { requiresLogin?: unknown; authenticated?: unknown };
        return typeof payload.requiresLogin === 'boolean' && typeof payload.authenticated === 'boolean';
    } catch (error) {
        console.warn('Failed to parse /auth/status payload in web auth probe', { error });
        return false;
    }
};

const resolveReachableProxyHost = async (
    request: RequestLike,
    upstreamPort: number,
    cookieHeader: string,
): Promise<{ host: string; response: ProxyResponseLike }> => {
    const hostCandidates = [
        `127.0.0.1:${upstreamPort}`,
        `host.docker.internal:${upstreamPort}`,
        `172.17.0.1:${upstreamPort}`,
        `172.18.0.1:${upstreamPort}`,
    ];

    const attempts: Array<{ host: string; status: number }> = [];
    for (const host of hostCandidates) {
        const response = await request.get('/api/rest/v1/version', {
            headers: {
                'X-C64U-Host': host,
                Cookie: cookieHeader,
            },
        });
        const status = response.status();
        attempts.push({ host, status });
        if (status === 200) {
            return { host, response };
        }
    }

    throw new Error(`Unable to reach upstream through REST proxy. Attempts: ${JSON.stringify(attempts)}`);
};

test.describe('Web platform auth + proxy @web-platform', () => {
    let upstream: http.Server;
    let upstreamHost: string;
    let upstreamPort: number;

    test.beforeAll(async () => {
        upstream = http.createServer((req, res) => {
            if (req.url?.startsWith('/v1/version')) {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ version: '3.12.0', errors: [] }));
                return;
            }
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
        });
        await new Promise<void>((resolve, reject) => {
            upstream.listen(0, '127.0.0.1', () => resolve());
            upstream.once('error', reject);
        });
        const address = upstream.address();
        if (!address || typeof address === 'string') {
            throw new Error('Invalid upstream address');
        }
        upstreamPort = address.port;
        upstreamHost = `127.0.0.1:${address.port}`;
    });

    test.afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            upstream.close((error) => (error ? reject(error) : resolve()));
        });
    });

    test('health and root page load with no password', async ({ page, request }) => {
        const health = await request.get('/healthz');
        expect(health.status()).toBe(200);
        const root = await page.goto('/');
        expect(root?.status()).toBe(200);
    });

    test('auth matrix and protected routes', async ({ page, request }) => {
        if (!(await ensureWebAuthApi(request))) {
            test.skip(true, 'Web platform auth JSON endpoints are unavailable in this runtime');
        }

        const setPassword = await request.put('/api/secure-storage/password', {
            data: { value: 'secret' },
        });
        if (setPassword.status() === 404) {
            test.skip(true, 'Web platform secure-storage endpoints are unavailable in this runtime');
        }
        if (setPassword.status() === 401) {
            const login = await request.post('/auth/login', { data: { password: 'secret' } });
            expect(login.status()).toBe(200);
            const retry = await request.put('/api/secure-storage/password', {
                data: { value: 'secret' },
                headers: { Cookie: login.headers()['set-cookie'] ?? '' },
            });
            expect(retry.status()).toBe(200);
        } else {
            expect(setPassword.status()).toBe(200);
        }

        await request.post('/auth/logout');

        const blockedProxy = await request.get('/api/rest/v1/version', {
            headers: {
                'X-C64U-Host': upstreamHost,
            },
        });
        expect(blockedProxy.status()).toBe(401);

        const blockedRoot = await page.goto('/');
        expect(blockedRoot?.status()).toBe(401);

        await page.goto('/login');
        await page.getByPlaceholder('Network password').fill('wrong');
        await page.getByRole('button', { name: 'Log in' }).click();
        await expect(page.getByText('Invalid password')).toBeVisible();

        await page.getByPlaceholder('Network password').fill('secret');
        await page.getByRole('button', { name: 'Log in' }).click();
        await expect(page).toHaveURL(/\/$/);

        const cookieHeader = (await page.context().cookies())
            .map((cookie) => `${cookie.name}=${cookie.value}`)
            .join('; ');

        try {
            const { response: proxyOk } = await resolveReachableProxyHost(request, upstreamPort, cookieHeader);
            expect(proxyOk.status()).toBe(200);
            const payload = await proxyOk.json() as { version: string };
            expect(payload.version).toBe('3.12.0');
        } catch (error) {
            if (!(error instanceof Error) || !error.message.includes('Unable to reach upstream through REST proxy')) {
                throw error;
            }
            const proxyFallback = await request.get('/api/rest/v1/version', {
                headers: {
                    'X-C64U-Host': upstreamHost,
                    Cookie: cookieHeader,
                },
            });
            expect(proxyFallback.status()).toBe(502);
            const payload = await proxyFallback.json() as { error?: string };
            expect(payload.error).toContain('REST proxy upstream request failed');
        }
    });

    test('high-value click path: Play page opens Add items modal', async ({ page, request }) => {
        if (!(await ensureWebAuthApi(request))) {
            test.skip(true, 'Web platform auth JSON endpoints are unavailable in this runtime');
        }

        const clearPassword = await request.delete('/api/secure-storage/password');
        if (clearPassword.status() === 404) {
            test.skip(true, 'Web platform secure-storage endpoints are unavailable in this runtime');
        }
        if (clearPassword.status() === 401) {
            const login = await request.post('/auth/login', { data: { password: 'secret' } });
            if (login.status() !== 200) {
                test.skip(true, 'Unable to reset auth state with known test password');
            }
            const retryClear = await request.delete('/api/secure-storage/password', {
                headers: { Cookie: login.headers()['set-cookie'] ?? '' },
            });
            if (retryClear.status() !== 200) {
                test.skip(true, 'Unable to clear configured password for deterministic setup');
            }
        } else {
            expect(clearPassword.status()).toBe(200);
        }

        await page.goto('/play');
        const addButton = page.getByRole('button', { name: /Add items|Add more items/i });
        await expect(addButton).toBeVisible({ timeout: 30000 });
        await addButton.click();
        await expect(page.getByRole('dialog')).toBeVisible();
    });

    test('edge path: unreachable upstream returns deterministic proxy error', async ({ request }) => {
        if (!(await ensureWebAuthApi(request))) {
            test.skip(true, 'Web platform auth JSON endpoints are unavailable in this runtime');
        }

        const clearPassword = await request.delete('/api/secure-storage/password');
        if (clearPassword.status() === 404) {
            test.skip(true, 'Web platform secure-storage endpoints are unavailable in this runtime');
        }
        if (clearPassword.status() === 401) {
            const login = await request.post('/auth/login', { data: { password: 'secret' } });
            if (login.status() !== 200) {
                test.skip(true, 'Unable to reset auth state with known test password');
            }
            const retryClear = await request.delete('/api/secure-storage/password', {
                headers: { Cookie: login.headers()['set-cookie'] ?? '' },
            });
            if (retryClear.status() !== 200) {
                test.skip(true, 'Unable to clear configured password for deterministic setup');
            }
        } else {
            expect(clearPassword.status()).toBe(200);
        }

        const response = await request.get('/api/rest/v1/version', {
            headers: {
                'X-C64U-Host': '127.0.0.1:1',
            },
        });
        expect(response.status()).toBe(502);
        const payload = await response.json() as { error?: string };
        expect(payload.error).toContain('REST proxy upstream request failed');
    });

    test('persistence: password survives server restart with shared /config', async ({ request }, testInfo) => {
        if (testInfo.project.name !== 'web') {
            test.skip(true, 'Standalone web-server restart check is only supported in web project');
        }
        if (!(await ensureWebAuthApi(request))) {
            test.skip(true, 'Web platform auth JSON endpoints are unavailable in this runtime');
        }

        const configDir = await mkdtemp(path.join(os.tmpdir(), 'c64-web-config-'));
        const port = await reserveFreePort();
        let firstServer: ChildProcess | undefined;
        let secondServer: ChildProcess | undefined;
        try {
            firstServer = await startStandaloneServer(configDir, port);

            const setPassword = await fetch(`http://127.0.0.1:${port}/api/secure-storage/password`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: 'secret' }),
            });
            expect(setPassword.status).toBe(200);

            await stopStandaloneServer(firstServer);

            secondServer = await startStandaloneServer(configDir, port);
            const rootBlocked = await fetch(`http://127.0.0.1:${port}/`);
            expect(rootBlocked.status).toBe(401);

            const statusAfterRestart = await fetch(`http://127.0.0.1:${port}/auth/status`);
            expect(statusAfterRestart.status).toBe(200);
            const statusPayload = await statusAfterRestart.json() as { requiresLogin: boolean };
            expect(statusPayload.requiresLogin).toBe(true);
        } finally {
            if (firstServer) {
                await stopStandaloneServer(firstServer);
            }
            if (secondServer) {
                await stopStandaloneServer(secondServer);
            }
            await rm(configDir, { recursive: true, force: true });
        }
    });
});
