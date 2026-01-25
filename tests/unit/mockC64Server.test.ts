import http from 'node:http';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createMockC64Server } from '../mocks/mockC64Server';

type RequestOptions = {
  method?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
};

type JsonResponse = {
  status: number;
  json: any;
  headers: Record<string, string | string[] | undefined>;
};

const requestJsonViaHttp = (url: string, options: RequestOptions = {}): Promise<JsonResponse> =>
  new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method: options.method ?? 'GET',
        headers: options.headers,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          let json: any = null;
          if (body) {
            try {
              json = JSON.parse(body);
            } catch {
              json = body;
            }
          }
          resolve({
            status: res.statusCode ?? 0,
            json,
            headers: res.headers,
          });
        });
      },
    );
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });

const requestJson = async (url: string, options: RequestOptions = {}): Promise<JsonResponse> => {
  if (typeof fetch === 'function') {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
    });
    const text = await response.text();
    const json = text ? JSON.parse(text) : null;
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });
    return { status: response.status, json, headers };
  }
  return requestJsonViaHttp(url, options);
};

describe('createMockC64Server', () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  beforeEach(async () => {
    server = await createMockC64Server(
      {
        Audio: {
          Volume: '0 dB',
          Mode: { value: 'Auto', options: ['Auto', 'Manual'] },
        },
      },
      {
        Audio: {
          Volume: { options: ['0 dB', '6 dB'], details: { min: 0, max: 10 } },
        },
      },
    );
  });

  afterEach(async () => {
    await server.close();
  });

  it('responds to info and version endpoints', async () => {
    const info = await requestJson(`${server.baseUrl}/v1/info`);
    expect(info.status).toBe(200);
    expect(info.json.product).toBe('C64 Ultimate');

    const version = await requestJson(`${server.baseUrl}/v1/version`);
    expect(version.json.version).toBe('3.12.0');
  });

  it('handles config reads and writes', async () => {
    const list = await requestJson(`${server.baseUrl}/v1/configs`);
    expect(list.json.categories).toContain('Audio');

    const category = await requestJson(`${server.baseUrl}/v1/configs/Audio`);
    expect(category.json.Audio.items.Volume.selected).toBe('0 dB');
    expect(category.json.Audio.items.Volume.details.min).toBe(0);

    const update = await requestJson(`${server.baseUrl}/v1/configs/Audio/Volume?value=6`, { method: 'PUT' });
    expect(update.status).toBe(200);

    const item = await requestJson(`${server.baseUrl}/v1/configs/Audio/Volume`);
    expect(item.json.Audio.items.Volume.selected).toBe('6');

    const post = await requestJson(`${server.baseUrl}/v1/configs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ Audio: { Volume: '3' } }),
    });
    expect(post.status).toBe(200);

    const updated = await requestJson(`${server.baseUrl}/v1/configs/Audio/Volume`);
    expect(updated.json.Audio.items.Volume.selected).toBe('3');

    await requestJson(`${server.baseUrl}/v1/configs:reset_to_default`, { method: 'PUT' });
    const reset = await requestJson(`${server.baseUrl}/v1/configs/Audio/Volume`);
    expect(reset.json.Audio.items.Volume.selected).toBe('0 dB');
  });

  it('manages drives and mounts', async () => {
    const drives = await requestJson(`${server.baseUrl}/v1/drives`);
    expect(drives.json.drives[0].a.enabled).toBe(true);

    await requestJson(`${server.baseUrl}/v1/drives/a:off`, { method: 'PUT' });
    const off = await requestJson(`${server.baseUrl}/v1/drives`);
    expect(off.json.drives[0].a.enabled).toBe(false);

    await requestJson(`${server.baseUrl}/v1/drives/a:on`, { method: 'PUT' });
    await requestJson(`${server.baseUrl}/v1/drives/a:mount?image=disks/demo.d64`, { method: 'PUT' });
    const mounted = await requestJson(`${server.baseUrl}/v1/drives`);
    expect(mounted.json.drives[0].a.image_file).toBe('demo.d64');
    expect(mounted.json.drives[0].a.image_path).toBe('/disks');

    await requestJson(`${server.baseUrl}/v1/drives/a:remove`, { method: 'PUT' });
    const removed = await requestJson(`${server.baseUrl}/v1/drives`);
    expect(removed.json.drives[0].a.image_file).toBeUndefined();

    await requestJson(`${server.baseUrl}/v1/drives/b:mount`, { method: 'POST' });
    const upload = await requestJson(`${server.baseUrl}/v1/drives`);
    expect(upload.json.drives[1].b.image_file).toBe('upload.d64');
  });

  it('records sidplay requests and memory reads', async () => {
    const body = Buffer.from('sid-data');
    const sidplay = await requestJson(`${server.baseUrl}/v1/runners:sidplay`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body,
    });
    expect(sidplay.status).toBe(200);
    expect(server.sidplayRequests).toHaveLength(1);
    expect(server.sidplayRequests[0].body.toString()).toBe('sid-data');

    const mem = await requestJson(`${server.baseUrl}/v1/machine:readmem?address=00C6&length=2`);
    expect(mem.json.data).toHaveLength(2);
  });

  it('supports preflight requests', async () => {
    const options = await requestJson(`${server.baseUrl}/v1/info`, { method: 'OPTIONS' });
    expect(options.status).toBe(204);
  });

  it('supports reachability toggles', async () => {
    server.setReachable(false);
    const unreachable = await requestJson(`${server.baseUrl}/v1/info`);
    expect(unreachable.status).toBe(503);
    server.setReachable(true);
    const reachable = await requestJson(`${server.baseUrl}/v1/info`);
    expect(reachable.status).toBe(200);
  });

  it('supports authentication failure mode', async () => {
    server.setFaultMode('auth');
    const response = await requestJson(`${server.baseUrl}/v1/info`);
    expect(response.status).toBe(401);
    server.setFaultMode('none');
  });

  it('supports refused connections', async () => {
    server.setFaultMode('refused');
    await expect(requestJsonViaHttp(`${server.baseUrl}/v1/info`)).rejects.toBeTruthy();
    server.setFaultMode('none');
  });

  it('supports slow and timeout response modes', async () => {
    server.setFaultMode('slow');
    server.setLatencyMs(50);
    const slowStart = Date.now();
    await requestJson(`${server.baseUrl}/v1/info`);
    const slowElapsed = Date.now() - slowStart;
    expect(slowElapsed).toBeGreaterThanOrEqual(40);

    server.setFaultMode('timeout');
    server.setLatencyMs(null);
    const timeoutStart = Date.now();
    await requestJson(`${server.baseUrl}/v1/info`);
    const timeoutElapsed = Date.now() - timeoutStart;
    expect(timeoutElapsed).toBeGreaterThanOrEqual(1400);
    expect(timeoutElapsed).toBeLessThan(5000);
    server.setFaultMode('none');
  });
});
