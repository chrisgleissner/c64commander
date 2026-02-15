import http, { type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { URL } from 'node:url';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { Client as FtpClient } from 'basic-ftp';

type AppConfig = {
    networkPassword: string | null;
    defaultDeviceHost: string;
};

type SessionRecord = {
    token: string;
    createdAtMs: number;
    expiresAtMs: number;
};

const COOKIE_NAME = 'c64_session';
const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PORT = Number(process.env.PORT ?? '8080');
const HOST = process.env.HOST ?? '0.0.0.0';
const configDir = process.env.WEB_CONFIG_DIR ?? '/config';
const configPath = path.join(configDir, 'web-config.json');
const distDir = process.env.WEB_DIST_DIR
    ? path.resolve(process.env.WEB_DIST_DIR)
    : path.resolve(process.cwd(), 'dist');

const hopByHopHeaders = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailers',
    'transfer-encoding',
    'upgrade',
    'host',
    'content-length',
]);

const sessions = new Map<string, SessionRecord>();

const normalizePassword = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
};

const sanitizeHost = (value: unknown): string | null => {
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (/^https?:\/\//i.test(trimmed)) return null;
    if (/[\s/]/.test(trimmed)) return null;
    return trimmed;
};

const parseCookies = (headerValue: string | undefined): Record<string, string> => {
    if (!headerValue) return {};
    return headerValue.split(';').reduce<Record<string, string>>((acc, pair) => {
        const idx = pair.indexOf('=');
        if (idx < 0) return acc;
        const key = pair.slice(0, idx).trim();
        const value = pair.slice(idx + 1).trim();
        if (key) acc[key] = decodeURIComponent(value);
        return acc;
    }, {});
};

const readBody = async (req: IncomingMessage): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
};

const readJsonBody = async <T>(req: IncomingMessage): Promise<T> => {
    const body = await readBody(req);
    if (body.length === 0) {
        return {} as T;
    }
    return JSON.parse(body.toString('utf8')) as T;
};

const writeJson = (res: ServerResponse, status: number, payload: unknown) => {
    const body = Buffer.from(JSON.stringify(payload));
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': String(body.length),
        'Cache-Control': 'no-store',
    });
    res.end(body);
};

const writeText = (res: ServerResponse, status: number, body: string, contentType = 'text/plain; charset=utf-8') => {
    const data = Buffer.from(body);
    res.writeHead(status, {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        'Cache-Control': 'no-store',
    });
    res.end(data);
};

const writeBuffer = (res: ServerResponse, status: number, data: Buffer, contentType = 'application/octet-stream') => {
    res.writeHead(status, {
        'Content-Type': contentType,
        'Content-Length': String(data.length),
        'Cache-Control': 'no-store',
    });
    res.end(data);
};

const safeCompare = (left: string, right: string): boolean => {
    const leftBuf = Buffer.from(left);
    const rightBuf = Buffer.from(right);
    if (leftBuf.length !== rightBuf.length) return false;
    return timingSafeEqual(leftBuf, rightBuf);
};

