// @vitest-environment node

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { applySecurityHeaders } from "../../../web/server/src/securityHeaders";

const startHeaderTestServer = async () => {
  const server = createServer((req, res) => {
    applySecurityHeaders(req, res);
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ path: req.url }));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });

  const address = server.address() as AddressInfo;
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
};

const readSecurityHeaders = async (url: string, headers?: HeadersInit) => {
  const response = await fetch(url, { headers });
  return {
    csp: response.headers.get("content-security-policy"),
    frameOptions: response.headers.get("x-frame-options"),
    contentTypeOptions: response.headers.get("x-content-type-options"),
    referrerPolicy: response.headers.get("referrer-policy"),
    hsts: response.headers.get("strict-transport-security"),
  };
};

describe("securityHeaders server integration", () => {
  const servers: Array<ReturnType<typeof createServer>> = [];

  afterEach(async () => {
    await Promise.all(
      servers.map(
        (server) =>
          new Promise<void>((resolve, reject) => {
            server.close((error) => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          }),
      ),
    );
    servers.length = 0;
  });

  it("pins the full production header set for both shell and auth routes", async () => {
    const { server, baseUrl } = await startHeaderTestServer();
    servers.push(server);

    const shellHeaders = await readSecurityHeaders(`${baseUrl}/`, {
      "x-forwarded-proto": "https",
    });
    const authHeaders = await readSecurityHeaders(`${baseUrl}/auth/session`, {
      "x-forwarded-proto": "https",
    });

    const expectedHeaders = {
      csp: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
      frameOptions: "DENY",
      contentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      hsts: "max-age=31536000; includeSubDomains",
    };

    expect(shellHeaders).toEqual(expectedHeaders);
    expect(authHeaders).toEqual(expectedHeaders);
  });

  it("omits HSTS on non-https forwarded requests while preserving the base header matrix", async () => {
    const { server, baseUrl } = await startHeaderTestServer();
    servers.push(server);

    const headers = await readSecurityHeaders(`${baseUrl}/healthz`, {
      "x-forwarded-proto": "http",
    });

    expect(headers).toEqual({
      csp: "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self' data:",
      frameOptions: "DENY",
      contentTypeOptions: "nosniff",
      referrerPolicy: "strict-origin-when-cross-origin",
      hsts: null,
    });
  });
});
