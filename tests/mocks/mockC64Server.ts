import * as http from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { getMockConfigPayload, setMockConfigLoader } from '../../src/lib/mock/mockConfig.js';
import { loadConfigYaml } from '../../src/lib/mock/mockConfigLoader.node.js';

// Set the full YAML loader for tests
setMockConfigLoader(loadConfigYaml);

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
  setReachable: (reachable: boolean) => void;
  setFaultMode: (mode: FaultMode) => void;
  setLatencyMs: (ms: number | null) => void;
  isReachable: () => boolean;
  getFaultMode: () => FaultMode;
}

export type FaultMode = 'none' | 'timeout' | 'refused' | 'auth' | 'slow';

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

/**
 * Convert the mock config payload from YAML into the internal state format
 */
const buildStateFromYaml = async (): Promise<CategoryState> => {
  const payload = await getMockConfigPayload();
  const state: CategoryState = {};

  Object.entries(payload.categories).forEach(([categoryName, items]) => {
    state[categoryName] = {};
    Object.entries(items).forEach(([itemName, item]) => {
      state[categoryName][itemName] = {
        value: item.value,
        options: item.options,
        details: item.details,
      };
    });
  });

  return state;
};

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

export async function createMockC64Server(
  initial: Record<string, Record<string, string | number | ConfigItemState>> = {},
  itemDetails: ItemDetailsState = {},
): Promise<MockC64Server> {
  const requests: Array<{ method: string; url: string }> = [];
  const sidplayRequests: Array<{
    method: string;
    url: string;
    headers: Record<string, string | string[] | undefined>;
    body: Buffer;
  }> = [];
  let reachable = true;
  let faultMode: FaultMode = 'none';
  let latencyMs: number | null = null;
  let responseQueue = Promise.resolve();
  
  // Use YAML as source of truth if no initial state provided
  const yamlState = Object.keys(initial).length === 0 ? await buildStateFromYaml() : {};
  const defaults = Object.keys(initial).length === 0 ? yamlState : normalizeInitialState(initial);
  let state: CategoryState = clone(defaults);
  const driveState: Record<
    'a' | 'b' | 'softiec' | 'printer',
    {
      enabled: boolean;
      bus_id: number;
      type?: string;
      image_file?: string;
      image_path?: string;
      last_error?: string;
      partitions?: Array<{ id: number; path: string }>;
    }
  > = {
    a: { enabled: true, bus_id: 8, type: '1541' },
    b: { enabled: true, bus_id: 9, type: '1541' },
    softiec: {
      enabled: false,
      bus_id: 11,
      type: 'DOS emulation',
      last_error: '73,U64IEC ULTIMATE DOS V1.1,00,00',
      partitions: [{ id: 0, path: '/USB0/' }],
    },
    printer: { enabled: false, bus_id: 4 },
  };

  const toDriveStateKey = (value: string): keyof typeof driveState | null => {
    const normalized = decodeURIComponent(value).trim().toLowerCase();
    if (normalized === 'a' || normalized === 'b' || normalized === 'softiec' || normalized === 'printer') {
      return normalized;
    }
    if (normalized === 'iec drive' || normalized === 'soft iec drive') return 'softiec';
    if (normalized === 'printer emulation') return 'printer';
    return null;
  };

  const parseEnabledValue = (value: unknown) => String(value ?? '').trim().toLowerCase() === 'enabled';
  const parseNumericValue = (value: unknown) => {
    const numeric = Number(String(value ?? '').trim());
    return Number.isFinite(numeric) ? numeric : null;
  };

  const syncDriveStateFromConfig = (category: string, item: string, value: unknown) => {
    if (category === 'Drive A Settings') {
      if (item === 'Drive') driveState.a.enabled = parseEnabledValue(value);
      if (item === 'Drive Bus ID') {
        const numeric = parseNumericValue(value);
        if (numeric !== null) driveState.a.bus_id = numeric;
      }
      if (item === 'Drive Type') driveState.a.type = String(value);
    }
    if (category === 'Drive B Settings') {
      if (item === 'Drive') driveState.b.enabled = parseEnabledValue(value);
      if (item === 'Drive Bus ID') {
        const numeric = parseNumericValue(value);
        if (numeric !== null) driveState.b.bus_id = numeric;
      }
      if (item === 'Drive Type') driveState.b.type = String(value);
    }
    if (category === 'SoftIEC Drive Settings') {
      if (item === 'IEC Drive') driveState.softiec.enabled = parseEnabledValue(value);
      if (item === 'Soft Drive Bus ID') {
        const numeric = parseNumericValue(value);
        if (numeric !== null) driveState.softiec.bus_id = numeric;
      }
    }
    if (category === 'Printer Settings') {
      if (item === 'IEC printer') driveState.printer.enabled = parseEnabledValue(value);
      if (item === 'Bus ID') {
        const numeric = parseNumericValue(value);
        if (numeric !== null) driveState.printer.bus_id = numeric;
      }
    }
  };

  const syncAllDriveStateFromConfig = () => {
    const pairs: Array<[string, string]> = [
      ['Drive A Settings', 'Drive'],
      ['Drive A Settings', 'Drive Bus ID'],
      ['Drive A Settings', 'Drive Type'],
      ['Drive B Settings', 'Drive'],
      ['Drive B Settings', 'Drive Bus ID'],
      ['Drive B Settings', 'Drive Type'],
      ['SoftIEC Drive Settings', 'IEC Drive'],
      ['SoftIEC Drive Settings', 'Soft Drive Bus ID'],
      ['Printer Settings', 'IEC printer'],
      ['Printer Settings', 'Bus ID'],
    ];
    pairs.forEach(([category, item]) => {
      const value = state[category]?.[item]?.value;
      if (value === undefined) return;
      syncDriveStateFromConfig(category, item, value);
    });
  };

  syncAllDriveStateFromConfig();
  const sockets = new Set<import('node:net').Socket>();

  const server = http.createServer((req: IncomingMessage, res: ServerResponse) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    requests.push({ method, url });

    const parsed = new URL(url, 'http://127.0.0.1');

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    const respond = (handler: () => void) => {
      if (faultMode === 'refused') {
        req.socket.destroy();
        return;
      }
      const timeoutDelayMs = Math.max(latencyMs ?? 0, 1500);
      const delayMs = faultMode === 'timeout' ? timeoutDelayMs : faultMode === 'slow' ? latencyMs ?? 300 : latencyMs ?? 0;
      responseQueue = responseQueue.then(() => new Promise<void>((resolve) => {
        const run = () => {
          if (!res.writableEnded) {
            handler();
          }
          resolve();
        };
        if (delayMs > 0) {
          setTimeout(run, delayMs);
        } else {
          run();
        }
      }));
    };

    const sendJson = (status: number, body: any) => {
      respond(() => {
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json');
        Object.entries(corsHeaders).forEach(([key, value]) => res.setHeader(key, value));
        res.end(JSON.stringify(body));
      });
    };

    if (method === 'OPTIONS') {
      res.writeHead(204, corsHeaders);
      res.end();
      return;
    }

    if (!reachable) {
      return sendJson(503, { errors: ['Device unreachable'] });
    }

    if (faultMode === 'auth') {
      return sendJson(401, { errors: ['Unauthorized'] });
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
          { a: { ...driveState.a } },
          { b: { ...driveState.b } },
          { 'IEC Drive': { ...driveState.softiec } },
          {
            'Printer Emulation': {
              enabled: driveState.printer.enabled,
              bus_id: driveState.printer.bus_id,
            },
          },
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
        '/v1/configs:save_to_flash',
        '/v1/configs:load_from_flash',
        '/v1/configs:reset_to_default',
      ].includes(parsed.pathname)
    ) {
      if (parsed.pathname === '/v1/configs:reset_to_default') {
        state = clone(defaults);
        syncAllDriveStateFromConfig();
      }
      return sendJson(200, { errors: [] });
    }

    const drivePowerOrResetMatch = parsed.pathname.match(/^\/v1\/drives\/([^/]+):(on|off|reset)$/);
    if (method === 'PUT' && drivePowerOrResetMatch) {
      const driveKey = toDriveStateKey(drivePowerOrResetMatch[1]);
      if (!driveKey) {
        return sendJson(404, { errors: ['Drive not found'] });
      }
      const action = drivePowerOrResetMatch[2];
      if (action === 'on') {
        driveState[driveKey].enabled = true;
      }
      if (action === 'off') {
        driveState[driveKey].enabled = false;
      }
      if (action === 'reset' && driveKey === 'softiec') {
        delete driveState.softiec.last_error;
      }
      return sendJson(200, { errors: [] });
    }

    if (method === 'PUT' && parsed.pathname.match(/^\/v1\/drives\/[ab]:set_mode$/)) {
      const driveKey = parsed.pathname.includes('/a:') ? 'a' : 'b';
      const mode = parsed.searchParams.get('mode');
      if (mode) {
        driveState[driveKey].type = mode;
      }
      return sendJson(200, { errors: [] });
    }

    const driveMountMatch = parsed.pathname.match(/^\/v1\/drives\/([ab]):mount$/);
    if (driveMountMatch && (method === 'PUT' || method === 'POST')) {
      const driveKey = driveMountMatch[1] as 'a' | 'b';
      if (method === 'PUT') {
        const image = parsed.searchParams.get('image');
        if (!image) return sendJson(400, { errors: ['Missing image'] });
        const normalized = image.startsWith('/') ? image : `/${image}`;
        const parts = normalized.split('/').filter(Boolean);
        driveState[driveKey].image_file = parts[parts.length - 1];
        driveState[driveKey].image_path = parts.length > 1 ? `/${parts.slice(0, -1).join('/')}` : '/';
      } else {
        driveState[driveKey].image_file = 'upload.d64';
        driveState[driveKey].image_path = '/';
      }
      return sendJson(200, { errors: [] });
    }

    const driveRemoveMatch = parsed.pathname.match(/^\/v1\/drives\/([ab]):remove$/);
    if (driveRemoveMatch && method === 'PUT') {
      const driveKey = driveRemoveMatch[1] as 'a' | 'b';
      delete driveState[driveKey].image_file;
      delete driveState[driveKey].image_path;
      return sendJson(200, { errors: [] });
    }

    if (parsed.pathname === '/v1/runners:sidplay' && (method === 'POST' || method === 'PUT')) {
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
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
      req.on('data', (chunk: Buffer) => {
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
              syncDriveStateFromConfig(category, item, value);
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
        syncDriveStateFromConfig(category, item, value);
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

    const streamMatch = parsed.pathname.match(/^\/v1\/streams\/([^/]+):(start|stop)$/);
    if (method === 'PUT' && streamMatch) {
      return sendJson(200, { errors: [] });
    }

    return sendJson(404, { errors: ['Not found'] });
  });

  server.on('connection', (socket: import('node:net').Socket) => {
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
        setReachable: (next) => {
          reachable = next;
        },
        setFaultMode: (mode) => {
          faultMode = mode;
        },
        setLatencyMs: (ms) => {
          latencyMs = ms;
        },
        isReachable: () => reachable,
        getFaultMode: () => faultMode,
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
