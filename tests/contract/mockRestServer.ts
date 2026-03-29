/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

type DriveState = {
  enabled: boolean;
  bus_id: number;
  type?: string;
  rom?: string;
  image_file?: string;
  image_path?: string;
  last_error?: string;
};

type ConfigItem = {
  value: string | number;
  min?: number;
  max?: number;
  values?: string[];
  default?: string | number;
  format?: string;
};

type ConfigState = Record<string, Record<string, ConfigItem>>;

export type MockRestServer = {
  baseUrl: string;
  close: () => Promise<void>;
};

export type MockRestServerOptions = {
  breakpointFailure?: {
    afterRequests: number;
    mode: "status" | "hang";
    status?: number;
    methods?: string[];
    pathIncludes?: string;
  };
};

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const json = (res: ServerResponse, status: number, payload: unknown) => {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.end(JSON.stringify(payload));
};

const normalizePath = (value: string) => value.replace(/\/+/g, "/");

const toDrivePayload = (drive: DriveState) => ({
  enabled: drive.enabled,
  bus_id: drive.bus_id,
  ...(drive.type ? { type: drive.type } : {}),
  ...(drive.rom ? { rom: drive.rom } : {}),
  ...(typeof drive.image_file === "string" ? { image_file: drive.image_file } : {}),
  ...(typeof drive.image_path === "string" ? { image_path: drive.image_path } : {}),
  ...(drive.last_error ? { last_error: drive.last_error } : {}),
});

const stringConfig = (value: string, options: { values?: string[]; default?: string } = {}): ConfigItem => ({
  value,
  ...(options.values ? { values: options.values } : {}),
  default: options.default ?? value,
});

const numberConfig = (
  value: number,
  options: { min?: number; max?: number; default?: number; format?: string } = {},
): ConfigItem => ({
  value,
  ...(typeof options.min === "number" ? { min: options.min } : {}),
  ...(typeof options.max === "number" ? { max: options.max } : {}),
  ...(typeof options.format === "string" ? { format: options.format } : {}),
  default: options.default ?? value,
});

