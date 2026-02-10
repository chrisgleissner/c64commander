/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import net from "node:net";
import { randomUUID } from "node:crypto";

export type FtpMode = "PASV" | "PORT";

export type FtpClientConfig = {
    host: string;
    port: number;
    user: string;
    password: string;
    mode: FtpMode;
    timeoutMs: number;
};

export type FtpResponse = {
    code: number;
    message: string;
};

export type FtpCommandResult = {
    response: FtpResponse;
    latencyMs: number;
    correlationId: string;
};

export class FtpClient {
    private readonly control: net.Socket;
    private buffer = "";
    private readonly config: FtpClientConfig;
    private connected = false;
    readonly sessionId = randomUUID();

    constructor(config: FtpClientConfig) {
        this.config = config;
        this.control = new net.Socket();
        this.control.setEncoding("utf8");
    }

    async connect(): Promise<void> {
        await withTimeout(
            new Promise<void>((resolve, reject) => {
                this.control.once("error", reject);
                this.control.connect(this.config.port, this.config.host, () => resolve());
            }),
            this.config.timeoutMs,
            "FTP control connect timeout"
        );
        await this.readResponse();
        await this.sendCommand(`USER ${this.config.user}`);
        const passResponse = await this.sendCommand(`PASS ${this.config.password}`);
        if (passResponse.response.code !== 230) {
            throw new Error(`FTP auth failed: ${passResponse.response.code} ${passResponse.response.message}`);
        }
        this.connected = true;
    }

    async close(): Promise<void> {
        if (!this.connected) {
            this.control.destroy();
            return;
        }
        try {
            await this.sendCommand("QUIT");
        } finally {
            this.control.end();
            this.control.destroy();
            this.connected = false;
        }
    }

    async pwd(): Promise<FtpCommandResult> {
        return this.sendCommand("PWD");
    }

    async cwd(path: string): Promise<FtpCommandResult> {
        return this.sendCommand(`CWD ${path}`);
    }

    async mkd(path: string): Promise<FtpCommandResult> {
        return this.sendCommand(`MKD ${path}`);
    }

    async rmd(path: string): Promise<FtpCommandResult> {
        return this.sendCommand(`RMD ${path}`);
    }

    async dele(path: string): Promise<FtpCommandResult> {
        return this.sendCommand(`DELE ${path}`);
    }

    async rnfr(path: string): Promise<FtpCommandResult> {
        return this.sendCommand(`RNFR ${path}`);
    }

    async rnto(path: string): Promise<FtpCommandResult> {
        return this.sendCommand(`RNTO ${path}`);
    }

    async size(path: string): Promise<FtpCommandResult> {
        return this.sendCommand(`SIZE ${path}`);
    }

    async list(path = ""): Promise<{ result: FtpCommandResult; data: string }> {
        return this.transferWithData(`LIST ${path}`.trim());
    }

    async nlst(path = ""): Promise<{ result: FtpCommandResult; data: string }> {
        return this.transferWithData(`NLST ${path}`.trim());
    }

    async mlsd(path = ""): Promise<{ result: FtpCommandResult; data: string }> {
        return this.transferWithData(`MLSD ${path}`.trim());
    }

    async mlst(path = ""): Promise<FtpCommandResult> {
        return this.sendCommand(`MLST ${path}`.trim());
    }

    async retr(path: string): Promise<{ result: FtpCommandResult; data: Buffer }> {
        const { socket, close } = await this.openDataConnection();
        const start = Date.now();
        const correlationId = randomUUID();
        this.control.write(`RETR ${path}\r\n`);
        const pre = await this.readResponse();
        if (pre.code >= 400) {
            close();
            return { result: { response: pre, latencyMs: Date.now() - start, correlationId }, data: Buffer.alloc(0) };
        }
        const data = await readAll(socket, this.config.timeoutMs);
        close();
        const post = await this.readResponse();
        return { result: { response: post, latencyMs: Date.now() - start, correlationId }, data };
    }

    async stor(path: string, data: Buffer): Promise<FtpCommandResult> {
        const { socket, close } = await this.openDataConnection();
        const start = Date.now();
        const correlationId = randomUUID();
        this.control.write(`STOR ${path}\r\n`);
        const pre = await this.readResponse();
        if (pre.code >= 400) {
            close();
            return { response: pre, latencyMs: Date.now() - start, correlationId };
        }
        socket.write(data);
        socket.end();
        try {
            await this.waitForDataSocketToFinish(socket);
        } finally {
            close();
        }
        const post = await this.readResponse();
        return { response: post, latencyMs: Date.now() - start, correlationId };
    }

