import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { strToU8, zipSync } from 'fflate';

export type HvscFixture = {
  version: number;
  songs: Array<{ virtualPath: string; fileName: string; dataBase64: string; durationSeconds?: number; durations?: number[] }>;
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
  const formatDuration = (seconds?: number) => {
    const total = Math.max(0, seconds ?? 0);
    const minutes = Math.floor(total / 60);
    const secs = total % 60;
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  };
  const buildArchive = (fixture: HvscFixture) => {
    const files: Record<string, Uint8Array> = {};
    fixture.songs.forEach((song) => {
      const pathPart = song.virtualPath.replace(/^\//, '');
      files[`HVSC/${pathPart}`] = Buffer.from(song.dataBase64, 'base64');
    });
    const songlengths = fixture.songs
      .map((song) => {
        const path = song.virtualPath.replace(/^\//, '');
        if (song.durations?.length) {
          return `${path}= ${song.durations.map(d => formatDuration(d)).join(' ')}`;
        }
        return `${path} ${formatDuration(song.durationSeconds)}`;
      })
      .join('\n');
    files['HVSC/Songlengths.txt'] = strToU8(songlengths);
    return Buffer.from(zipSync(files));
  };
  const baselineArchive = buildArchive(baseline);
  const updateArchive = buildArchive(update);

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
    if (url === '/' || url === '/hvsc' || url === '/hvsc/') {
      const html = `
        <html>
          <a href="HVSC_${baseline.version}-all-of-them.7z">HVSC_${baseline.version}-all-of-them.7z</a>
          <a href="HVSC_Update_${update.version}.7z">HVSC_Update_${update.version}.7z</a>
        </html>
      `;
      res.writeHead(200, { 'Content-Type': 'text/html', ...corsHeaders });
      res.end(html);
      return;
    }
    if (url.startsWith(`/hvsc/HVSC_${baseline.version}-all-of-them.7z`)) {
      res.writeHead(200, { 'Content-Type': 'application/x-7z-compressed', ...corsHeaders });
      res.end(baselineArchive);
      return;
    }
    if (url.startsWith(`/hvsc/HVSC_Update_${update.version}.7z`)) {
      res.writeHead(200, { 'Content-Type': 'application/x-7z-compressed', ...corsHeaders });
      res.end(updateArchive);
      return;
    }
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