const createDefaultConfigState = (): ConfigState => ({
  "Audio Mixer": {
    "Vol UltiSid 1": stringConfig(" 0 dB", {
      values: [
        "OFF",
        "-42 dB",
        "-36 dB",
        "-30 dB",
        "-27 dB",
        "-24 dB",
        "-18 dB",
        "-17 dB",
        "-16 dB",
        "-15 dB",
        "-14 dB",
        "-13 dB",
        "-12 dB",
        "-11 dB",
        "-10 dB",
        "-9 dB",
        "-8 dB",
        "-7 dB",
        "-6 dB",
        "-5 dB",
        "-4 dB",
        "-3 dB",
        "-2 dB",
        "-1 dB",
        " 0 dB",
        "+1 dB",
        "+2 dB",
        "+3 dB",
        "+4 dB",
        "+5 dB",
        "+6 dB",
      ],
    }),
    "Vol UltiSid 2": stringConfig(" 0 dB", {
      values: [
        "OFF",
        "-42 dB",
        "-36 dB",
        "-30 dB",
        "-27 dB",
        "-24 dB",
        "-18 dB",
        "-17 dB",
        "-16 dB",
        "-15 dB",
        "-14 dB",
        "-13 dB",
        "-12 dB",
        "-11 dB",
        "-10 dB",
        "-9 dB",
        "-8 dB",
        "-7 dB",
        "-6 dB",
        "-5 dB",
        "-4 dB",
        "-3 dB",
        "-2 dB",
        "-1 dB",
        " 0 dB",
        "+1 dB",
        "+2 dB",
        "+3 dB",
        "+4 dB",
        "+5 dB",
        "+6 dB",
      ],
    }),
    "Vol Socket 1": stringConfig(" 0 dB", {
      values: [
        "OFF",
        "-42 dB",
        "-36 dB",
        "-30 dB",
        "-27 dB",
        "-24 dB",
        "-18 dB",
        "-17 dB",
        "-16 dB",
        "-15 dB",
        "-14 dB",
        "-13 dB",
        "-12 dB",
        "-11 dB",
        "-10 dB",
        "-9 dB",
        "-8 dB",
        "-7 dB",
        "-6 dB",
        "-5 dB",
        "-4 dB",
        "-3 dB",
        "-2 dB",
        "-1 dB",
        " 0 dB",
        "+1 dB",
        "+2 dB",
        "+3 dB",
        "+4 dB",
        "+5 dB",
        "+6 dB",
      ],
    }),
    "Vol Socket 2": stringConfig(" 0 dB", {
      values: [
        "OFF",
        "-42 dB",
        "-36 dB",
        "-30 dB",
        "-27 dB",
        "-24 dB",
        "-18 dB",
        "-17 dB",
        "-16 dB",
        "-15 dB",
        "-14 dB",
        "-13 dB",
        "-12 dB",
        "-11 dB",
        "-10 dB",
        "-9 dB",
        "-8 dB",
        "-7 dB",
        "-6 dB",
        "-5 dB",
        "-4 dB",
        "-3 dB",
        "-2 dB",
        "-1 dB",
        " 0 dB",
        "+1 dB",
        "+2 dB",
        "+3 dB",
        "+4 dB",
        "+5 dB",
        "+6 dB",
      ],
    }),
    "Vol Sampler L": stringConfig(" 0 dB"),
    "Vol Sampler R": stringConfig(" 0 dB"),
    "Vol Drive 1": stringConfig("OFF"),
    "Vol Drive 2": stringConfig("OFF"),
    "Vol Tape Read": stringConfig("OFF"),
    "Vol Tape Write": stringConfig("OFF"),
    "Pan UltiSID 1": stringConfig("Center"),
    "Pan UltiSID 2": stringConfig("Center"),
    "Pan Socket 1": stringConfig("Left 3", {
      values: [
        "Left 5",
        "Left 4",
        "Left 3",
        "Left 2",
        "Left 1",
        "Center",
        "Right 1",
        "Right 2",
        "Right 3",
        "Right 4",
        "Right 5",
      ],
    }),
    "Pan Socket 2": stringConfig("Right 3"),
    "Pan Sampler L": stringConfig("Left 3"),
    "Pan Sampler R": stringConfig("Right 3"),
    "Pan Drive 1": stringConfig("Left 2"),
    "Pan Drive 2": stringConfig("Right 2"),
    "Pan Tape Read": stringConfig("Center"),
    "Pan Tape Write": stringConfig("Center"),
  },
  "Drive A Settings": {
    Drive: stringConfig("Enabled", { values: ["Disabled", "Enabled"] }),
    "Drive Type": stringConfig("1541", { values: ["1541", "1571", "1581"] }),
    "Drive Bus ID": numberConfig(8, { min: 8, max: 11, format: "%d" }),
    "ROM for 1541 mode": stringConfig("1541.rom"),
    "ROM for 1571 mode": stringConfig("1571.rom"),
    "ROM for 1581 mode": stringConfig("1581.rom"),
    "Extra RAM": stringConfig("Disabled"),
    "Disk swap delay": numberConfig(1, { min: 0, max: 10, format: "%d" }),
    "Resets when C64 resets": stringConfig("Yes", { values: ["No", "Yes"] }),
    "Freezes in menu": stringConfig("Yes", { values: ["No", "Yes"] }),
    "GCR Save Align Tracks": stringConfig("Yes", { values: ["No", "Yes"] }),
    "Leave Menu on Mount": stringConfig("Yes", { values: ["No", "Yes"] }),
    "D64 Geos Copy Protection": stringConfig("none"),
  },
  "Drive B Settings": {
    Drive: stringConfig("Disabled", { values: ["Disabled", "Enabled"] }),
    "Drive Type": stringConfig("1541", { values: ["1541", "1571", "1581"] }),
    "Drive Bus ID": numberConfig(9, { min: 8, max: 11, format: "%d" }),
    "ROM for 1541 mode": stringConfig("1541.rom"),
    "ROM for 1571 mode": stringConfig("1571.rom"),
    "ROM for 1581 mode": stringConfig("1581.rom"),
    "Extra RAM": stringConfig("Disabled"),
    "Disk swap delay": numberConfig(1, { min: 0, max: 10, format: "%d" }),
    "Resets when C64 resets": stringConfig("Yes", { values: ["No", "Yes"] }),
    "Freezes in menu": stringConfig("Yes", { values: ["No", "Yes"] }),
    "GCR Save Align Tracks": stringConfig("Yes", { values: ["No", "Yes"] }),
    "Leave Menu on Mount": stringConfig("Yes", { values: ["No", "Yes"] }),
    "D64 Geos Copy Protection": stringConfig("none"),
  },
  "Data Streams": {
    "Stream VIC to": stringConfig("239.0.1.64:11000"),
    "Stream Audio to": stringConfig("239.0.1.65:11001"),
    "Stream Debug to": stringConfig("239.0.1.66:11002"),
    "Debug Stream Mode": stringConfig("6510 Only"),
  },
});

