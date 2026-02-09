/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as path from "node:path";
import type { AddressInfo } from "node:net";
import FtpSrv from "ftp-srv";

type FtpSrvInstance = {
    on: (event: string, handler: (...args: any[]) => void) => void;
    listen: () => Promise<void>;
    close: () => Promise<void>;
    server: { address: () => AddressInfo | string | null };
};

type FtpSrvConstructor = new (options: Record<string, unknown>) => FtpSrvInstance;

export type MockFtpServer = {
    host: string;
    port: number;
    rootDir: string;
    close: () => Promise<void>;
};

type MockFtpServerOptions = {
    rootDir: string;
    password?: string;
    port?: number;
    host?: string;
    pasvMin?: number;
    pasvMax?: number;
};

export async function createMockFtpServer(options: MockFtpServerOptions): Promise<MockFtpServer> {
    const host = options.host ?? "127.0.0.1";
    const rootDir = path.resolve(options.rootDir);
    const port = options.port ?? 0;
    const password = options.password ?? "";
    const pasvMin = options.pasvMin ?? 40100;
    const pasvMax = options.pasvMax ?? 40200;
    const silentLog = {
        info: () => { },
        warn: () => { },
        error: () => { },
        debug: () => { },
        trace: () => { },
        fatal: () => { },
        child: () => silentLog,
    };

    const FtpSrvCtor = FtpSrv as unknown as FtpSrvConstructor;
    const server = new FtpSrvCtor({
        url: `ftp://${host}:${port}`,
        pasv_url: host,
        pasv_min: pasvMin,
        pasv_max: pasvMax,
        anonymous: true,
        log: silentLog,
    });

    server.on(
        "login",
        (
            { password: suppliedPassword }: { password?: string },
            resolve: (value: { root: string }) => void,
            reject: (error: Error) => void
        ) => {
            const ok = !password || suppliedPassword === password;
            if (!ok) {
                reject(new Error("FTP login failed"));
                return;
            }
            resolve({ root: rootDir });
        }
    );

    await server.listen();
    const address = server.server.address();
    if (!address || typeof address === "string") {
        throw new Error("Failed to start FTP server");
    }

    return {
        host,
        port: address.port,
        rootDir,
        close: async () => {
            await server.close();
        },
    };
}
