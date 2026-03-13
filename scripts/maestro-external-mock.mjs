#!/usr/bin/env node
import http from 'node:http';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  loadMockTimingProfile,
  resolveMockTimingClassId,
  resolveMockTimingDelayMs,
} from './lib/mockTimingProfile.mjs';

const args = process.argv.slice(2);
const outIndex = args.indexOf('--out');
const outPath = outIndex >= 0 ? args[outIndex + 1] : null;

if (!outPath) {
  console.error('Missing --out <path>');
  process.exit(1);
}

const json = (res, status, payload) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(payload));
};

const buildConfigPayload = () => {
  const audioMixer = {
    'Vol UltiSid 1': { selected: 40, options: [0, 20, 40, 60, 80, 100] },
    'Vol UltiSid 2': { selected: 40, options: [0, 20, 40, 60, 80, 100] },
  };

  return {
    categories: ['Audio Mixer', 'SID Settings'],
    configs: {
      'Audio Mixer': audioMixer,
      'SID Settings': {
        'SID Model': { selected: '6581', options: ['6581', '8580'] },
      },
    },
  };
};

const { categories, configs } = buildConfigPayload();
const requests = [];
const timingProfile = await loadMockTimingProfile();
let requestSequence = 0;

const server = http.createServer((req, res) => {
  const method = req.method ?? 'GET';
  const url = req.url ?? '/';
  const parsed = new URL(url, 'http://127.0.0.1');
  const requestId = ++requestSequence;
  requests.push({
    method,
    url,
    timingClass: resolveMockTimingClassId(timingProfile, method, parsed.pathname),
    plannedDelayMs: resolveMockTimingDelayMs({
      profile: timingProfile,
      method,
      pathname: parsed.pathname,
      requestSequence: requestId,
    }),
  });

  const respond = (handler) => {
    const delayMs = requests.at(-1)?.plannedDelayMs ?? 0;
    setTimeout(handler, delayMs);
  };

  if (method === 'OPTIONS') {
    respond(() => {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
    });
    return;
  }

  if (url.startsWith('/v1/info')) {
    return respond(() => json(res, 200, {
      product: 'C64 Ultimate',
      firmware_version: '3.12.0',
      core_version: '1.0.0',
      hostname: 'mock-c64u',
      unique_id: 'mock-uid',
      errors: [],
    }));
  }

  if (url.startsWith('/v1/version')) {
    return respond(() => json(res, 200, { version: '3.12.0', errors: [] }));
  }

  if (url.startsWith('/v1/configs')) {
    const parts = url.split('/').filter(Boolean);
    if (parts.length === 2) {
      return respond(() => json(res, 200, { categories, errors: [] }));
    }
    if (parts.length >= 3) {
      const category = decodeURIComponent(parts[2]);
      const config = configs[category] ?? {};
      if (parts.length >= 4) {
        const item = decodeURIComponent(parts[3]);
        const entry = config && config[item] ? { [item]: config[item] } : {};
        return respond(() => json(res, 200, { [category]: entry, errors: [] }));
      }
      return respond(() => json(res, 200, { [category]: config, errors: [] }));
    }
  }

  if (url.startsWith('/v1/drives')) {
    return respond(() => json(res, 200, {
      drives: [{ a: { enabled: true, bus_id: 8, type: '1541' } }],
      errors: [],
    }));
  }

  return respond(() => json(res, 200, { errors: [] }));
});

const startServer = async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'string' ? 0 : (address?.port ?? 0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const hostForEmulator = `10.0.2.2:${port}`;

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(
    outPath,
    JSON.stringify({ baseUrl, hostForEmulator, requests }, null, 2),
  );
  process.stdout.write(`External mock server running at ${baseUrl}\n`);
};

const shutdown = async () => {
  await new Promise((resolve) => server.close(() => resolve()));
  process.exit(0);
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

startServer().catch((error) => {
  console.error(error);
  process.exit(1);
});

process.stdin.resume();
