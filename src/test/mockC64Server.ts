import http from 'node:http';

export interface MockC64Server {
  baseUrl: string;
  close: () => Promise<void>;
  requests: Array<{ method: string; url: string }>;
}

type CategoryState = Record<string, Record<string, string | number>>;

type ItemDetails = {
  options?: string[];
};

type ItemDetailsState = Record<string, Record<string, ItemDetails>>;

export function createMockC64Server(
  initial: CategoryState,
  itemDetails: ItemDetailsState = {},
): Promise<MockC64Server> {
  const requests: Array<{ method: string; url: string }> = [];
  const state: CategoryState = JSON.parse(JSON.stringify(initial));

  const server = http.createServer((req, res) => {
    const method = req.method ?? 'GET';
    const url = req.url ?? '/';
    requests.push({ method, url });

    const parsed = new URL(url, 'http://127.0.0.1');

    const sendJson = (status: number, body: any) => {
      res.statusCode = status;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };

    if (method === 'GET' && parsed.pathname === '/v1/configs') {
      return sendJson(200, { categories: Object.keys(state), errors: [] });
    }

    const catMatch = parsed.pathname.match(/^\/v1\/configs\/([^/]+)$/);
    if (method === 'GET' && catMatch) {
      const category = decodeURIComponent(catMatch[1]);
      const items = state[category] ?? {};
      return sendJson(200, { [category]: items, errors: [] });
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
        state[category][item] = value;
        return sendJson(200, { errors: [] });
      }

      if (method === 'GET') {
        const current = state[category]?.[item];
        const details = itemDetails?.[category]?.[item];
        return sendJson(200, {
          [category]: {
            items: {
              [item]: {
                selected: current ?? '',
                options: details?.options ?? [],
              },
            },
          },
          errors: [],
        });
      }
    }

    return sendJson(404, { errors: ['Not found'] });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') throw new Error('Unexpected server address');
      const baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve({
        baseUrl,
        requests,
        close: () =>
          new Promise<void>((resClose) => {
            server.close(() => resClose());
          }),
      });
    });
  });
}

