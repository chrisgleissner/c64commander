import http from 'node:http';

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

export const startExternalMockServer = async () => {
  const requests = [];
  const { categories, configs } = buildConfigPayload();

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    requests.push({ method, url });

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
      return;
    }

    if (url.startsWith('/v1/info')) {
      return json(res, 200, {
        product: 'C64 Ultimate',
        firmware_version: '3.12.0',
        core_version: '1.0.0',
        hostname: 'mock-c64u',
        unique_id: 'mock-uid',
        errors: [],
      });
    }

    if (url.startsWith('/v1/version')) {
      return json(res, 200, { version: '3.12.0', errors: [] });
    }

    if (url.startsWith('/v1/configs')) {
      const parts = url.split('/').filter(Boolean);
      if (parts.length === 2) {
        return json(res, 200, { categories, errors: [] });
      }
      if (parts.length >= 3) {
        const category = decodeURIComponent(parts[2]);
        const config = configs[category] ?? {};
        if (parts.length >= 4) {
          const item = decodeURIComponent(parts[3]);
          const entry = (config && config[item]) ? { [item]: config[item] } : {};
          return json(res, 200, { [category]: entry, errors: [] });
        }
        return json(res, 200, { [category]: config, errors: [] });
      }
    }

    if (url.startsWith('/v1/drives')) {
      return json(res, 200, {
        drives: [{ a: { enabled: true, bus_id: 8, type: '1541' } }],
        errors: [],
      });
    }

    return json(res, 200, { errors: [] });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'string' ? 0 : address?.port ?? 0;
  const baseUrl = `http://127.0.0.1:${port}`;
  const hostForEmulator = `10.0.2.2:${port}`;

  return {
    baseUrl,
    hostForEmulator,
    requests,
    close: async () => new Promise((resolve) => server.close(() => resolve())),
  };
};
