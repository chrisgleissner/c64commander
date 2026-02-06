import { test, expect } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { unzipSync, strFromU8 } from 'fflate';
import { createMockC64Server } from '../tests/mocks/mockC64Server';
import { seedUiMocks } from './uiMocks';
import { saveCoverageFromPage } from './withCoverage';
import { assertNoUiIssues, attachStepScreenshot, finalizeEvidence, startStrictUiMonitoring } from './testArtifacts';
import type { TraceEvent } from '../src/lib/tracing/types';

const snap = async (page: Page, testInfo: TestInfo, label: string) => {
    await attachStepScreenshot(page, testInfo, label);
};

const decodeZip = (zipData: number[]) => {
    const files = unzipSync(new Uint8Array(zipData));
    return Object.fromEntries(Object.entries(files).map(([name, data]) => [name, strFromU8(data)]));
};

const seedActivityDots = async (page: Page) => {
    await page.evaluate(() => {
        const now = Date.now();
        const events: TraceEvent[] = [
            {
                id: `EVT-rest-${now}`,
                timestamp: new Date(now).toISOString(),
                relativeMs: 0,
                type: 'rest-response',
                origin: 'user',
                correlationId: `COR-rest-${now}`,
                data: { status: 200, durationMs: 10, error: null },
            },
            {
                id: `EVT-ftp-${now}`,
                timestamp: new Date(now + 10).toISOString(),
                relativeMs: 10,
                type: 'ftp-operation',
                origin: 'user',
                correlationId: `COR-ftp-${now}`,
                data: { operation: 'list', path: '/', result: 'success', target: 'real-device' },
            },
            {
                id: `EVT-error-${now}`,
                timestamp: new Date(now + 20).toISOString(),
                relativeMs: 20,
                type: 'error',
                origin: 'user',
                correlationId: `COR-error-${now}`,
                data: { message: 'Test error', name: 'Error' },
            },
        ];
        const tracing = (window as Window & { __c64uTracing?: { seedTraces?: (items: TraceEvent[]) => void } }).__c64uTracing;
        tracing?.seedTraces?.(events);
    });
};

