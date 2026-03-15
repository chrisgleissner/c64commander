// @vitest-environment node
import os from "node:os";
import path from "node:path";
import { promises as fs } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStaticAssetServer } from "../../../web/server/src/staticAssets";

const createResponse = () => {
  const headers = new Map<string, string>();
  return {
    statusCode: 0,
    setHeader: vi.fn((key: string, value: string) => headers.set(key, value)),
    writeHead: vi.fn((status: number, nextHeaders: Record<string, string>) => {
      Object.entries(nextHeaders).forEach(([key, value]) => headers.set(key, value));
    }),
    end: vi.fn(),
    headers,
  };
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("staticAssets", () => {
  it("serves files, directories, SPA fallback, and cache-control variants", async () => {
    const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "c64-static-"));
    tempDirs.push(distDir);
    await fs.mkdir(path.join(distDir, "nested"), { recursive: true });
    await fs.mkdir(path.join(distDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), "<html>root</html>");
    await fs.writeFile(path.join(distDir, "nested", "index.html"), "<html>nested</html>");
    await fs.writeFile(path.join(distDir, "sw.js"), "console.log('sw')");
    await fs.writeFile(path.join(distDir, "assets", "main-12345678.js"), "console.log('asset')");

    const logError = vi.fn();
    const server = createStaticAssetServer({ distDir, logError, errorDetails: () => ({ cause: "test" }) });

    const rootRes = createResponse();
    await server.serveStatic(rootRes as any, "/");
    expect(rootRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Cache-Control": "no-store", "Content-Type": "text/html; charset=utf-8" }),
    );

    const directoryRes = createResponse();
    await server.serveStatic(directoryRes as any, "/nested");
    expect(directoryRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }),
    );

    const swRes = createResponse();
    await server.serveStatic(swRes as any, "/sw.js");
    expect(swRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Cache-Control": "no-cache", "Content-Type": "application/javascript; charset=utf-8" }),
    );

    const assetRes = createResponse();
    await server.serveStatic(assetRes as any, "/assets/main-12345678.js");
    expect(assetRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Cache-Control": "public, max-age=31536000, immutable" }),
    );

    const spaRes = createResponse();
    await server.serveStatic(spaRes as any, "/missing-route");
    expect(spaRes.writeHead).toHaveBeenCalledWith(
      200,
      expect.objectContaining({ "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" }),
    );

    expect(server.loginHtml()).toContain("Invalid password");
    expect(logError).not.toHaveBeenCalled();
  });

  it("rejects invalid paths, bad encodings, and missing dist bundles", async () => {
    const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "c64-static-"));
    tempDirs.push(distDir);
    await fs.writeFile(path.join(distDir, "index.html"), "<html>root</html>");

    const logError = vi.fn();
    const server = createStaticAssetServer({ distDir, logError, errorDetails: () => ({ cause: "test" }) });

    const badEncodingRes = createResponse();
    await server.serveStatic(badEncodingRes as any, "/%E0%A4%A");
    expect(badEncodingRes.writeHead).toHaveBeenCalledWith(
      400,
      expect.objectContaining({ "Content-Type": "application/json; charset=utf-8" }),
    );

    const parentRes = createResponse();
    await server.serveStatic(parentRes as any, "/../secret.txt");
    expect(parentRes.writeHead).toHaveBeenCalledWith(
      403,
      expect.objectContaining({ "Content-Type": "application/json; charset=utf-8" }),
    );

    await fs.rm(path.join(distDir, "index.html"));
    const missingIndexRes = createResponse();
    await server.serveStatic(missingIndexRes as any, "/missing-route");
    expect(missingIndexRes.writeHead).toHaveBeenCalledWith(
      500,
      expect.objectContaining({ "Content-Type": "application/json; charset=utf-8" }),
    );
    expect(logError).toHaveBeenCalled();
  });

  it("serves the supported static asset content types", async () => {
    const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "c64-static-types-"));
    tempDirs.push(distDir);
    await fs.mkdir(path.join(distDir, "assets"), { recursive: true });
    await fs.writeFile(path.join(distDir, "index.html"), "<html>root</html>");

    const fixtures = [
      { name: "styles.css", body: "body{}", contentType: "text/css; charset=utf-8" },
      { name: "config.json", body: '{"ok":true}', contentType: "application/json; charset=utf-8" },
      { name: "icon.svg", body: "<svg />", contentType: "image/svg+xml" },
      { name: "preview.png", body: Buffer.from([0x89, 0x50, 0x4e, 0x47]), contentType: "image/png" },
      { name: "photo.jpeg", body: Buffer.from([0xff, 0xd8, 0xff]), contentType: "image/jpeg" },
      { name: "clip.webm", body: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]), contentType: "video/webm" },
      { name: "font.woff2", body: Buffer.from([0x77, 0x4f, 0x46, 0x32]), contentType: "font/woff2" },
      { name: "blob.bin", body: Buffer.from([0x00, 0x01, 0x02]), contentType: "application/octet-stream" },
    ] as const;

    await Promise.all(fixtures.map(({ name, body }) => fs.writeFile(path.join(distDir, name), body)));

    const logError = vi.fn();
    const server = createStaticAssetServer({ distDir, logError, errorDetails: () => ({ cause: "test" }) });

    for (const fixture of fixtures) {
      const res = createResponse();
      await server.serveStatic(res as any, `/${fixture.name}`);
      expect(res.writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({
          "Cache-Control": "public, max-age=3600",
          "Content-Type": fixture.contentType,
        }),
      );
    }

    expect(logError).not.toHaveBeenCalled();
  });

  it("reports non-ENOENT static asset failures as server errors", async () => {
    const distDir = await fs.mkdtemp(path.join(os.tmpdir(), "c64-static-error-"));
    tempDirs.push(distDir);
    await fs.writeFile(path.join(distDir, "index.html"), "<html>root</html>");
    await fs.writeFile(path.join(distDir, "locked.txt"), "secret");

    const logError = vi.fn();
    const server = createStaticAssetServer({ distDir, logError, errorDetails: () => ({ cause: "test" }) });
    const statSpy = vi
      .spyOn(fs, "stat")
      .mockRejectedValueOnce(Object.assign(new Error("permission denied"), { code: "EACCES" }));

    const res = createResponse();
    await server.serveStatic(res as any, "/locked.txt");

    expect(res.writeHead).toHaveBeenCalledWith(
      500,
      expect.objectContaining({ "Content-Type": "application/json; charset=utf-8" }),
    );
    expect(logError).toHaveBeenCalledWith(
      "Static file serve failed",
      expect.objectContaining({
        cause: "test",
        errorCode: "EACCES",
        requestPath: "/locked.txt",
      }),
    );

    statSpy.mockRestore();
  });
});
