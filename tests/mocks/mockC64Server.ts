import http from 'node:http';

export interface MockC64Server {
  baseUrl: string;
  close: () => Promise<void>;
  requests: Array<{ method: string; url: string }>;
  sidplayRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }>;
  getState: () => CategoryState;
  resetState: () => void;
}

export type ConfigItemState = {
  value: string | number;
  options?: string[];
  details?: {
    min?: number;
    max?: number;
    format?: string;
    presets?: string[];
  };
};

export type CategoryState = Record<string, Record<string, ConfigItemState>>;

export type ItemDetails = {
  options?: string[];
  details?: {
    min?: number;
    max?: number;
    format?: string;
    presets?: string[];
  };
};

export type ItemDetailsState = Record<string, Record<string, ItemDetails>>;

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const normalizeInitialState = (initial: Record<string, Record<string, string | number | ConfigItemState>>) => {
  const normalized: CategoryState = {};
  Object.entries(initial).forEach(([category, items]) => {
    const nextItems: Record<string, ConfigItemState> = {};
    Object.entries(items).forEach(([name, entry]) => {
      if (typeof entry === 'object' && entry !== null && 'value' in entry) {
        nextItems[name] = entry as ConfigItemState;
      } else {
        nextItems[name] = { value: entry as string | number };
      }
    });
    normalized[category] = nextItems;
  });
  return normalized;
};

