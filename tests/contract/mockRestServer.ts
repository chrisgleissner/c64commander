import * as http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import * as path from "node:path";
import { randomUUID } from "node:crypto";

type DriveState = {
    enabled: boolean;
    bus_id: number;
    type?: string;
    image_file?: string;
    image_path?: string;
    last_error?: string;
};

type ConfigItem = {
    value: string | number;
    min?: number;
    max?: number;
    values?: string[];
};

type ConfigState = Record<string, Record<string, ConfigItem>>;

export type MockRestServer = {
    baseUrl: string;
    close: () => Promise<void>;
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

const createDefaultConfigState = (): ConfigState => ({
    "Data Streams": {
        "Stream Audio to": { value: "off", values: ["off", "on"] },
        "Stream VIC to": { value: "239.0.1.90:11000" },
    },
    "Drive A Settings": {
        "Drive": { value: "enabled", values: ["enabled", "disabled"] },
        "Drive Bus ID": { value: 8, min: 8, max: 11 },
        "Drive Type": { value: "1541", values: ["1541", "1571"] },
    },
    "Drive B Settings": {
        "Drive": { value: "enabled", values: ["enabled", "disabled"] },
        "Drive Bus ID": { value: 9, min: 8, max: 11 },
        "Drive Type": { value: "1541", values: ["1541", "1571"] },
    },
    "Audio Mixer": {
        "Pan Socket 1": { value: "Center", values: ["Left 1", "Center", "Right 1"] },
    },
});

export async function createMockRestServer(): Promise<MockRestServer> {
    const configState: ConfigState = createDefaultConfigState();
    const driveState: Record<"a" | "b" | "softiec" | "printer", DriveState> = {
        a: { enabled: true, bus_id: 8, type: "1541" },
        b: { enabled: true, bus_id: 9, type: "1541" },
        softiec: { enabled: false, bus_id: 11, type: "DOS emulation", last_error: "73,MOCK ERROR" },
        printer: { enabled: false, bus_id: 4 },
    };

    const server = http.createServer(async (req, res) => {
        const method = req.method ?? "GET";
        const url = req.url ?? "/";
        const parsed = new URL(url, "http://127.0.0.1");

        if (method === "OPTIONS") {
            json(res, 204, {});
            return;
        }

        if (method === "GET" && parsed.pathname === "/v1/info") {
            json(res, 200, {
                product: "C64 Ultimate",
                firmware_version: "3.14",
                fpga_version: "121",
                core_version: "1.45",
                hostname: "c64u-mock",
                unique_id: "MOCK-" + randomUUID().slice(0, 8),
                errors: [],
            });
            return;
        }

        if (method === "GET" && parsed.pathname === "/v1/version") {
            json(res, 200, { version: "3.14", errors: [] });
            return;
        }

        if (method === "GET" && parsed.pathname === "/v1/drives") {
            json(res, 200, {
                drives: [
                    { a: { ...driveState.a } },
                    { b: { ...driveState.b } },
                    { "IEC Drive": { ...driveState.softiec } },
                    { "Printer Emulation": { enabled: driveState.printer.enabled, bus_id: driveState.printer.bus_id } },
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
            json(res, 200, { [category]: configState[category] ?? {}, errors: [] });
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
            json(res, 200, { [category]: { [item]: { ...entry, current: entry.value } }, errors: [] });
            return;
        }

        if (method === "POST" && parsed.pathname === "/v1/configs") {
            const body = await readBody(req);
            try {
                const payload = JSON.parse(body) as Record<string, Record<string, string | number>>;
                Object.entries(payload).forEach(([category, items]) => {
                    configState[category] = configState[category] ?? {};
                    Object.entries(items).forEach(([item, value]) => {
                        configState[category][item] = { value };
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
            json(res, 200, { path: filePath, size: 0, type: path.extname(filePath).slice(1), errors: [] });
            return;
        }

        if (method === "GET" && parsed.pathname === "/v1/machine:readmem") {
            const length = Math.max(1, Number(parsed.searchParams.get("length") || "1"));
            json(res, 200, { data: new Array(length).fill(0), errors: [] });
            return;
        }

        if (method === "GET" && parsed.pathname === "/v1/machine:debugreg") {
            json(res, 200, { registers: {}, errors: [] });
            return;
        }

        if (method === "PUT" && [
            "/v1/machine:reset",
            "/v1/machine:reboot",
            "/v1/machine:pause",
            "/v1/machine:resume",
            "/v1/machine:menu_button",
            "/v1/configs:save_to_flash",
            "/v1/configs:load_from_flash",
            "/v1/configs:reset_to_default",
        ].includes(parsed.pathname)) {
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
                if (action === "reset" && drive === "softiec") delete driveState.softiec.last_error;
            }
            json(res, 200, { errors: [] });
            return;
        }

        if (method === "PUT" && parsed.pathname.match(/^\/v1\/drives\/[ab]:set_mode$/)) {
            const drive = parsed.pathname.includes("/a:") ? "a" : "b";
            const mode = parsed.searchParams.get("mode");
            if (mode) driveState[drive].type = mode;
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
