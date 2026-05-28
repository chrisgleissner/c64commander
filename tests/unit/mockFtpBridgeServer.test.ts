import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMockFtpServer, type MockFtpServer } from "../contract/mockFtpServer.js";
import { createMockFtpBridgeServer } from "../mocks/mockFtpBridgeServer";

const ftpServers: MockFtpServer[] = [];
const bridgeServers: Array<Awaited<ReturnType<typeof createMockFtpBridgeServer>>> = [];
const tempDirs: string[] = [];

afterEach(async () => {
  while (bridgeServers.length) {
    const server = bridgeServers.pop();
    if (server) await server.close();
  }
  while (ftpServers.length) {
    const server = ftpServers.pop();
    if (server) await server.close();
  }
  while (tempDirs.length) {
    const tempDir = tempDirs.pop();
    if (tempDir) await rm(tempDir, { recursive: true, force: true });
  }
});

describe("createMockFtpBridgeServer", () => {
  it("supports FTP ping without opening a data transfer route", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "c64-mock-ftp-"));
    tempDirs.push(rootDir);
    const ftpServer = await createMockFtpServer({ rootDir });
    ftpServers.push(ftpServer);
    const bridgeServer = await createMockFtpBridgeServer();
    bridgeServers.push(bridgeServer);

    const response = await fetch(`${bridgeServer.baseUrl}/v1/ftp/ping`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        host: ftpServer.host,
        port: ftpServer.port,
        username: "anonymous",
      }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });
});