    private async waitForDataSocketToFinish(socket: net.Socket): Promise<void> {
        await withTimeout(
            new Promise<void>((resolve, reject) => {
                let settled = false;
                const cleanup = () => {
                    socket.off("finish", onDone);
                    socket.off("close", onDone);
                    socket.off("end", onDone);
                    socket.off("error", onError);
                };
                const onDone = () => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    cleanup();
                    resolve();
                };
                const onError = (err: Error) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    cleanup();
                    reject(err);
                };
                socket.once("finish", onDone);
                socket.once("close", onDone);
                socket.once("end", onDone);
                socket.once("error", onError);
            }),
            this.config.timeoutMs,
            "FTP data socket finish timeout"
        );
    }

    async sendCommand(command: string): Promise<FtpCommandResult> {
        const start = Date.now();
        const correlationId = randomUUID();
        this.control.write(`${command}\r\n`);
        const response = await this.readResponse();
        return { response, latencyMs: Date.now() - start, correlationId };
    }

    private async readResponse(): Promise<FtpResponse> {
        const line = await this.readLine();
        if (!line) {
            throw new Error("FTP response empty");
        }
        const code = parseInt(line.slice(0, 3), 10);
        if (Number.isNaN(code)) {
            return { code: 0, message: line };
        }
        if (line[3] === "-") {
            let message = line;
            while (true) {
                const next = await this.readLine();
                message += `\n${next}`;
                if (next.startsWith(`${code} `)) {
                    break;
                }
            }
            return { code, message };
        }
        return { code, message: line };
    }

    private readLine(): Promise<string> {
        return withTimeout(
            new Promise((resolve, reject) => {
                const onData = (chunk: string) => {
                    this.buffer += chunk;
                    const idx = this.buffer.indexOf("\n");
                    if (idx !== -1) {
                        const line = this.buffer.slice(0, idx).replace(/\r$/, "");
                        this.buffer = this.buffer.slice(idx + 1);
                        cleanup();
                        resolve(line);
                    }
                };
                const onError = (err: Error) => {
                    cleanup();
                    reject(err);
                };
                const onClose = () => {
                    cleanup();
                    reject(new Error("FTP control socket closed"));
                };
                const cleanup = () => {
                    this.control.removeListener("data", onData);
                    this.control.removeListener("error", onError);
                    this.control.removeListener("close", onClose);
                };
                this.control.on("data", onData);
                this.control.once("error", onError);
                this.control.once("close", onClose);
            }),
            this.config.timeoutMs,
            "FTP read response timeout"
        );
    }

    private async transferWithData(command: string): Promise<{ result: FtpCommandResult; data: string }> {
        const { socket, close } = await this.openDataConnection();
        const start = Date.now();
        const correlationId = randomUUID();
        this.control.write(`${command}\r\n`);
        const pre = await this.readResponse();
        if (pre.code >= 400) {
            close();
            return { result: { response: pre, latencyMs: Date.now() - start, correlationId }, data: "" };
        }
        const data = (await readAll(socket, this.config.timeoutMs)).toString("utf8");
        close();
        const post = await this.readResponse();
        return { result: { response: post, latencyMs: Date.now() - start, correlationId }, data };
    }

    private async openDataConnection(): Promise<{ socket: net.Socket; close: () => void }> {
        if (this.config.mode === "PASV") {
            const response = await this.sendCommand("PASV");
            if (response.response.code !== 227) {
                throw new Error(`PASV failed: ${response.response.message}`);
            }
            const match = response.response.message.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
            if (!match) {
                throw new Error(`PASV parse failed: ${response.response.message}`);
            }
            const host = `${match[1]}.${match[2]}.${match[3]}.${match[4]}`;
            const port = (parseInt(match[5], 10) << 8) + parseInt(match[6], 10);
            const socket = new net.Socket();
            socket.setTimeout(this.config.timeoutMs);
            await withTimeout(
                new Promise<void>((resolve, reject) => {
                    socket.once("error", reject);
                    socket.connect(port, host, () => resolve());
                }),
                this.config.timeoutMs,
                "FTP PASV data connect timeout"
            );
            return { socket, close: () => socket.destroy() };
        }

        const server = net.createServer();
        server.maxConnections = 1;
        let closed = false;
        const closeServer = () => {
            if (closed) {
                return;
            }
            closed = true;
            server.close();
        };

        try {
            const port = await new Promise<number>((resolve, reject) => {
                server.once("error", reject);
                server.listen(0, () => {
                    const address = server.address();
                    if (!address || typeof address === "string") {
                        reject(new Error("FTP PORT listen failed"));
                        return;
                    }
                    resolve(address.port);
                });
            });

            const localAddress = this.control.localAddress || "127.0.0.1";
            if (!localAddress.includes(".")) {
                throw new Error(`FTP PORT requires IPv4 local address, got '${localAddress}'`);
            }
            const [a, b, c, d] = localAddress.split(".").map((part) => parseInt(part, 10));
            const pHi = Math.floor(port / 256);
            const pLo = port % 256;
            await this.sendCommand(`PORT ${a},${b},${c},${d},${pHi},${pLo}`);

            const socket = await withTimeout(
                new Promise<net.Socket>((resolve, reject) => {
                    server.once("connection", (client) => {
                        closeServer();
                        resolve(client);
                    });
                    server.once("error", (err) => {
                        closeServer();
                        reject(err);
                    });
                }),
                this.config.timeoutMs,
                "FTP PORT accept timeout"
            );

            return { socket, close: () => socket.destroy() };
        } catch (error) {
            closeServer();
            throw error;
        }
    }
}

async function readAll(socket: net.Socket, timeoutMs: number): Promise<Buffer> {
    socket.setTimeout(timeoutMs);
    const chunks: Buffer[] = [];
    return withTimeout(
        new Promise<Buffer>((resolve, reject) => {
            socket.on("data", (data) => chunks.push(Buffer.from(data)));
            socket.once("error", reject);
            socket.once("timeout", () => reject(new Error("FTP data timeout")));
            socket.once("end", () => resolve(Buffer.concat(chunks)));
            socket.once("close", () => resolve(Buffer.concat(chunks)));
        }),
        timeoutMs,
        "FTP data read timeout"
    );
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    const timer = new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    try {
        return await Promise.race([promise, timer]);
    } finally {
        if (timeout) {
            clearTimeout(timeout);
        }
    }
}
