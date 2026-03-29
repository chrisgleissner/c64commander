/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DEFAULT_MENU_FIXTURE } from "./lib/telnetTypes.js";
import { createMockFtpServer } from "./mockFtpServer.js";
import { createMockRestServer } from "./mockRestServer.js";
import { createMockTelnetServer } from "./mockTelnetServer.js";

export type ContractMockServers = {
  baseUrl: string;
  ftpPort: number;
  telnetPort: number;
  close: () => Promise<void>;
};

export async function startContractMockServers(options: { password?: string } = {}): Promise<ContractMockServers> {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "c64u-contract-mock-"));
  const scratchDir = path.join(rootDir, "Temp", "contract-test");
  await fs.promises.mkdir(scratchDir, { recursive: true });
  await seedMockFilesystem(rootDir);

  const ftpServer = await createMockFtpServer({
    rootDir,
    password: options.password,
    port: 2121,
    pasvMin: 40210,
    pasvMax: 40280,
  });
  const restServer = await createMockRestServer(readMockRestServerOptionsFromEnv());
  const telnetServer = await createMockTelnetServer({ password: options.password });

  return {
    baseUrl: restServer.baseUrl,
    ftpPort: ftpServer.port,
    telnetPort: telnetServer.port,
    close: async () => {
      await restServer.close();
      await ftpServer.close();
      await telnetServer.close();
    },
  };
}

async function seedMockFilesystem(rootDir: string): Promise<void> {
  for (const [directoryPath, entries] of Object.entries(DEFAULT_MENU_FIXTURE.browser.directories)) {
    const absoluteDirectory = path.join(rootDir, directoryPath.replace(/^\//, ""));
    await fs.promises.mkdir(absoluteDirectory, { recursive: true });
    for (const entry of entries) {
      const absoluteEntryPath = path.join(absoluteDirectory, entry.name);
      if (entry.type === "directory") {
        await fs.promises.mkdir(absoluteEntryPath, { recursive: true });
      } else {
        await fs.promises.mkdir(path.dirname(absoluteEntryPath), { recursive: true });
        await fs.promises.writeFile(absoluteEntryPath, entry.name, "utf8");
      }
    }
  }

  for (const definition of Object.values(DEFAULT_MENU_FIXTURE.filesystemContextMenus.menuDefinitions)) {
    const absoluteEntryPath = path.join(rootDir, definition.representativeFile.replace(/^\//, ""));
    await fs.promises.mkdir(path.dirname(absoluteEntryPath), { recursive: true });
    await fs.promises.writeFile(absoluteEntryPath, path.basename(absoluteEntryPath), "utf8");
  }
}

function readMockRestServerOptionsFromEnv(): Parameters<typeof createMockRestServer>[0] {
  const afterRequestsRaw = process.env.CONTRACT_MOCK_BREAKPOINT_AFTER_REQUESTS;
  if (!afterRequestsRaw) {
    return {};
  }
  const afterRequests = Number.parseInt(afterRequestsRaw, 10);
  return {
    breakpointFailure: {
      afterRequests: Number.isFinite(afterRequests) ? afterRequests : 0,
      mode: process.env.CONTRACT_MOCK_BREAKPOINT_MODE === "hang" ? "hang" : "status",
      status: process.env.CONTRACT_MOCK_BREAKPOINT_STATUS
        ? Number.parseInt(process.env.CONTRACT_MOCK_BREAKPOINT_STATUS, 10)
        : 503,
      methods: process.env.CONTRACT_MOCK_BREAKPOINT_METHODS
        ? process.env.CONTRACT_MOCK_BREAKPOINT_METHODS.split(",")
            .map((value) => value.trim())
            .filter(Boolean)
        : undefined,
      pathIncludes: process.env.CONTRACT_MOCK_BREAKPOINT_PATH_INCLUDES,
    },
  };
}
