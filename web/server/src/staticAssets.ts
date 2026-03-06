import path from 'node:path';
import { promises as fs } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { writeBuffer, writeJson, writeText } from './httpIO.js';

export type LogErrorDetails = (error: unknown) => Record<string, unknown>;
export type LogError = (
  message: string,
  details?: Record<string, unknown>,
) => void;

const getStaticCacheControl = (safePath: string) => {
  const normalized = safePath.replace(/\\/g, '/');
  if (normalized === 'index.html') return 'no-store';
  if (normalized === 'sw.js' || normalized === 'manifest.webmanifest')
    return 'no-cache';
  const isHashedAsset = /^assets\/.+[-_.][a-f0-9]{8,}\.[a-z0-9]+$/i.test(
    normalized,
  );
  if (isHashedAsset) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
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
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg'))
    return 'image/jpeg';
  if (filePath.endsWith('.webm')) return 'video/webm';
  if (filePath.endsWith('.woff2')) return 'font/woff2';
  return 'application/octet-stream';
};

export const createStaticAssetServer = (options: {
  distDir: string;
  logError: LogError;
  errorDetails: LogErrorDetails;
}) => {
  const { distDir, logError, errorDetails } = options;

  const serveStatic = async (res: ServerResponse, requestPath: string) => {
    let decodedPath = requestPath;
    try {
      decodedPath = decodeURIComponent(requestPath);
    } catch {
      writeJson(res, 400, { error: 'Invalid path encoding' });
      return;
    }

    const normalized =
      decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '');
    const safePath = path.normalize(normalized);
    if (safePath.startsWith('..') || path.isAbsolute(safePath)) {
      writeJson(res, 403, { error: 'Invalid path' });
      return;
    }
    const fullPath = path.resolve(distDir, safePath);
    if (fullPath !== distDir && !fullPath.startsWith(`${distDir}${path.sep}`)) {
      writeJson(res, 403, { error: 'Invalid path' });
      return;
    }

    try {
      const stat = await fs.stat(fullPath);
      if (stat.isDirectory()) {
        const indexPath = path.join(fullPath, 'index.html');
        const data = await fs.readFile(indexPath);
        writeText(res, 200, data.toString('utf8'), 'text/html; charset=utf-8');
        return;
      }
      const data = await fs.readFile(fullPath);
      writeBuffer(
        res,
        200,
        data,
        getContentType(fullPath),
        getStaticCacheControl(safePath),
      );
      return;
    } catch (error) {
      const err = error as NodeJS.ErrnoException;
      if (err.code !== 'ENOENT') {
        logError('Static file serve failed', {
          requestPath,
          errorCode: err.code,
          ...errorDetails(error),
        });
        writeJson(res, 500, { error: 'Failed to serve static asset' });
        return;
      }
    }

    try {
      const indexHtml = await fs.readFile(
        path.join(distDir, 'index.html'),
        'utf8',
      );
      writeText(res, 200, indexHtml, 'text/html; charset=utf-8');
    } catch (error) {
      logError('Missing index.html in dist output', errorDetails(error));
      writeJson(res, 500, {
        error: 'Web bundle missing. Build dist before starting server.',
      });
    }
  };

  return {
    loginHtml,
    serveStatic,
  };
};
