/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * The machine a remote seek test runs against, over REST the way the app reaches it: a real
 * Ultimate by host name, or the mock server with its simulated SID player, so the same test runs on
 * the bench and in CI.
 *
 *   SOAK_HOST=c64u | u64 | u2       a real machine
 *   SOAK_HOST=mock                  a simulated Ultimate 64-family computer
 *   SOAK_HOST=mock-u2               a simulated Ultimate-II+(L): no key input, CPU Speed or Audio Mixer
 */

import { normalizeConfigItem } from "@/lib/config/normalizeConfigItem";
import type { RemoteSeekApi } from "@/lib/playback/remoteSeek/remoteSidSeekController";
import { withSeekKeyPermits } from "@/lib/playback/remoteSeek/seekKeyPermit";
import { createMockC64Server, type MockC64Server } from "../../../tests/mocks/mockC64Server";

export const COUNTER_ADDRESS = 0x10f0;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Requests slower than this are worth a line in the progress log. */
const SLOW_REQUEST_MS = 1500;

export type RequestTotals = { requests: number; failures: number; slowest: number };

export type DeviceTarget = {
  host: string;
  base: string;
  simulated: boolean;
  close: () => Promise<void>;
  mock: MockC64Server | null;
};

/** A real host, or a mock server started in this process for `mock` and `mock-u2`. */
export const openDeviceTarget = async (host: string): Promise<DeviceTarget> => {
  if (!host.startsWith("mock")) {
    return { host, base: `http://${host}`, simulated: false, close: async () => undefined, mock: null };
  }
  const cartridge = host === "mock-u2";
  const mock = await createMockC64Server(
    {},
    {},
    {
      sidPlayer: { keyReleaseDelayMs: 20 },
      keyInput: !cartridge,
      ...(cartridge
        ? {
            deviceInfo: { product: "Ultimate II+L", core_version: null, hostname: "mock-u2", unique_id: "F13E69" },
            omitConfigCategories: ["U64 Specific Settings", "Audio Mixer", "Data Streams"],
          }
        : { deviceInfo: { hostname: "mock-c64u", unique_id: "5D0464" } }),
    },
  );
  return { host, base: mock.baseUrl, simulated: true, close: () => mock.close(), mock };
};

export type ConfigItem = { current: string; values: string[] };

/**
 * REST as the app uses it. Config writes queue behind the app's write interval; reads go out at
 * once, since nothing in this process throttles them.
 */
export class SeekTestDevice {
  dead = false;
  private writeQueue: Promise<unknown> = Promise.resolve();
  private lastWriteAt = 0;

  constructor(
    readonly target: DeviceTarget,
    private readonly totals: RequestTotals,
    private readonly log: (line: string) => void,
    private readonly writeDelayMs: number,
  ) {}

