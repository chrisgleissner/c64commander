/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import net from "node:net";
import { parseTelnetScreen } from "./telnetScreen.js";
import {
  ContractTelnetError,
  TELNET_DEFAULT_PORT,
  TELNET_KEYS,
  type TelnetKeyName,
  type TelnetScreen,
} from "./telnetTypes.js";

const DEFAULT_READ_TIMEOUT_MS = 500;
const MAX_EMPTY_READS = 3;

export type TelnetClientConfig = {
  host: string;
  port?: number;
  password?: string;
  timeoutMs: number;
};

export class TelnetClient {
  private readonly socket = new net.Socket();
  private readonly decoder = new TextDecoder("ascii");
  private readonly encoder = new TextEncoder();
  private connected = false;
  private authenticated = false;
  private pendingChunks: Uint8Array[] = [];
  private promptSeen = false;

  constructor(private readonly config: TelnetClientConfig) {}

  get promptedForPassword(): boolean {
    return this.promptSeen;
  }

  async connect(): Promise<void> {
    const host = this.config.host;
    const port = this.config.port ?? TELNET_DEFAULT_PORT;

    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        this.socket.off("connect", onConnect);
        this.socket.off("error", onError);
        this.socket.off("timeout", onTimeout);
      };
      const onConnect = () => {
        cleanup();
        resolve();
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new ContractTelnetError(`Telnet connect failed: ${error.message}`, "CONNECTION_FAILED", { host, port }));
      };
      const onTimeout = () => {
        cleanup();
        reject(
          new ContractTelnetError(`Telnet connect timeout after ${this.config.timeoutMs}ms`, "TIMEOUT", { host, port }),
        );
      };
      this.socket.setTimeout(this.config.timeoutMs);
      this.socket.once("connect", onConnect);
      this.socket.once("error", onError);
      this.socket.once("timeout", onTimeout);
      this.socket.connect(port, host);
    });

    this.connected = true;
    const initData = await this.readChunk(this.config.timeoutMs);
    const initText = this.decoder.decode(initData);
    this.promptSeen = initText.includes("Password:");

    if (this.promptSeen) {
      if (!this.config.password) {
        await this.close();
        throw new ContractTelnetError("Device requires password but none was provided", "AUTH_FAILED", { host, port });
      }
      await this.sendRaw(`${this.config.password}\r`);
      const authData = await this.readChunk(this.config.timeoutMs);
      const authText = this.decoder.decode(authData);
      if (authText.includes("Password:") || authText.includes("incorrect") || authText.includes("denied")) {
        await this.close();
        throw new ContractTelnetError("Telnet authentication failed", "AUTH_FAILED", { host, port });
      }
      this.pendingChunks = [authData];
    } else {
      this.pendingChunks = [initData];
    }

    this.authenticated = true;
  }

  async sendKey(key: TelnetKeyName): Promise<void> {
    await this.sendRaw(TELNET_KEYS[key]);
  }

  async sendRaw(text: string): Promise<void> {
    if (!this.connected) {
      throw new ContractTelnetError("Telnet socket is not connected", "DISCONNECTED");
    }
    await new Promise<void>((resolve, reject) => {
      this.socket.write(this.encoder.encode(text), (error) => {
        if (error) {
          reject(new ContractTelnetError(`Telnet send failed: ${error.message}`, "DISCONNECTED"));
          return;
        }
        resolve();
      });
    });
  }

  async readScreen(timeoutMs = DEFAULT_READ_TIMEOUT_MS): Promise<TelnetScreen> {
    const chunks = [...this.pendingChunks];
    this.pendingChunks = [];
    let emptyReads = 0;

    while (emptyReads < MAX_EMPTY_READS) {
      try {
        const chunk = await this.readChunk(timeoutMs);
        if (chunk.length === 0) {
          emptyReads += 1;
          continue;
        }
        chunks.push(chunk);
        emptyReads = 0;
      } catch (error) {
        if (error instanceof ContractTelnetError && error.code === "TIMEOUT") {
          break;
        }
        throw error;
      }
    }

    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    return parseTelnetScreen(combined);
  }

  async close(): Promise<void> {
    if (!this.connected) {
      this.socket.destroy();
      return;
    }
    await new Promise<void>((resolve) => {
      this.socket.once("close", () => resolve());
      this.socket.end();
      setTimeout(() => {
        this.socket.destroy();
        resolve();
      }, 50);
    });
    this.connected = false;
    this.authenticated = false;
    this.pendingChunks = [];
  }

  private async readChunk(timeoutMs: number): Promise<Uint8Array> {
    if (!this.connected) {
      throw new ContractTelnetError("Telnet socket is not connected", "DISCONNECTED");
    }
    return new Promise<Uint8Array>((resolve, reject) => {
      const cleanup = () => {
        this.socket.off("data", onData);
        this.socket.off("error", onError);
        this.socket.off("timeout", onTimeout);
        clearTimeout(timer);
      };
      const onData = (data: Buffer) => {
        cleanup();
        resolve(new Uint8Array(data));
      };
      const onError = (error: Error) => {
        cleanup();
        reject(new ContractTelnetError(`Telnet read failed: ${error.message}`, "DISCONNECTED"));
      };
      const onTimeout = () => {
        cleanup();
        reject(new ContractTelnetError(`Telnet read timeout after ${timeoutMs}ms`, "TIMEOUT"));
      };
      const timer = setTimeout(onTimeout, timeoutMs);
      this.socket.once("data", onData);
      this.socket.once("error", onError);
      this.socket.once("timeout", onTimeout);
    });
  }
}