export function createMockC64Server(
  initial: Record<string, Record<string, string | number | ConfigItemState>>,
  itemDetails: ItemDetailsState = {},
): Promise<MockC64Server> {
  const requests: Array<{ method: string; url: string }> = [];
  const sidplayRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }> = [];
  const defaults = normalizeInitialState(initial);
  let state: CategoryState = clone(defaults);
  const sockets = new Set<import('node:net').Socket>();

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    requests.push({ method, url });

    const parsed = new URL(url, 'http://127.0.0.1');

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    const sendJson = (status: number, body: any) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
      res.end(JSON.stringify(body));
    };

    if (method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (method === 'GET' && parsed.pathname === '/v1/info') {
      return sendJson(200, {
        product: 'C64 Ultimate',
        firmware_version: '3.12.0',
        fpga_version: '1.0.0',
        core_version: '1.0.0',
        hostname: 'c64u',
        unique_id: 'TEST-123',
        errors: [],
      });
    }

    if (method === 'GET' && parsed.pathname === '/v1/version') {
      return sendJson(200, { version: '3.12.0', errors: [] });
    }

    if (method === 'GET' && parsed.pathname === '/v1/drives') {
      return sendJson(200, {
        drives: [
          { a: { enabled: true, bus_id: 8, type: '1541', image_file: 'demo.d64' } },
          { b: { enabled: false, bus_id: 9, type: '1541' } },
        ],
        errors: [],
      });
    }

    if (
      method === 'PUT' &&
      [
        '/v1/machine:reset',
        '/v1/machine:reboot',
        '/v1/machine:pause',
        '/v1/machine:resume',
        '/v1/machine:poweroff',
        '/v1/machine:menu_button',
        '/v1/drives/a:off',
        '/v1/drives/b:off',
        '/v1/configs:save_to_flash',
        '/v1/configs:load_from_flash',
        '/v1/configs:reset_to_default',
      ].includes(parsed.pathname)
    ) {
      if (parsed.pathname === '/v1/configs:reset_to_default') {
        state = clone(defaults);
      }
      return sendJson(200, { errors: [] });
    }

    if (method === 'PUT' && parsed.pathname.match(/^\/v1\/drives\/[ab]:set_mode$/)) {
      return sendJson(200, { errors: [] });
    }

    if (parsed.pathname === '/v1/runners:sidplay' && (method === 'POST' || method === 'PUT')) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      req.on('end', () => {
        sidplayRequests.push({
          method,
          url,
          headers: req.headers as Record<string, string | string[] | undefined>,
          body: Buffer.concat(chunks),
        });
        sendJson(200, { errors: [] });
      });
      return;
    }

    if (
      ['/v1/runners:modplay', '/v1/runners:load_prg', '/v1/runners:run_prg', '/v1/runners:run_crt'].includes(
        parsed.pathname,
      ) &&
      (method === 'POST' || method === 'PUT')
    ) {
      return sendJson(200, { errors: [] });
    }

    if (parsed.pathname.match(/^\/v1\/drives\/[ab]:mount$/) && (method === 'POST' || method === 'PUT')) {
      return sendJson(200, { errors: [] });
    }

    if (parsed.pathname === '/v1/machine:writemem' && (method === 'POST' || method === 'PUT')) {
      return sendJson(200, { errors: [] });
    }

    if (parsed.pathname === '/v1/machine:readmem' && method === 'GET') {
      const length = Number(parsed.searchParams.get('length') || '1');
      const address = (parsed.searchParams.get('address') || '').toUpperCase();
      const data = new Array(Math.max(1, length)).fill(0);
      if (address === '00C6') {
        data[0] = 0;
      }
      return sendJson(200, { data, errors: [] });
    }

    if (method === 'GET' && parsed.pathname === '/v1/configs') {
      return sendJson(200, { categories: Object.keys(state), errors: [] });
    }

    if (method === 'POST' && parsed.pathname === '/v1/configs') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });
      req.on('end', () => {
        try {
          const payload = body ? (JSON.parse(body) as Record<string, Record<string, string | number>>) : {};
          Object.entries(payload).forEach(([category, items]) => {
            if (!state[category]) state[category] = {};
            Object.entries(items).forEach(([item, value]) => {
              const current = state[category][item] ?? { value };
              state[category][item] = { ...current, value };
            });
          });
          sendJson(200, { errors: [] });
        } catch (error) {
          sendJson(400, { errors: [(error as Error).message] });
        }
      });
      return;
    }

    const catMatch = parsed.pathname.match(/^\/v1\/configs\/([^/]+)$/);
    if (method === 'GET' && catMatch) {
      const category = decodeURIComponent(catMatch[1]);
      const items = state[category] ?? {};
      const details = itemDetails?.[category] ?? {};
      const payloadItems: Record<string, any> = {};
      Object.entries(items).forEach(([name, entry]) => {
        const itemDetail = details?.[name];
        payloadItems[name] = {
          selected: entry.value,
          options: entry.options ?? itemDetail?.options ?? [],
          details: entry.details ?? itemDetail?.details ?? undefined,
        };
      });
      return sendJson(200, { [category]: { items: payloadItems }, errors: [] });
    }

    const itemMatch = parsed.pathname.match(/^\/v1\/configs\/([^/]+)\/([^/]+)$/);
    if (itemMatch) {
      const category = decodeURIComponent(itemMatch[1]);
      const item = decodeURIComponent(itemMatch[2]);

      if (method === 'PUT') {
        const value = parsed.searchParams.get('value');
        if (value === null) {
          return sendJson(400, { errors: ['Missing value'] });
        }
        if (!state[category]) state[category] = {};
        const current = state[category][item] ?? { value };
        state[category][item] = { ...current, value };
        return sendJson(200, { errors: [] });
      }

      if (method === 'GET') {
        const current = state[category]?.[item];
        const details = itemDetails?.[category]?.[item];
        return sendJson(200, {
          [category]: {
            items: {
              [item]: {
                selected: current?.value ?? '',
                options: current?.options ?? details?.options ?? [],
                details: current?.details ?? details?.details ?? undefined,
              },
            },
          },
          errors: [],
        });
      }
    }

    return sendJson(404, { errors: ['Not found'] });
  });

  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Unexpected server address');
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        requests,
        sidplayRequests,
        getState: () => clone(state),
        resetState: () => {
          state = clone(defaults);
        },
        close: () =>
          new Promise<void>((resClose) => {
            if (!server.listening) {
              resClose();
              return;
            }
            sockets.forEach((socket) => socket.destroy());
            server.close(() => resClose());
          }),
      });
    });
  });
}
