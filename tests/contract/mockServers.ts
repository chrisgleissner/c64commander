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
import { createMockFtpServer } from "./mockFtpServer.js";
import { createMockRestServer } from "./mockRestServer.js";

export type ContractMockServers = {
  baseUrl: string;
  ftpPort: number;
  close: () => Promise<void>;
};

export async function startContractMockServers(): Promise<ContractMockServers> {
  const rootDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "c64u-contract-mock-"));
  const scratchDir = path.join(rootDir, "Temp", "contract-test");
  await fs.promises.mkdir(scratchDir, { recursive: true });

  const ftpServer = await createMockFtpServer({
    rootDir,
    port: 2121,
    pasvMin: 40210,
    pasvMax: 40280,
  });
  const restServer = await createMockRestServer(readMockRestServerOptionsFromEnv());

  return {
    baseUrl: restServer.baseUrl,
    ftpPort: ftpServer.port,
    close: async () => {
      await restServer.close();
      await ftpServer.close();
    },
  };
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
