import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';

export type HvscFixture = {
  version: number;
  songs: Array<{ virtualPath: string; fileName: string; dataBase64: string; durationSeconds?: number }>;
};

export interface MockHvscServer {
  baseUrl: string;
  close: () => Promise<void>;
  baseline: HvscFixture;
  update: HvscFixture;
}

const readFixture = <T,>(name: string): T => {
  const filePath = path.resolve('playwright/fixtures/hvsc', name);
  return JSON.parse(fs.readFileSync(filePath, 'utf8')) as T;
};

export function createMockHvscServer(): Promise<MockHvscServer> {
  const baseline = readFixture<HvscFixture>('baseline.json');
  const update = readFixture<HvscFixture>('update.json');
  const archives = readFixture<{ baselineBase64: string; updateBase64: string }>('archives.json');
  const baselineArchive = Buffer.from(archives.baselineBase64, 'base64');
  const updateArchive = Buffer.from(archives.updateBase64, 'base64');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,OPTIONS',
    'Access-Control-Allow-Headers': '*',
  };

  const server = http.createServer((req: http.IncomingMessage, res: http.ServerResponse) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }
    const url = req.url ?? '/';
    if (url.startsWith('/hvsc/archive/baseline')) {
      res.writeHead(200, { 'Content-Type': 'application/x-7z-compressed', ...corsHeaders });
      res.end(baselineArchive);
      return;
    }
    if (url.startsWith('/hvsc/archive/update')) {
      res.writeHead(200, { 'Content-Type': 'application/x-7z-compressed', ...corsHeaders });
      res.end(updateArchive);
      return;
    }
    if (url.startsWith('/hvsc/fixtures/baseline.json')) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify(baseline));
      return;
    }
    if (url.startsWith('/hvsc/fixtures/update.json')) {
      res.writeHead(200, { 'Content-Type': 'application/json', ...corsHeaders });
      res.end(JSON.stringify(update));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json', ...corsHeaders });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Unexpected server address');
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        baseline,
        update,
        close: () => new Promise((resClose) => server.close(() => resClose())),
      });
    });
  });
}
