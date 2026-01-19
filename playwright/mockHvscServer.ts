import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { spawnSync } from 'node:child_process';
import { path7za } from '7zip-bin';

const ensureExecutable = (filePath: string) => {
  try {
    fs.accessSync(filePath, fs.constants.X_OK);
  } catch {
    fs.chmodSync(filePath, 0o755);
  }
};

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

const parseSonglengths = (content: string) => {
  const pathToSeconds: Record<string, number> = {};
  let currentPath = '';
  content.split(/\r?\n/).forEach((raw) => {
    const line = raw.trim();
    if (!line) return;
    if (line.startsWith(';')) {
      const pathLine = line.replace(/^;\s*/, '').trim();
      currentPath = pathLine.startsWith('/') ? pathLine : `/${pathLine}`;
      return;
    }
    if (line.startsWith('[')) return;
    const [md5, time] = line.split('=');
    if (!md5 || !time) return;
    const [minPart, rest] = time.split(':');
    const [secPart, fracPart] = (rest || '').split('.');
    const minutes = Number(minPart);
    const seconds = Number(secPart);
    const fraction = Number(`0.${fracPart ?? '0'}`);
    const totalSeconds = Math.round(minutes * 60 + seconds + fraction);
    if (currentPath) pathToSeconds[currentPath] = totalSeconds;
  });
  return pathToSeconds;
};

const buildFixture = (rootDir: string, version: number): HvscFixture => {
  const documentsPath = path.join(rootDir, 'C64Music', 'DOCUMENTS', 'Songlengths.md5');
  const fallbackDocumentsPath = path.join(rootDir, 'DOCUMENTS', 'Songlengths.md5');
  const songlengthsPath = fs.existsSync(documentsPath) ? documentsPath : fallbackDocumentsPath;
  const durations = fs.existsSync(songlengthsPath)
    ? parseSonglengths(fs.readFileSync(songlengthsPath, 'utf8'))
    : {};

  const songs: HvscFixture['songs'] = [];
  const musicRootCandidate = path.join(rootDir, 'C64Music');
  const musicRoot = fs.existsSync(musicRootCandidate) ? musicRootCandidate : rootDir;
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    entries.forEach((entry: fs.Dirent) => {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.sid')) {
        const relative = path.relative(musicRoot, fullPath).replace(/\\/g, '/');
        const virtualPath = `/${relative}`;
        const data = fs.readFileSync(fullPath).toString('base64');
        songs.push({
          virtualPath,
          fileName: entry.name,
          dataBase64: data,
          durationSeconds: durations[virtualPath],
        });
      }
    });
  };

  walk(musicRoot);
  return { version, songs };
};

const ensureArchive = (sourceDir: string, name: string) => {
  const tempDir = path.join(os.tmpdir(), 'c64commander-hvsc');
  fs.mkdirSync(tempDir, { recursive: true });
  const archivePath = path.join(tempDir, name);
  if (fs.existsSync(archivePath)) return archivePath;
  ensureExecutable(path7za);
  const result = spawnSync(path7za, ['a', archivePath, '.'], { cwd: sourceDir, stdio: 'ignore' });
  if (result.status !== 0) {
    throw new Error(`Failed to create archive ${archivePath}`);
  }
  return archivePath;
};

export function createMockHvscServer(): Promise<MockHvscServer> {
  const baselineDir = path.resolve('tests/fixtures/hvsc/complete');
  const updateDir = path.resolve('tests/fixtures/hvsc/update/update');

  const baselineArchive = ensureArchive(baselineDir, 'HVSC_83-all-of-them.7z');
  const updateArchive = ensureArchive(updateDir, 'HVSC_Update_84.7z');

  const baseline = buildFixture(baselineDir, 83);
  const update = buildFixture(updateDir, 84);

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
      fs.createReadStream(baselineArchive).pipe(res);
      return;
    }
    if (url.startsWith('/hvsc/archive/update')) {
      res.writeHead(200, { 'Content-Type': 'application/x-7z-compressed', ...corsHeaders });
      fs.createReadStream(updateArchive).pipe(res);
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