  async request(method: string, route: string, init: { body?: Uint8Array | string; type?: string } = {}) {
    if (this.dead) throw new Error("The app is no longer running");
    this.totals.requests += 1;
    const started = Date.now();
    try {
      const response = await fetch(this.target.base + route, {
        method,
        body: init.body,
        headers: init.type ? { "Content-Type": init.type } : undefined,
        signal: AbortSignal.timeout(8000),
      });
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!response.ok) {
        throw new Error(`${method} ${route}: HTTP ${response.status} ${new TextDecoder().decode(bytes)}`);
      }
      return { bytes, json: (response.headers.get("content-type") ?? "").includes("json") };
    } catch (error) {
      this.totals.failures += 1;
      this.log(`[request] ${method} ${route} failed after ${Date.now() - started} ms: ${error}`);
      throw error;
    } finally {
      const ms = Date.now() - started;
      this.totals.slowest = Math.max(this.totals.slowest, ms);
      if (ms > SLOW_REQUEST_MS) this.log(`[request] ${method} ${route} took ${ms} ms`);
    }
  }

  json = async (method: string, route: string) =>
    JSON.parse(new TextDecoder().decode((await this.request(method, route)).bytes)) as Record<string, unknown>;

  /** The Ultimate answers readmem with raw bytes; the mock server answers with JSON. */
  readmem = async (address: number, length: number): Promise<Uint8Array> => {
    const route = `/v1/machine:readmem?address=${address.toString(16).toUpperCase().padStart(4, "0")}&length=${length}`;
    const { bytes, json } = await this.request("GET", route);
    if (!json) return bytes;
    return Uint8Array.from((JSON.parse(new TextDecoder().decode(bytes)) as { data: number[] }).data);
  };

  writemem = async (address: number, data: Uint8Array) => {
    const hex = Array.from(data, (byte) => byte.toString(16).padStart(2, "0")).join("");
    await this.request("PUT", `/v1/machine:writemem?address=${address.toString(16).padStart(4, "0")}&data=${hex}`);
  };

  /** One config item as the device reports it, in either of the shapes the firmware and the mock use. */
  item = async (category: string, name: string): Promise<ConfigItem> => {
    const body = await this.json("GET", `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(name)}`);
    const raw = body[category] as Record<string, unknown> | undefined;
    const item = normalizeConfigItem(raw?.[name] ?? (raw?.items as Record<string, unknown> | undefined)?.[name]);
    return { current: String(item.value), values: item.options ?? [] };
  };

  private readonly missingItems = new Set<string>();

  /** A config item, or null on a machine without it, such as CPU Speed on a cartridge (asked once). */
  optionalItem = async (category: string, name: string) => {
    const key = `${category}/${name}`;
    if (this.missingItems.has(key)) return null;
    try {
      const item = await this.item(category, name);
      if (item.current !== "" || item.values.length > 0) return item;
    } catch (error) {
      if (!/HTTP 404/.test(String(error))) throw error;
    }
    this.missingItems.add(key);
    return null;
  };

  /** A config write behind the same interval the app's write queue enforces. */
  write = (category: string, name: string, value: string) => {
    const next = this.writeQueue.then(async () => {
      const wait = this.writeDelayMs - (Date.now() - this.lastWriteAt);
      if (wait > 0) await sleep(wait);
      this.lastWriteAt = Date.now();
      const route = `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(name)}?value=${encodeURIComponent(value)}`;
      const body = await this.json("PUT", route);
      const errors = (body.errors as string[] | undefined) ?? [];
      if (errors.length) throw new Error(`PUT ${name}=${value}: ${errors.join("; ")}`);
    });
    // The caller gets the failure through `next`; the queue notes it and carries on.
    this.writeQueue = next.catch((error) => this.log(`[write queue] ${category}/${name}=${value}: ${error}`));
    return next;
  };

  /** Keys the device holds; a machine without key input holds none. */
  heldKeys = async (): Promise<string[]> => {
    try {
      return ((await this.json("GET", "/v1/machine:input")).keyboard as { inputs: string[] }).inputs;
    } catch (error) {
      if (/HTTP 501/.test(String(error))) return [];
      throw error;
    }
  };

  sidplay = async (sid: Uint8Array, songNr?: number) => {
    const boundary = "----remote-seek-test";
    const head = new TextEncoder().encode(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test.sid"\r\nContent-Type: application/octet-stream\r\n\r\n`,
    );
    const tail = new TextEncoder().encode(`\r\n--${boundary}--\r\n`);
    await this.request("POST", `/v1/runners:sidplay${songNr ? `?songnr=${songNr}` : ""}`, {
      body: Uint8Array.from([...head, ...sid, ...tail]),
      type: `multipart/form-data; boundary=${boundary}`,
    });
  };

  /** The counter tune's play calls so far. */
  counter = async () => {
    const raw = await this.readmem(COUNTER_ADDRESS, 3);
    return raw[0] | (raw[1] << 8) | (raw[2] << 16);
  };

  reset = () => this.request("PUT", "/v1/machine:reset");
}

/** The REST API as remote seeking uses it, bound to the identity this test says it is connected to. */
export const seekTestApi = (device: SeekTestDevice, deviceKey: () => string | null): RemoteSeekApi => ({
  currentDeviceKey: deviceKey,
  getConfigItem: async (category, item) =>
    (await device.json("GET", `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}`)) as never,
  setConfigValue: async (category, item, value) => {
    await device.write(category, item, String(value));
    return {} as never;
  },
  // Through the same permit check as the app's REST wiring, so a seek key needs the player confirmed.
  sendMachineInputBatch: withSeekKeyPermits(
    async (batch) =>
      (await device.request("POST", "/v1/machine:input", { body: JSON.stringify(batch), type: "application/json" }))
        .bytes,
    deviceKey,
  ),
  getMachineInputState: async () => (await device.json("GET", "/v1/machine:input")) as never,
  readMemory: (address, length) => device.readmem(parseInt(address, 16), length),
  writeMemory: (address, data) => device.writemem(parseInt(address, 16), data),
});

/** The identity key the app derives from /v1/info. */
export const deviceKeyOf = (info: Record<string, unknown>) =>
  JSON.stringify([String(info.unique_id).trim().toLowerCase(), String(info.hostname).trim().toLowerCase()]);
