import http from 'http';
import { URL } from 'url';

const DEFAULT_HOST = process.env.C64U_DEVICE_HOST || 'c64u';
const PORT = Number(process.env.C64U_PROXY_PORT || 8787);

const hopByHopHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailers',
  'transfer-encoding',
  'upgrade',
  'host',
]);

const withCors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Password, X-C64U-Host');
};

const readBody = async (req) => {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (!chunks.length) return undefined;
  return Buffer.concat(chunks);
};

const server = http.createServer(async (req, res) => {
  try {
    withCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (!req.url) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing URL' }));
      return;
    }

    const deviceHost = (req.headers['x-c64u-host'] || DEFAULT_HOST).toString();
    const targetUrl = new URL(req.url, `http://${deviceHost}`);

    const body = await readBody(req);
    const outgoingHeaders = {};
    for (const [key, value] of Object.entries(req.headers)) {
      if (hopByHopHeaders.has(key.toLowerCase())) continue;
      if (key.toLowerCase() === 'x-c64u-host') continue;
      outgoingHeaders[key] = value;
    }

    const response = await fetch(targetUrl.toString(), {
      method: req.method,
      headers: outgoingHeaders,
      body: body ? body : undefined,
    });

    response.headers.forEach((value, key) => {
      if (hopByHopHeaders.has(key.toLowerCase())) return;
      res.setHeader(key, value);
    });

    res.statusCode = response.status;
    const responseBody = Buffer.from(await response.arrayBuffer());
    res.end(responseBody);
  } catch (error) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error?.message || 'Proxy error' }));
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`C64U local proxy listening on http://127.0.0.1:${PORT}`);
});