const loginHtml = () => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>C64 Commander Login</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0b0c; color: #fff; }
      form { width: 320px; background: #17171a; padding: 24px; border-radius: 12px; border: 1px solid #2a2a31; }
      h1 { margin: 0 0 16px; font-size: 18px; }
      input, button { width: 100%; box-sizing: border-box; }
      input { padding: 10px; border-radius: 8px; border: 1px solid #3b3b45; background: #101014; color: #fff; }
      button { margin-top: 12px; padding: 10px; border-radius: 8px; border: 0; background: #275df6; color: #fff; font-weight: 600; cursor: pointer; }
      p { margin-top: 10px; min-height: 20px; color: #ff8080; }
    </style>
  </head>
  <body>
    <form id="login-form">
      <h1>C64 Commander</h1>
      <input id="password" type="password" placeholder="Network password" autocomplete="current-password" required />
      <button type="submit">Log in</button>
      <p id="error"></p>
    </form>
    <script>
      const form = document.getElementById('login-form');
      const error = document.getElementById('error');
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        error.textContent = '';
        const password = document.getElementById('password').value;
        const response = await fetch('/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password }),
        });
        if (!response.ok) {
          error.textContent = 'Invalid password';
          return;
        }
        window.location.assign('/');
      });
    </script>
  </body>
</html>`;

const getContentType = (filePath: string) => {
    if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
    if (filePath.endsWith('.js')) return 'application/javascript; charset=utf-8';
    if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
    if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
    if (filePath.endsWith('.svg')) return 'image/svg+xml';
    if (filePath.endsWith('.png')) return 'image/png';
    if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg';
    if (filePath.endsWith('.webm')) return 'video/webm';
    if (filePath.endsWith('.woff2')) return 'font/woff2';
    return 'application/octet-stream';
};

const loadConfig = async (): Promise<AppConfig> => {
    const defaultConfig: AppConfig = {
        networkPassword: normalizePassword(process.env.C64U_NETWORK_PASSWORD) ?? null,
        defaultDeviceHost: sanitizeHost(process.env.C64U_DEVICE_HOST) ?? 'c64u',
    };
    await fs.mkdir(configDir, { recursive: true });
    try {
        const raw = await fs.readFile(configPath, 'utf8');
        const parsed = JSON.parse(raw) as Partial<AppConfig>;
        const networkPassword = normalizePassword(parsed.networkPassword);
        const defaultDeviceHost = sanitizeHost(parsed.defaultDeviceHost) ?? defaultConfig.defaultDeviceHost;
        return { networkPassword, defaultDeviceHost };
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') {
            console.error('Failed to load web config', err);
            throw error;
        }
        await saveConfig(defaultConfig);
        return defaultConfig;
    }
};

const saveConfig = async (config: AppConfig): Promise<void> => {
    await fs.mkdir(configDir, { recursive: true });
    const payload = JSON.stringify(config, null, 2);
    await fs.writeFile(configPath, payload, 'utf8');
};

const isAuthenticated = (req: IncomingMessage): boolean => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (!token) return false;
    const session = sessions.get(token);
    if (!session) return false;
    if (session.expiresAtMs < Date.now()) {
        sessions.delete(token);
        return false;
    }
    return true;
};

const issueSessionCookie = (res: ServerResponse) => {
    const token = randomBytes(24).toString('base64url');
    const createdAtMs = Date.now();
    const session: SessionRecord = {
        token,
        createdAtMs,
        expiresAtMs: createdAtMs + SESSION_TTL_MS,
    };
    sessions.set(token, session);
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`);
};

const clearSessionCookie = (req: IncomingMessage, res: ServerResponse) => {
    const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
    if (token) {
        sessions.delete(token);
    }
    res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
};

const cleanupExpiredSessions = () => {
    const now = Date.now();
    for (const [token, session] of sessions.entries()) {
        if (session.expiresAtMs < now) sessions.delete(token);
    }
};

const requiresLogin = (config: AppConfig) => Boolean(config.networkPassword);

const handleRestProxy = async (req: IncomingMessage, res: ServerResponse, config: AppConfig, requestUrl: URL) => {
    const targetHost = sanitizeHost(req.headers['x-c64u-host']) ?? config.defaultDeviceHost;
    const proxiedPath = requestUrl.pathname.replace(/^\/api\/rest/, '') || '/';
    const target = new URL(`http://${targetHost}${proxiedPath}${requestUrl.search}`);
    const body = await readBody(req);
    const outgoingHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
        if (!value) continue;
        const lower = key.toLowerCase();
        if (hopByHopHeaders.has(lower)) continue;
        if (lower === 'x-c64u-host' || lower === 'cookie') continue;
        outgoingHeaders[key] = Array.isArray(value) ? value.join(',') : value;
    }
    if (config.networkPassword) {
        outgoingHeaders['X-Password'] = config.networkPassword;
    }

    let upstream: Response;
    try {
        upstream = await fetch(target, {
            method: req.method,
            headers: outgoingHeaders,
            body: body.length > 0 ? body : undefined,
        });
    } catch (error) {
        console.error('REST proxy upstream error', { error });
        writeJson(res, 502, { error: 'REST proxy upstream request failed' });
        return;
    }

    for (const [key, value] of upstream.headers.entries()) {
        if (hopByHopHeaders.has(key.toLowerCase())) continue;
        res.setHeader(key, value);
    }
    res.statusCode = upstream.status;
    const responseBody = Buffer.from(await upstream.arrayBuffer());
    res.end(responseBody);
};

