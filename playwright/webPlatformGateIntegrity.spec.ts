/**
 * `webPlatformAuth.spec.ts` used to answer a missing web-platform API with `test.skip`. Run against
 * the default `vite preview` server it reported "4 skipped, 1 passed" and exit code 0, so the whole
 * auth and REST-proxy contract could regress without turning the `web` workflow red.
 *
 * These cases pin the replacement: the probe rejects for a server that is not the web-platform
 * server, and accepts only one that answers `/auth/status` with the documented JSON.
 */

import { test, expect } from "@playwright/test";
import http from "node:http";
import type { AddressInfo } from "node:net";

import { describeWebPlatformApi, requireWebPlatformApi, type ProbeGet } from "./webPlatformApi";

type Handler = (pathname: string) => { status: number; contentType: string; body: string };

const withServer = async (handler: Handler, run: (get: ProbeGet) => Promise<void>): Promise<void> => {
  const server = http.createServer((req, res) => {
    const { status, contentType, body } = handler(new URL(req.url ?? "/", "http://localhost").pathname);
    res.writeHead(status, { "Content-Type": contentType });
    res.end(body);
  });
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const port = (server.address() as AddressInfo).port;

  const get: ProbeGet = async (url: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${url}`);
    return {
      status: () => response.status,
      headers: () => ({ "content-type": response.headers.get("content-type") ?? "" }),
      json: () => response.json(),
    };
  };

  try {
    await run(get);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
};

/** What `vite preview` does: every unknown path is the SPA shell with a 200. */
const spaFallback: Handler = () => ({
  status: 200,
  contentType: "text/html",
  body: '<!doctype html><html><body><div id="root"></div></body></html>',
});

const webPlatform: Handler = (pathname) =>
  pathname === "/auth/status"
    ? {
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ requiresLogin: false, authenticated: true }),
      }
    : { status: 404, contentType: "application/json", body: JSON.stringify({ error: "not found" }) };

test.describe("web-platform API gate integrity", () => {
  test("a static preview server is rejected rather than skipped", async () => {
    await withServer(spaFallback, async (get) => {
      const problem = await describeWebPlatformApi(get);
      expect(problem).toContain("content-type");
      await expect(requireWebPlatformApi(get)).rejects.toThrow(/Web platform API is not serving/);
    });
  });

  test("a non-200 /auth/status is rejected", async () => {
    await withServer(
      () => ({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "down" }) }),
      async (get) => {
        expect(await describeWebPlatformApi(get)).toContain("answered 503");
        await expect(requireWebPlatformApi(get)).rejects.toThrow(/Web platform API is not serving/);
      },
    );
  });

  test("JSON without the documented fields is rejected", async () => {
    await withServer(
      () => ({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true }) }),
      async (get) => {
        expect(await describeWebPlatformApi(get)).toContain("expected boolean requiresLogin");
        await expect(requireWebPlatformApi(get)).rejects.toThrow(/Web platform API is not serving/);
      },
    );
  });

  test("an unreachable server is rejected", async () => {
    const get: ProbeGet = () => Promise.reject(new Error("ECONNREFUSED"));
    expect(await describeWebPlatformApi(get)).toContain("could not be reached");
    await expect(requireWebPlatformApi(get)).rejects.toThrow(/Web platform API is not serving/);
  });

  test("the web-platform server is accepted", async () => {
    await withServer(webPlatform, async (get) => {
      expect(await describeWebPlatformApi(get)).toBeNull();
      await expect(requireWebPlatformApi(get)).resolves.toBeUndefined();
    });
  });
});