test.describe('Home header and diagnostics overlay', () => {
    let server: Awaited<ReturnType<typeof createMockC64Server>>;

    test.beforeEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
        await startStrictUiMonitoring(page, testInfo);
        server = await createMockC64Server({});
        await seedUiMocks(page, server.baseUrl);
    });

    test.afterEach(async ({ page }: { page: Page }, testInfo: TestInfo) => {
        try {
            await saveCoverageFromPage(page, testInfo.title);
            await assertNoUiIssues(page, testInfo);
        } finally {
            await finalizeEvidence(page, testInfo);
            await server.close();
        }
    });

    test('home header renders brand layout without distortion', async ({ page }: { page: Page }, testInfo: TestInfo) => {
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await snap(page, testInfo, 'home-open');

        const logo = page.getByTestId('home-header-logo');
        const title = page.getByTestId('home-header-title');
        const subtitle = page.getByTestId('home-header-subtitle');
        await expect(logo).toBeVisible();
        await expect(title).toHaveText(/home/i);
        await expect(subtitle).toHaveText('C64 Controller');

        const ratios = await logo.evaluate((img: HTMLImageElement) => ({
            natural: img.naturalWidth / img.naturalHeight,
            rendered: img.clientWidth / img.clientHeight,
        }));
        expect(Math.abs(ratios.natural - ratios.rendered)).toBeLessThan(0.02);

        const header = page.locator('header');
        const homeHeaderBox = await header.boundingBox();
        await page.goto('/play', { waitUntil: 'domcontentloaded' });
        const playHeaderBox = await header.boundingBox();
        expect(Math.abs((homeHeaderBox?.height ?? 0) - (playHeaderBox?.height ?? 0))).toBeLessThanOrEqual(1);

        await expect(page.getByTestId('home-header-logo')).toHaveCount(0);
        await expect(page.getByText('C64 Controller', { exact: true })).toHaveCount(0);

        const diagnosticsIndicator = page.getByTestId('diagnostics-activity-indicator');
        const connectivityIndicator = page.getByTestId('connectivity-indicator');
        await expect(diagnosticsIndicator).toBeVisible();
        await expect(connectivityIndicator).toBeVisible();
        const [diagnosticsBox, connectivityBox] = await Promise.all([
            diagnosticsIndicator.boundingBox(),
            connectivityIndicator.boundingBox(),
        ]);
        expect((diagnosticsBox?.x ?? 0) + (diagnosticsBox?.width ?? 0)).toBeLessThan(connectivityBox?.x ?? Number.MAX_SAFE_INTEGER);

        await page.addInitScript(() => {
            const now = Date.now();
            type TraceEvent = { id: string; timestamp: string; relativeMs: number; type: string; origin: string; correlationId: string; data: Record<string, unknown> };
            (window as Window & { __c64uSeedTraces?: TraceEvent[] }).__c64uSeedTraces = [
                { id: 'EVT-dot-1', timestamp: new Date(now).toISOString(), relativeMs: 0, type: 'rest-response', origin: 'user', correlationId: 'COR-dot-1', data: { status: 200, durationMs: 5, error: null } },
                { id: 'EVT-dot-2', timestamp: new Date(now + 5).toISOString(), relativeMs: 5, type: 'ftp-operation', origin: 'user', correlationId: 'COR-dot-2', data: { operation: 'list', path: '/', result: 'success', target: 'real-device' } },
            ];
        });
        await page.goto('/', { waitUntil: 'domcontentloaded' });
        await page.evaluate(() => {
            const tracing = (window as Window & {
                __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void };
                __c64uSeedTraces?: TraceEvent[];
            }).__c64uTracing;
            const seed = (window as Window & { __c64uSeedTraces?: TraceEvent[] }).__c64uSeedTraces ?? [];
            tracing?.seedTraces?.(seed);
        });
        const restDot = page.getByTestId('diagnostics-activity-rest');
        const ftpDot = page.getByTestId('diagnostics-activity-ftp');
        await expect(restDot).toBeVisible();
        await expect(ftpDot).toBeVisible();

        const [restBox, ftpBox] = await Promise.all([restDot.boundingBox(), ftpDot.boundingBox()]);
        expect(restBox?.x ?? 0).toBeLessThan(ftpBox?.x ?? 0);
        expect((restBox?.x ?? 0) + (restBox?.width ?? 0)).toBeLessThan(ftpBox?.x ?? Number.MAX_SAFE_INTEGER);
    });

    test('status indicators open diagnostics on Actions tab', async ({ page }: { page: Page }, testInfo: TestInfo) => {
        await page.addInitScript(() => {
            const now = Date.now();
            (window as Window & { __c64uSeedTraces?: TraceEvent[] }).__c64uSeedTraces = [
                {
                    id: 'EVT-9000',
                    timestamp: new Date(now).toISOString(),
                    relativeMs: 0,
                    type: 'rest-response',
                    origin: 'user',
                    correlationId: 'COR-9000',
                    data: { status: 200, durationMs: 10, error: null },
                },
                {
                    id: 'EVT-9001',
                    timestamp: new Date(now + 10).toISOString(),
                    relativeMs: 10,
                    type: 'ftp-operation',
                    origin: 'user',
                    correlationId: 'COR-9000',
                    data: { operation: 'list', path: '/', result: 'success', target: 'real-device' },
                },
                {
                    id: 'EVT-9002',
                    timestamp: new Date(now + 20).toISOString(),
                    relativeMs: 20,
                    type: 'error',
                    origin: 'user',
                    correlationId: 'COR-9000',
                    data: { message: 'Test error', name: 'Error' },
                },
            ];
        });

        await page.goto('/', { waitUntil: 'domcontentloaded' });

        await page.evaluate(() => {
            const tracing = (window as Window & {
                __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void };
                __c64uSeedTraces?: TraceEvent[];
            }).__c64uTracing;
            const seed = (window as Window & { __c64uSeedTraces?: TraceEvent[] }).__c64uSeedTraces ?? [];
            tracing?.seedTraces?.(seed);
        });

        const indicators = [
            page.getByTestId('diagnostics-activity-rest'),
            page.getByTestId('diagnostics-activity-ftp'),
            page.getByTestId('diagnostics-activity-error'),
        ];

        for (const indicator of indicators) {
            await indicator.click();
            const dialog = page.getByRole('dialog', { name: /Diagnostics/i });
            await expect(dialog).toBeVisible();
            const actionsTab = dialog.getByRole('tab', { name: /Actions/i });
            await expect(actionsTab).toHaveAttribute('aria-selected', 'true');
            await snap(page, testInfo, `diagnostics-open-${await indicator.getAttribute('data-testid')}`);
            await dialog.getByRole('button', { name: 'Close' }).click();
        }
    });

    test('status indicators open diagnostics as modal without navigation or scroll jump', async ({ page }: { page: Page }, testInfo: TestInfo) => {
        for (const route of ['/play', '/docs']) {
            await page.goto(route, { waitUntil: 'domcontentloaded' });
            await seedActivityDots(page);
            const existingDialog = page.getByRole('dialog', { name: /Diagnostics/i });
            if (await existingDialog.isVisible().catch(() => false)) {
                await existingDialog.getByRole('button', { name: 'Close' }).click();
                await expect(existingDialog).toBeHidden();
            }
            await expect(page.getByTestId('diagnostics-activity-rest')).toBeVisible();

            await page.evaluate(() => window.scrollTo(0, 480));
            const before = await page.evaluate(() => ({ path: window.location.pathname, scrollY: Math.round(window.scrollY) }));

            await page.getByTestId('diagnostics-activity-rest').click();
            const dialog = page.getByRole('dialog', { name: /Diagnostics/i });
            await expect(dialog).toBeVisible();

            const whileOpenPath = await page.evaluate(() => window.location.pathname);
            expect(whileOpenPath).toBe(before.path);
            await snap(page, testInfo, `diagnostics-modal-open-${route.replace('/', '')}`);

            await dialog.getByRole('button', { name: 'Close' }).click();
            await expect(dialog).toBeHidden();

            const after = await page.evaluate(() => ({ path: window.location.pathname, scrollY: Math.round(window.scrollY) }));
            expect(after.path).toBe(before.path);
            expect(after.scrollY).toBe(before.scrollY);
            await snap(page, testInfo, `diagnostics-modal-closed-${route.replace('/', '')}`);
        }
    });

    test('clear all diagnostics empties every tab', async ({ page }: { page: Page }, testInfo: TestInfo) => {
        await page.addInitScript(() => {
            const logs = [
                { id: 'err-1', timestamp: new Date().toISOString(), level: 'error', message: 'Seed error', details: { note: 'boom' } },
                { id: 'log-1', timestamp: new Date().toISOString(), level: 'info', message: 'Seed log', details: { note: 'ok' } },
            ];
            localStorage.setItem('c64u_app_logs', JSON.stringify(logs));
        });

        await page.goto('/settings', { waitUntil: 'domcontentloaded' });

        await page.evaluate(() => {
            const now = Date.now();
            const events: TraceEvent[] = [
                {
                    id: 'EVT-9100',
                    timestamp: new Date(now).toISOString(),
                    relativeMs: 0,
                    type: 'action-start',
                    origin: 'user',
                    correlationId: 'COR-9100',
                    data: { name: 'seed.action' },
                },
                {
                    id: 'EVT-9101',
                    timestamp: new Date(now + 20).toISOString(),
                    relativeMs: 20,
                    type: 'action-end',
                    origin: 'user',
                    correlationId: 'COR-9100',
                    data: { status: 'success', error: null },
                },
                {
                    id: 'EVT-9102',
                    timestamp: new Date(now + 30).toISOString(),
                    relativeMs: 30,
                    type: 'rest-response',
                    origin: 'user',
                    correlationId: 'COR-9100',
                    data: { status: 200, durationMs: 10, error: null },
                },
            ];
            const tracing = (window as Window & { __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void } }).__c64uTracing;
            tracing?.seedTraces?.(events);
        });

        await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: /Diagnostics/i });
        await expect(dialog).toBeVisible();

        await dialog.getByRole('button', { name: /Clear All/i }).click();
        await page.getByRole('alertdialog', { name: /Clear diagnostics/i }).getByRole('button', { name: /Clear/i }).click();
        await snap(page, testInfo, 'clear-all-confirmed');

        await dialog.getByRole('tab', { name: /^Errors$/i }).click();
        await expect(dialog.getByText('Seed error')).toHaveCount(0);

        await dialog.getByRole('tab', { name: /^Logs$/i }).click();
        await expect(dialog.getByText('Seed log')).toHaveCount(0);
        await expect(dialog.getByText('Diagnostics cleared from global overlay')).toHaveCount(0);

        await dialog.getByRole('tab', { name: /^Traces$/i }).click();
        await expect(dialog.locator('[data-testid="trace-item-EVT-9100"]')).toHaveCount(0);

        await dialog.getByRole('tab', { name: /^Actions$/i }).click();
        await expect(dialog.locator('[data-testid="action-summary-COR-9100"]')).toHaveCount(0);
    });

    test('per-tab share exports only the active tab', async ({ page }: { page: Page }, testInfo: TestInfo) => {
        await page.addInitScript(() => {
            const logs = [
                { id: 'err-1', timestamp: new Date().toISOString(), level: 'error', message: 'Seed error', details: { note: 'boom' } },
                { id: 'log-1', timestamp: new Date().toISOString(), level: 'info', message: 'Seed log', details: { note: 'ok' } },
            ];
            localStorage.setItem('c64u_app_logs', JSON.stringify(logs));

            (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads = [];
            (window as Window & { __c64uDiagnosticsShareOverride?: (payload: any) => void }).__c64uDiagnosticsShareOverride = (payload) => {
                const list = (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads ?? [];
                list.push({
                    ...payload,
                    zipData: Array.from(payload.zipData ?? []),
                });
                (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads = list;
            };
        });

        await page.goto('/settings', { waitUntil: 'domcontentloaded' });

        await page.evaluate(() => {
            const now = Date.now();
            const events: TraceEvent[] = [
                {
                    id: 'EVT-9200',
                    timestamp: new Date(now).toISOString(),
                    relativeMs: 0,
                    type: 'action-start',
                    origin: 'user',
                    correlationId: 'COR-9200',
                    data: { name: 'share.action' },
                },
                {
                    id: 'EVT-9201',
                    timestamp: new Date(now + 20).toISOString(),
                    relativeMs: 20,
                    type: 'action-end',
                    origin: 'user',
                    correlationId: 'COR-9200',
                    data: { status: 'success', error: null },
                },
                {
                    id: 'EVT-9202',
                    timestamp: new Date(now + 30).toISOString(),
                    relativeMs: 30,
                    type: 'rest-response',
                    origin: 'user',
                    correlationId: 'COR-9200',
                    data: { status: 200, durationMs: 12, error: null },
                },
            ];
            const tracing = (window as Window & { __c64uTracing?: { seedTraces?: (events: TraceEvent[]) => void } }).__c64uTracing;
            tracing?.seedTraces?.(events);
        });

        await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: /Diagnostics/i });
        await expect(dialog).toBeVisible();

        const shareForTab = async (
            tabLabel: string,
            shareTestId: string,
            expectedFile: string,
            assertPayload: (data: unknown) => void,
        ) => {
            await dialog.getByRole('tab', { name: tabLabel }).click();
            await dialog.getByTestId(shareTestId).click();
            await expect.poll(async () =>
                page.evaluate(() => (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads?.length ?? 0),
            ).toBeGreaterThan(0);

            const payloads = await page.evaluate(() =>
                (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads ?? [],
            ) as Array<{ tab: string; zipData: number[] }>;
            const payload = payloads[payloads.length - 1];
            const files = decodeZip(payload.zipData);
            expect(Object.keys(files)).toEqual([expectedFile]);
            const parsed = JSON.parse(files[expectedFile]);
            assertPayload(parsed);
            await snap(page, testInfo, `share-${tabLabel.toLowerCase()}`);
        };

        await shareForTab('Errors', 'diagnostics-share-errors', 'error-logs.json', (data) => {
            const entries = data as Array<{ id: string; level?: string }>;
            expect(entries.some((entry) => entry.id === 'err-1')).toBeTruthy();
            expect(entries.every((entry) => entry.level === 'error')).toBeTruthy();
        });
        await shareForTab('Logs', 'diagnostics-share-logs', 'logs.json', (data) => {
            const entries = data as Array<{ id: string }>;
            expect(entries.some((entry) => entry.id === 'err-1')).toBeTruthy();
            expect(entries.some((entry) => entry.id === 'log-1')).toBeTruthy();
        });
        await shareForTab('Traces', 'diagnostics-share-traces', 'traces.json', (data) => {
            const entries = data as Array<{ id: string }>;
            const ids = entries.map((entry) => entry.id);
            expect(ids).toEqual(expect.arrayContaining(['EVT-9200', 'EVT-9201', 'EVT-9202']));
        });
        await shareForTab('Actions', 'diagnostics-share-actions', 'actions.json', (data) => {
            const entries = data as Array<{ correlationId?: string }>;
            expect(entries.some((entry) => entry.correlationId === 'COR-9200')).toBeTruthy();
        });
    });

    test('app header and footer remain fixed during scroll on core pages', async ({ page }: { page: Page }, testInfo: TestInfo) => {
        const paths = ['/', '/play', '/disks', '/config', '/settings', '/docs'];

        for (const path of paths) {
            await page.goto(path, { waitUntil: 'domcontentloaded' });

            await page.evaluate(() => {
                if (document.getElementById('test-scroll-spacer')) return;
                const spacer = document.createElement('div');
                spacer.id = 'test-scroll-spacer';
                spacer.style.height = '2000px';
                spacer.style.width = '1px';
                document.body.appendChild(spacer);
            });

            const header = page.locator('header');
            const footer = page.locator('nav.tab-bar');

            await expect(header).toBeVisible();
            await expect(footer).toBeVisible();

            const [headerBefore, footerBefore] = await Promise.all([
                header.boundingBox(),
                footer.boundingBox(),
            ]);

            await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
            await page.waitForTimeout(100);

            const [headerAfter, footerAfter, scrollY] = await Promise.all([
                header.boundingBox(),
                footer.boundingBox(),
                page.evaluate(() => window.scrollY),
            ]);

            expect(scrollY).toBeGreaterThan(0);

            const headerDelta = Math.abs((headerAfter?.y ?? 0) - (headerBefore?.y ?? 0));
            const footerDelta = Math.abs((footerAfter?.y ?? 0) - (footerBefore?.y ?? 0));
            const headerHeightDelta = Math.abs((headerAfter?.height ?? 0) - (headerBefore?.height ?? 0));

            expect(headerDelta).toBeLessThanOrEqual(0.5);
            expect(footerDelta).toBeLessThanOrEqual(0.5);
            expect(headerHeightDelta).toBeLessThanOrEqual(0.5);

            await snap(page, testInfo, `fixed-header-${path.replace('/', '') || 'home'}`);
        }
    });

    test('diagnostics overlay suppresses traces until share/error and restores after close', async ({ page }: { page: Page }, testInfo: TestInfo) => {
        await page.addInitScript(() => {
            (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads = [];
            (window as Window & { __c64uDiagnosticsShareOverride?: (payload: any) => void }).__c64uDiagnosticsShareOverride = (payload) => {
                const list = (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads ?? [];
                list.push({
                    ...payload,
                    zipData: Array.from(payload.zipData ?? []),
                });
                (window as Window & { __c64uDiagnosticsSharePayloads?: unknown[] }).__c64uDiagnosticsSharePayloads = list;
            };
        });

        await page.goto('/settings', { waitUntil: 'domcontentloaded' });

        await page.evaluate(() => {
            window.__c64uTracing?.resetTraceSession?.(0, 0);
            localStorage.setItem('c64u_app_logs', JSON.stringify([]));

            const now = Date.now();
            const events: TraceEvent[] = [];
            events.push({
                id: 'EVT-9300',
                timestamp: new Date(now).toISOString(),
                relativeMs: 0,
                type: 'action-start',
                origin: 'user',
                correlationId: 'COR-9300',
                data: { name: 'seed.action' },
            });
            events.push({
                id: 'EVT-9301',
                timestamp: new Date(now + 10).toISOString(),
                relativeMs: 10,
                type: 'action-end',
                origin: 'user',
                correlationId: 'COR-9300',
                data: { status: 'success', error: null },
            });
            for (let i = 0; i < 120; i += 1) {
                events.push({
                    id: `EVT-93${String(i).padStart(2, '0')}`,
                    timestamp: new Date(now + 20 + i).toISOString(),
                    relativeMs: 20 + i,
                    type: 'rest-response',
                    origin: 'user',
                    correlationId: 'COR-9300',
                    data: { status: 200, durationMs: 12, error: null },
                });
            }
            window.__c64uTracing?.seedTraces?.(events);
        });

        const getTraceCount = () => page.evaluate(() => window.__c64uTracing?.getTraces?.().length ?? 0);
        const getLogCount = () =>
            page.evaluate(() => {
                const raw = localStorage.getItem('c64u_app_logs');
                return raw ? JSON.parse(raw).length : 0;
            });

        const beforeOpenTraces = await getTraceCount();

        await page.getByRole('button', { name: 'Diagnostics', exact: true }).click();
        const dialog = page.getByRole('dialog', { name: /Diagnostics/i });
        await expect(dialog).toBeVisible();

        const afterOpenTraces = await getTraceCount();
        expect(afterOpenTraces).toBe(beforeOpenTraces);

        const baselineLogs = await getLogCount();
        const baselineTraces = await getTraceCount();

        await dialog.getByRole('tab', { name: /^Logs$/i }).click();
        await dialog.getByRole('tab', { name: /^Traces$/i }).click();

        const tracesPanel = dialog.locator('[role="tabpanel"][data-state="active"]');
        await tracesPanel.evaluate((panel: HTMLElement) => {
            panel.scrollTop = panel.scrollHeight;
        });

        const traceItem = dialog.locator('[data-testid^="trace-item-"]').first();
        await traceItem.click();
        await traceItem.click();

        await dialog.getByRole('tab', { name: /^Actions$/i }).click();
        const actionItem = dialog.locator('[data-testid^="action-summary-"]').first();
        await actionItem.click();
        await actionItem.click();

        expect(await getTraceCount()).toBe(baselineTraces);
        expect(await getLogCount()).toBe(baselineLogs);

        await dialog.getByRole('tab', { name: /^Traces$/i }).click();
        await dialog.getByTestId('diagnostics-share-traces').click();
        await expect.poll(getTraceCount).toBeGreaterThan(baselineTraces);

        const tracesAfterShare = await getTraceCount();
        await page.evaluate(() => {
            const error = new Error('Diagnostics overlay error');
            window.dispatchEvent(new ErrorEvent('error', { message: error.message, error }));
        });
        await expect.poll(getTraceCount).toBeGreaterThan(tracesAfterShare);
        await expect.poll(getLogCount).toBeGreaterThan(baselineLogs);

        await dialog.getByRole('button', { name: /Close/i }).click();

        const tracesAfterClose = await getTraceCount();
        await page.getByRole('button', { name: 'Home' }).click();
        await expect.poll(getTraceCount).toBeGreaterThan(tracesAfterClose);

        await snap(page, testInfo, 'diagnostics-suppression');
    });
});