const collectStream = async (stream: PassThrough): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
        stream.on('data', (chunk) => {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });
        stream.on('error', reject);
        stream.on('end', () => resolve(Buffer.concat(chunks)));
    });
};

const handleFtpList = async (req: IncomingMessage, res: ServerResponse, config: AppConfig) => {
    const payload = await readJsonBody<{ host?: string; port?: number; username?: string; password?: string; path?: string }>(req);
    const host = sanitizeHost(payload.host) ?? config.defaultDeviceHost;
    const ftp = new FtpClient();
    ftp.ftp.verbose = false;
    try {
        await ftp.access({
            host,
            port: Number(payload.port ?? 21),
            user: payload.username ?? 'anonymous',
            password: config.networkPassword ?? payload.password ?? '',
            secure: false,
        });
        const entries = await ftp.list(payload.path ?? '/');
        writeJson(res, 200, {
            entries: entries.map((entry) => ({
                name: entry.name,
                path: `${payload.path ?? '/'}${(payload.path ?? '/').endsWith('/') ? '' : '/'}${entry.name}`,
                type: entry.type === 1 ? 'file' : 'dir',
                size: entry.size,
                modifiedAt: entry.modifiedAt ? entry.modifiedAt.toISOString() : null,
            })),
        });
    } catch (error) {
        console.error('FTP list failed', { error });
        writeJson(res, 502, { error: `FTP list failed: ${(error as Error).message}` });
    } finally {
        try {
            ftp.close();
        } catch (error) {
            console.warn('FTP close failed after list', { error });
        }
    }
};

const handleFtpRead = async (req: IncomingMessage, res: ServerResponse, config: AppConfig) => {
    const payload = await readJsonBody<{ host?: string; port?: number; username?: string; password?: string; path?: string }>(req);
    if (!payload.path) {
        writeJson(res, 400, { error: 'Missing FTP path' });
        return;
    }
    const host = sanitizeHost(payload.host) ?? config.defaultDeviceHost;
    const ftp = new FtpClient();
    ftp.ftp.verbose = false;
    const stream = new PassThrough();
    try {
        await ftp.access({
            host,
            port: Number(payload.port ?? 21),
            user: payload.username ?? 'anonymous',
            password: config.networkPassword ?? payload.password ?? '',
            secure: false,
        });
        const collectPromise = collectStream(stream);
        await ftp.downloadTo(stream, payload.path);
        stream.end();
        const data = await collectPromise;
        writeJson(res, 200, {
            data: data.toString('base64'),
            sizeBytes: data.byteLength,
        });
    } catch (error) {
        console.error('FTP read failed', { error });
        writeJson(res, 502, { error: `FTP read failed: ${(error as Error).message}` });
    } finally {
        try {
            ftp.close();
        } catch (error) {
            console.warn('FTP close failed after read', { error });
        }
    }
};

const serveStatic = async (res: ServerResponse, requestPath: string) => {
    const normalized = requestPath === '/' ? '/index.html' : requestPath;
    const safePath = path.normalize(normalized).replace(/^\.\.(\/|\\|$)/, '');
    const fullPath = path.join(distDir, safePath);

    try {
        const stat = await fs.stat(fullPath);
        if (stat.isDirectory()) {
            const indexPath = path.join(fullPath, 'index.html');
            const data = await fs.readFile(indexPath);
            writeText(res, 200, data.toString('utf8'), 'text/html; charset=utf-8');
            return;
        }
        const data = await fs.readFile(fullPath);
        writeBuffer(res, 200, data, getContentType(fullPath));
        return;
    } catch (error) {
        const err = error as NodeJS.ErrnoException;
        if (err.code !== 'ENOENT') {
            console.error('Static file serve failed', { error });
            writeJson(res, 500, { error: 'Failed to serve static asset' });
            return;
        }
    }

    try {
        const indexHtml = await fs.readFile(path.join(distDir, 'index.html'), 'utf8');
        writeText(res, 200, indexHtml, 'text/html; charset=utf-8');
    } catch (error) {
        console.error('Missing index.html in dist output', { error });
        writeJson(res, 500, { error: 'Web bundle missing. Build dist before starting server.' });
    }
};

