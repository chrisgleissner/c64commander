import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const swSource = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');

type CacheStore = Map<string, Response>;

const createCachesMock = () => {
    const stores = new Map<string, CacheStore>();

    const toKey = (request) => (typeof request === 'string' ? request : request.url);

    return {
        stores,
        open: async (name) => {
            if (!stores.has(name)) {
                stores.set(name, new Map());
            }
            const store = stores.get(name);
            return {
                addAll: async (entries) => {
                    entries.forEach((entry) => {
                        store.set(entry, new Response(`cached:${entry}`));
                    });
                },
                put: async (request, response) => {
                    store.set(toKey(request), response);
                },
                match: async (request) => store.get(toKey(request)) ?? undefined,
            };
        },
        keys: async () => [...stores.keys()],
        delete: async (name) => stores.delete(name),
        match: async (request) => {
            const key = toKey(request);
            for (const store of stores.values()) {
                const match = store.get(key);
                if (match) return match;
            }
            return undefined;
        },
    };
};

const dispatchExtendableEvent = async (handler) => {
    const promises = [];
    await handler({
        waitUntil(promise) {
            promises.push(Promise.resolve(promise));
        },
    });
    await Promise.all(promises);
};

const dispatchFetchEvent = async (handler, request) => {
    let responsePromise = null;
    handler({
        request,
        respondWith(promise) {
            responsePromise = Promise.resolve(promise);
        },
    });
    if (!responsePromise) {
        throw new Error('Expected respondWith to be called');
    }
    return responsePromise;
};

const loadServiceWorker = (buildId, fetchImpl = vi.fn()) => {
    const listeners = {};
    const caches = createCachesMock();
    const context = {
        URL,
        Request,
        Response,
        Promise,
        caches,
        fetch: fetchImpl,
        self: {
            location: {
                href: `https://example.test/sw.js?v=${buildId}`,
                origin: 'https://example.test',
            },
            skipWaiting: vi.fn(),
            clients: {
                claim: vi.fn(),
            },
            addEventListener(type, listener) {
                listeners[type] = listener;
            },
        },
    };

    vm.runInNewContext(swSource, context, { filename: 'sw.js' });

    return {
        caches,
        fetchImpl,
        listeners,
        self: context.self,
    };
};

describe('service worker lifecycle', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('deletes prior versioned caches during activation', async () => {
        const runtime = loadServiceWorker('build-2');
        await runtime.caches.open('c64commander-static-build-1');
        await runtime.caches.open('c64commander-static-build-2');
        await runtime.caches.open('other-cache');

        await dispatchExtendableEvent(runtime.listeners.activate);

        expect(await runtime.caches.keys()).toEqual(['c64commander-static-build-2', 'other-cache']);
        expect(runtime.self.clients.claim).toHaveBeenCalledTimes(1);
    });

    it('fetches a fresh app shell instead of serving a stale cached index', async () => {
        const fetchImpl = vi.fn().mockResolvedValue(new Response('fresh-shell', { status: 200 }));
        const runtime = loadServiceWorker('build-2', fetchImpl);

        const oldCache = await runtime.caches.open('c64commander-static-build-1');
        await oldCache.put('https://example.test/index.html', new Response('stale-shell', { status: 200 }));

        await dispatchExtendableEvent(runtime.listeners.activate);

        const response = await dispatchFetchEvent(
            runtime.listeners.fetch,
            new Request('https://example.test/index.html', { method: 'GET' }),
        );

        expect(await response.text()).toBe('fresh-shell');
        expect(fetchImpl).toHaveBeenCalledTimes(1);
    });
});
