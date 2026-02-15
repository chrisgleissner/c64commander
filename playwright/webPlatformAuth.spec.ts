import { test, expect } from '@playwright/test';
import http from 'node:http';

test.describe('Web platform auth + proxy @web-platform', () => {
    let upstream: http.Server;
    let upstreamHost: string;

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
        const setPassword = await request.put('/api/secure-storage/password', {
            data: { value: 'secret' },
        });
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

        const proxyOk = await request.get('/api/rest/v1/version', {
            headers: {
                'X-C64U-Host': upstreamHost,
                Cookie: cookieHeader,
            },
        });
        expect(proxyOk.status()).toBe(200);
        const payload = await proxyOk.json() as { version: string };
        expect(payload.version).toBe('3.12.0');
    });
});
