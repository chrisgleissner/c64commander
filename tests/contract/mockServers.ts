/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
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
    const restServer = await createMockRestServer();

    return {
        baseUrl: restServer.baseUrl,
        ftpPort: ftpServer.port,
        close: async () => {
            await restServer.close();
            await ftpServer.close();
        },
    };
}