export async function createMockRestServer(options: MockRestServerOptions = {}): Promise<MockRestServer> {
  const configState: ConfigState = createDefaultConfigState();
  const driveState: Record<"a" | "b" | "softiec" | "printer", DriveState> = {
    a: { enabled: true, bus_id: 8, type: "1541", rom: "1541.rom", image_file: "", image_path: "" },
    b: { enabled: false, bus_id: 9, type: "1541", rom: "1541.rom", image_file: "", image_path: "" },
    softiec: {
      enabled: false,
      bus_id: 11,
      type: "DOS emulation",
      last_error: "73,U64IEC ULTIMATE DOS V1.1,00,00",
    },
    printer: { enabled: false, bus_id: 4 },
  };
  let matchingRequestCount = 0;

  const server = http.createServer(async (req, res) => {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";
    const parsed = new URL(url, "http://127.0.0.1");

    if (shouldInjectBreakpointFailure({ failure: options.breakpointFailure, method, path: parsed.pathname })) {
      matchingRequestCount += 1;
      if (matchingRequestCount > options.breakpointFailure!.afterRequests) {
        if (options.breakpointFailure!.mode === "hang") {
          return;
        }
        json(res, options.breakpointFailure!.status ?? 503, { errors: ["Breakpoint failure injected"] });
        return;
      }
    }

    if (method === "OPTIONS") {
      json(res, 204, {});
      return;
    }

    if (method === "GET" && parsed.pathname === "/v1/info") {
      json(res, 200, {
        product: "C64 Ultimate",
        firmware_version: "1.1.0",
        fpga_version: "122",
        core_version: "1.49",
        hostname: "c64u",
        unique_id: "MOCK-" + randomUUID().slice(0, 8),
        errors: [],
      });
      return;
    }

    if (method === "GET" && parsed.pathname === "/v1/version") {
      json(res, 200, { version: "0.1", errors: [] });
      return;
    }

    if (method === "GET" && parsed.pathname === "/v1/drives") {
      json(res, 200, {
        drives: [
          { a: toDrivePayload(driveState.a) },
          { b: toDrivePayload(driveState.b) },
          { "IEC Drive": { ...toDrivePayload(driveState.softiec), partitions: [{ id: 0, path: "/USB0/" }] } },
          {
            "Printer Emulation": {
              enabled: driveState.printer.enabled,
              bus_id: driveState.printer.bus_id,
            },
          },
        ],
        errors: [],
      });
      return;
    }

    if (method === "GET" && parsed.pathname === "/v1/configs") {
      json(res, 200, { categories: Object.keys(configState), errors: [] });
      return;
    }

    const configCategoryMatch = parsed.pathname.match(/^\/v1\/configs\/([^/]+)$/);
    if (method === "GET" && configCategoryMatch) {
      const category = decodeURIComponent(configCategoryMatch[1]);
      const entries = configState[category] ?? {};
      json(res, 200, {
        [category]: Object.fromEntries(Object.entries(entries).map(([name, entry]) => [name, entry.value])),
        errors: [],
      });
      return;
    }

    const configItemMatch = parsed.pathname.match(/^\/v1\/configs\/([^/]+)\/([^/]+)$/);
    if (configItemMatch && (method === "GET" || method === "PUT")) {
      const category = decodeURIComponent(configItemMatch[1]);
      const item = decodeURIComponent(configItemMatch[2]);
      const entry = configState[category]?.[item];
      if (!entry) {
        json(res, 404, { errors: ["Config item not found"] });
        return;
      }
      if (method === "PUT") {
        const nextValue = parsed.searchParams.get("value");
        if (nextValue !== null) {
          entry.value = isNaN(Number(nextValue)) ? nextValue : Number(nextValue);
        }
      }
      const { value: _value, ...details } = entry;
      json(res, 200, {
        [category]: { [item]: { current: entry.value, ...details } },
        errors: [],
      });
      return;
    }

    if (method === "POST" && parsed.pathname === "/v1/configs") {
      const body = await readBody(req);
      try {
        const payload = JSON.parse(body) as Record<string, Record<string, string | number>>;
        Object.entries(payload).forEach(([category, items]) => {
          configState[category] = configState[category] ?? {};
          Object.entries(items).forEach(([item, value]) => {
            const existing = configState[category][item];
            configState[category][item] = existing ? { ...existing, value } : { value, default: value };
          });
        });
      } catch {
        json(res, 400, { errors: ["Invalid payload"] });
        return;
      }
      json(res, 200, { errors: [] });
      return;
    }

    if (method === "GET" && parsed.pathname.startsWith("/v1/files/") && parsed.pathname.endsWith(":info")) {
      const filePath = decodeURIComponent(parsed.pathname.replace("/v1/files/", "").replace(":info", ""));
      json(res, 200, {
        path: filePath,
        size: 0,
        type: path.extname(filePath).slice(1),
        errors: [],
      });
      return;
    }

    if (method === "GET" && parsed.pathname === "/v1/machine:readmem") {
      const length = Math.max(1, Number(parsed.searchParams.get("length") || "1"));
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "*");
      res.end(Buffer.alloc(length, 0));
      return;
    }

    if (method === "GET" && parsed.pathname === "/v1/machine:debugreg") {
      json(res, 200, { value: "00", errors: [] });
      return;
    }

    if (
      method === "PUT" &&
      [
        "/v1/machine:reset",
        "/v1/machine:reboot",
        "/v1/machine:pause",
        "/v1/machine:resume",
        "/v1/machine:menu_button",
        "/v1/configs:save_to_flash",
        "/v1/configs:load_from_flash",
        "/v1/configs:reset_to_default",
      ].includes(parsed.pathname)
    ) {
      if (parsed.pathname === "/v1/configs:reset_to_default") {
        Object.assign(configState, createDefaultConfigState());
      }
      json(res, 200, { errors: [] });
      return;
    }

    const driveActionMatch = parsed.pathname.match(/^\/v1\/drives\/([^/]+):(on|off|reset)$/);
    if (method === "PUT" && driveActionMatch) {
      const drive = driveActionMatch[1] as "a" | "b" | "softiec" | "printer";
      const action = driveActionMatch[2];
      if (driveState[drive]) {
        if (action === "on") driveState[drive].enabled = true;
        if (action === "off") driveState[drive].enabled = false;
        if (action === "reset" && drive === "softiec") driveState.softiec.last_error = undefined;
      }
      json(res, 200, { errors: [] });
      return;
    }

    if (method === "PUT" && parsed.pathname.match(/^\/v1\/drives\/[ab]:set_mode$/)) {
      const drive = parsed.pathname.includes("/a:") ? "a" : "b";
      const mode = parsed.searchParams.get("mode");
      if (mode) {
        driveState[drive].type = mode;
        driveState[drive].rom = `${mode}.rom`;
      }
      json(res, 200, { errors: [] });
      return;
    }

    const driveMountMatch = parsed.pathname.match(/^\/v1\/drives\/([ab]):mount$/);
    if (driveMountMatch && (method === "PUT" || method === "POST")) {
      const drive = driveMountMatch[1] as "a" | "b";
      if (method === "PUT") {
        const image = parsed.searchParams.get("image") ?? "upload.d64";
        const normalized = image.startsWith("/") ? image : `/${image}`;
        const parts = normalized.split("/").filter(Boolean);
        driveState[drive].image_file = parts[parts.length - 1];
        driveState[drive].image_path = parts.length > 1 ? `/${parts.slice(0, -1).join("/")}` : "/";
      } else {
        driveState[drive].image_file = "upload.d64";
        driveState[drive].image_path = "/";
      }
      json(res, 200, { errors: [] });
      return;
    }

    const driveRemoveMatch = parsed.pathname.match(/^\/v1\/drives\/([ab]):remove$/);
    if (driveRemoveMatch && method === "PUT") {
      const drive = driveRemoveMatch[1] as "a" | "b";
      delete driveState[drive].image_file;
      delete driveState[drive].image_path;
      json(res, 200, { errors: [] });
      return;
    }

    if (
      [
        "/v1/runners:sidplay",
        "/v1/runners:modplay",
        "/v1/runners:load_prg",
        "/v1/runners:run_prg",
        "/v1/runners:run_crt",
        "/v1/machine:writemem",
      ].includes(parsed.pathname) &&
      (method === "POST" || method === "PUT")
    ) {
      json(res, 200, { errors: [] });
      return;
    }

    if (parsed.pathname.match(/^\/v1\/files\/.*:create_d(64|71|81|np)$/) && method === "PUT") {
      json(res, 200, { errors: [] });
      return;
    }

    json(res, 404, { errors: ["Not found"] });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Mock REST server failed to start");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function shouldInjectBreakpointFailure(input: {
  failure?: MockRestServerOptions["breakpointFailure"];
  method: string;
  path: string;
}): boolean {
  if (!input.failure) {
    return false;
  }
  const methodMatch =
    !input.failure.methods || input.failure.methods.length === 0 || input.failure.methods.includes(input.method);
  const pathMatch = !input.failure.pathIncludes || input.path.includes(input.failure.pathIncludes);
  return methodMatch && pathMatch;
}
