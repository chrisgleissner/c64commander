import * as http from 'node:http';
import { Client } from 'basic-ftp';

export type MockFtpBridgeServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

type FtpBridgeRequest = {
  host: string;
  port?: number;
  username?: string;
  password?: string;
  path?: string;
};

const withCors = (res: http.ServerResponse) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
};

const readJsonBody = async (req: http.IncomingMessage) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  if (!chunks.length) return null;
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : null;
};

const buildPath = (base: string, name: string) => {
  const normalized = base && base !== '' ? base : '/';
  if (normalized === '/') return `/${name}`;
  return normalized.endsWith('/') ? `${normalized}${name}` : `${normalized}/${name}`;
};

export async function createMockFtpBridgeServer(): Promise<MockFtpBridgeServer> {
  const server = http.createServer(async (req, res) => {
    try {
      withCors(res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (req.method !== 'POST' || req.url !== '/v1/ftp/list') {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
        return;
      }

      const payload = (await readJsonBody(req)) as FtpBridgeRequest | null;
      if (!payload?.host) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'host is required' }));
        return;
      }

      const client = new Client();
      client.ftp.verbose = false;

      try {
        await client.access({
          host: payload.host,
          port: payload.port ?? 21,
          user: payload.username ?? 'anonymous',
          password: payload.password ?? '',
          secure: false,
        });

        const listPath = payload.path && payload.path !== '' ? payload.path : '/';
        const items = await client.list(listPath);
        const entries = items
          .filter((entry) => entry.name && entry.name !== '.' && entry.name !== '..')
          .map((entry) => {
            const isDir = (entry as { isDirectory?: boolean }).isDirectory === true || entry.type === 2;
            return {
              name: entry.name,
              path: buildPath(listPath, entry.name),
              type: isDir ? 'dir' : 'file',
              size: entry.size || undefined,
              modifiedAt: entry.modifiedAt ? entry.modifiedAt.toISOString() : undefined,
            };
          });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ entries }));
      } catch (error) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (error as Error).message || 'FTP bridge error' }));
      } finally {
        client.close();
      }
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: (error as Error).message || 'FTP bridge failure' }));
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address();
  if (!addr || typeof addr === 'string') {
    throw new Error('FTP bridge server failed to start');
  }

  return {
    baseUrl: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
