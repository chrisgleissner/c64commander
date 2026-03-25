/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  type TelnetTransport,
  type TelnetKeyName,
  type TelnetSessionApi,
  type TelnetScreen,
  TELNET_KEYS,
  TELNET_DEFAULT_PORT,
  TelnetError,
} from "@/lib/telnet/telnetTypes";
import { parseTelnetScreen } from "@/lib/telnet/telnetScreenParser";
import { addLog } from "@/lib/logging";

const LOG_TAG = "TelnetSession";

/** Maximum reconnection attempts */
const MAX_RECONNECT_RETRIES = 2;

/** Delay between reconnection attempts in ms */
const RECONNECT_DELAY_MS = 500;

/** Idle timeout before auto-disconnect in ms (5 minutes) */
const IDLE_TIMEOUT_MS = 5 * 60 * 1000;

/** Default screen read timeout in ms */
const DEFAULT_READ_TIMEOUT_MS = 500;

/** Maximum consecutive empty reads before treating as frame end */
const MAX_EMPTY_READS = 3;

/**
 * Manages a Telnet session lifecycle: connect, authenticate, send keys, read screens, disconnect.
 *
 * - Lazy connection: established on first action.
 * - Authentication: detects "Password:" prompt and sends password.
 * - Keepalive: idle timeout disconnects after 5 minutes.
 * - Reconnection: automatic on connection loss, max 2 retries.
 */
export function createTelnetSession(transport: TelnetTransport): TelnetSessionApi {
  let host = "";
  let port = TELNET_DEFAULT_PORT;
  let password: string | undefined;
  let authenticated = false;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let screenBuffer = new Uint8Array(0);

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      addLog("info", "Telnet idle timeout — disconnecting", { host });
      void disconnect();
    }, IDLE_TIMEOUT_MS);
  };

  const clearIdleTimer = () => {
    if (idleTimer) {
      clearTimeout(idleTimer);
      idleTimer = null;
    }
  };

  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder("ascii");

  async function connectAndAuth(targetHost: string, targetPort: number, targetPassword?: string): Promise<void> {
    host = targetHost;
    port = targetPort;
    password = targetPassword;
    authenticated = false;

    await transport.connect(host, port);

    // Read initial data (Telnet WILL ECHO / DONT LINEMODE + RIS)
    const initData = await transport.read(2000);
    const initText = textDecoder.decode(initData);

    // Check for password prompt
    if (initText.includes("Password:")) {
      if (!password) {
        throw new TelnetError("Device requires password but none provided", "AUTH_FAILED");
      }
      await transport.send(textEncoder.encode(password + "\r"));

      // Read auth response
      const authData = await transport.read(2000);
      const authText = textDecoder.decode(authData);

      if (authText.includes("Password:") || authText.includes("incorrect") || authText.includes("denied")) {
        await transport.disconnect();
        throw new TelnetError("Authentication failed", "AUTH_FAILED");
      }

      authenticated = true;
    } else {
      // No password required
      authenticated = true;
    }

    screenBuffer = new Uint8Array(0);
    resetIdleTimer();
    addLog("info", "Telnet session connected", { host, port, authenticated });
  }

  async function ensureConnected(): Promise<void> {
    if (transport.isConnected() && authenticated) return;

    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= MAX_RECONNECT_RETRIES; attempt++) {
      try {
        if (transport.isConnected()) {
          await transport.disconnect();
        }
        await connectAndAuth(host, port, password);
        return;
      } catch (error) {
        lastError = error as Error;
        addLog("warn", `Telnet reconnect attempt ${attempt + 1} failed`, {
          host,
          error: lastError.message,
        });
        if (attempt < MAX_RECONNECT_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, RECONNECT_DELAY_MS));
        }
      }
    }

    throw new TelnetError(
      `Failed to connect after ${MAX_RECONNECT_RETRIES + 1} attempts: ${lastError?.message}`,
      "CONNECTION_FAILED",
      { host, port, lastError: lastError?.message },
    );
  }

  async function sendKey(key: TelnetKeyName): Promise<void> {
    await ensureConnected();
    resetIdleTimer();
    const sequence = TELNET_KEYS[key];
    await transport.send(textEncoder.encode(sequence));
  }

  async function sendRaw(data: string): Promise<void> {
    await ensureConnected();
    resetIdleTimer();
    await transport.send(textEncoder.encode(data));
  }

  async function readScreen(timeoutMs?: number): Promise<TelnetScreen> {
    await ensureConnected();
    resetIdleTimer();

    const timeout = timeoutMs ?? DEFAULT_READ_TIMEOUT_MS;
    let emptyReads = 0;
    const chunks: Uint8Array[] = screenBuffer.length > 0 ? [screenBuffer] : [];
    screenBuffer = new Uint8Array(0);

    while (emptyReads < MAX_EMPTY_READS) {
      try {
        const data = await transport.read(timeout);
        if (data.length === 0) {
          emptyReads++;
          continue;
        }
        emptyReads = 0;
        chunks.push(data);
      } catch {
        // Read timeout — treat as frame boundary
        break;
      }
    }

    const totalLength = chunks.reduce((sum, c) => sum + c.length, 0);
    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }

    return parseTelnetScreen(combined);
  }

  async function disconnect(): Promise<void> {
    clearIdleTimer();
    authenticated = false;
    screenBuffer = new Uint8Array(0);
    if (transport.isConnected()) {
      try {
        await transport.disconnect();
      } catch (error) {
        addLog("warn", "Error during Telnet disconnect", {
          error: (error as Error).message,
        });
      }
    }
    addLog("info", "Telnet session disconnected", { host });
  }

  function isConnected(): boolean {
    return transport.isConnected() && authenticated;
  }

  return {
    connect: connectAndAuth,
    sendKey,
    sendRaw,
    readScreen,
    disconnect,
    isConnected,
  };
}