export const startWebServer = async () => {
    let config = await loadConfig();

    const server = http.createServer(async (req, res) => {
        cleanupExpiredSessions();
        try {
            const method = (req.method ?? 'GET').toUpperCase();
            const requestUrl = new URL(req.url ?? '/', 'http://localhost');
            const pathname = requestUrl.pathname;

            if (pathname === '/healthz') {
                writeJson(res, 200, { ok: true });
                return;
            }

            if (pathname === '/auth/status') {
                writeJson(res, 200, {
                    requiresLogin: requiresLogin(config),
                    authenticated: isAuthenticated(req),
                });
                return;
            }

            if (pathname === '/auth/login') {
                if (method !== 'POST') {
                    writeJson(res, 405, { error: 'Method not allowed' });
                    return;
                }
                const payload = await readJsonBody<{ password?: string }>(req);
                const candidate = payload.password ?? '';
                const expected = config.networkPassword;
                if (!expected || !safeCompare(candidate, expected)) {
                    writeJson(res, 401, { error: 'Invalid password' });
                    return;
                }
                issueSessionCookie(res);
                writeJson(res, 200, { ok: true });
                return;
            }

            if (pathname === '/auth/logout') {
                clearSessionCookie(req, res);
                writeJson(res, 200, { ok: true });
                return;
            }

            const needsAuth = requiresLogin(config);
            const authenticated = isAuthenticated(req);
            const isPublicLoginPage = pathname === '/login';

            if (needsAuth && !authenticated) {
                if (isPublicLoginPage) {
                    writeText(res, 200, loginHtml(), 'text/html; charset=utf-8');
                    return;
                }
                writeJson(res, 401, { error: 'Authentication required' });
                return;
            }

            if (pathname === '/api/secure-storage/password') {
                if (method === 'GET') {
                    writeJson(res, 200, { value: config.networkPassword });
                    return;
                }
                if (method === 'PUT') {
                    const payload = await readJsonBody<{ value?: string }>(req);
                    const password = normalizePassword(payload.value);
                    config = { ...config, networkPassword: password };
                    await saveConfig(config);
                    if (password && !authenticated) {
                        issueSessionCookie(res);
                    }
                    writeJson(res, 200, { ok: true, hasPassword: Boolean(password) });
                    return;
                }
                if (method === 'DELETE') {
                    config = { ...config, networkPassword: null };
                    await saveConfig(config);
                    clearSessionCookie(req, res);
                    writeJson(res, 200, { ok: true });
                    return;
                }
                writeJson(res, 405, { error: 'Method not allowed' });
                return;
            }

            if (pathname.startsWith('/api/rest/')) {
                await handleRestProxy(req, res, config, requestUrl);
                return;
            }

            if (pathname === '/api/ftp/list') {
                if (method !== 'POST') {
                    writeJson(res, 405, { error: 'Method not allowed' });
                    return;
                }
                await handleFtpList(req, res, config);
                return;
            }

            if (pathname === '/api/ftp/read') {
                if (method !== 'POST') {
                    writeJson(res, 405, { error: 'Method not allowed' });
                    return;
                }
                await handleFtpRead(req, res, config);
                return;
            }

            if (pathname === '/login') {
                res.writeHead(302, { Location: '/' });
                res.end();
                return;
            }

            await serveStatic(res, pathname);
        } catch (error) {
            console.error('Unhandled web server error', error);
            writeJson(res, 500, { error: 'Internal server error' });
        }
    });

    await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(PORT, HOST, () => resolve());
    });

    console.log(`C64 Commander web server running on http://${HOST}:${PORT}`);
    return server;
};

const isDirectRun = (() => {
    const entry = process.argv[1];
    if (!entry) return false;
    return path.resolve(entry) === path.resolve(fileURLToPath(import.meta.url));
})();

if (isDirectRun) {
    void startWebServer().catch((error) => {
        console.error('Failed to start web server', error);
        process.exit(1);
    });
}
