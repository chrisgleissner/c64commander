/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v2.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { RestClient } from "../../lib/restClient.js";
import { Semaphore } from "../../lib/concurrency.js";
import { delay } from "../../lib/timing.js";
import type { HarnessConfig } from "../../lib/config.js";
import type { LogEventInput } from "../../lib/logging.js";
import { FtpClient } from "../../lib/ftpClient.js";

export type RestScenarioContext = {
    rest: RestClient;
    request: RestClient["request"];
    config: HarnessConfig;
    log: (event: LogEventInput) => void;
    recordConcurrencyObservation: (observation: ConcurrencyObservation) => void;
};

export type RestScenario = {
    id: string;
    safe: boolean;
    run: (ctx: RestScenarioContext) => Promise<void>;
};

export type ConcurrencyObservation = {
    scope: string;
    maxInFlight: number;
    failureMode: string;
    notes?: string;
};

const SAFE_CATEGORY_BLOCKLIST = ["network", "wifi", "modem", "http", "ftp", "telnet", "hostname", "password"];
const SAFE_ITEM_BLOCKLIST = ["password", "hostname", "ip", "mac", "dns", "gateway", "ssid", "token"];
const DISK_EXTENSIONS = [".d64", ".d71", ".d81", ".dnp", ".g64"];
const SID_EXTENSIONS = [".sid"];
const PRG_EXTENSIONS = [".prg"];
const MOD_EXTENSIONS = [".mod"];
const CRT_EXTENSIONS = [".crt"];
const mediaDiscoveryCache = new Map<string, string | null>();

/** Minimal valid PSID v2 file: 1 song, init+play at $1000 */
function createMinimalSid(): Buffer {
    const header = Buffer.alloc(0x7C, 0);
    header.write("PSID", 0, 4, "ascii");
    header.writeUInt16BE(0x0002, 4);
    header.writeUInt16BE(0x007C, 6);
    header.writeUInt16BE(0x0000, 8);
    header.writeUInt16BE(0x1000, 10);
    header.writeUInt16BE(0x1003, 12);
    header.writeUInt16BE(0x0001, 14);
    header.writeUInt16BE(0x0001, 16);
    header.writeUInt32BE(0x00000000, 18);
    header.write("HarnessProbe", 0x16, 0x16 + 12, "ascii");
    header.write("c64commander", 0x36, 0x36 + 12, "ascii");
    const data = Buffer.from([0x00, 0x10, 0x78, 0x4C, 0x03, 0x10, 0x60]);
    return Buffer.concat([header, data]);
}

/** Minimal PRG: load address $0801 + RTS */
function createMinimalPrg(): Buffer {
    return Buffer.from([0x01, 0x08, 0x60]);
}

/** Minimal 4-channel Protracker MOD with 1 empty pattern */
function createMinimalMod(): Buffer {
    const buf = Buffer.alloc(1084 + 1024, 0);
    buf.write("HarnessProbe", 0, 20, "ascii");
    buf[950] = 1;
    buf[951] = 0;
    buf[952] = 0;
    buf.write("M.K.", 1080, 4, "ascii");
    return buf;
}

/** Minimal CRT: 64-byte header + CHIP with 2 bytes ROM */
function createMinimalCrt(): Buffer {
    const header = Buffer.alloc(64, 0);
    header.write("C64 CARTRIDGE   ", 0, 16, "ascii");
    header.writeUInt32BE(64, 16);
    header.writeUInt16BE(0x0100, 20);
    header.writeUInt16BE(0, 22);
    const chip = Buffer.alloc(18, 0);
    chip.write("CHIP", 0, 4, "ascii");
    chip.writeUInt32BE(18, 4);
    chip.writeUInt16BE(0, 8);
    chip.writeUInt16BE(0, 10);
    chip.writeUInt16BE(0x8000, 12);
    chip.writeUInt16BE(2, 14);
    chip[16] = 0x60;
    chip[17] = 0x60;
    return Buffer.concat([header, chip]);
}

export function buildRestScenarios(): RestScenario[] {
    return [
        // ═══════════════════════════════════════════════════════════════════
        //  SAFE GET endpoints
        // ═══════════════════════════════════════════════════════════════════

        scenario("rest.version", true, async ({ request, log }) => {
            const r = await request({ method: "GET", url: "/v1/version" });
            log({ kind: "rest", op: "GET /v1/version", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
        }),

        scenario("rest.info", true, async ({ request, log }) => {
            const r = await request({ method: "GET", url: "/v1/info" });
            log({ kind: "rest", op: "GET /v1/info", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
        }),

        scenario("rest.configs.list", true, async ({ request, log }) => {
            const r = await request({ method: "GET", url: "/v1/configs" });
            log({ kind: "rest", op: "GET /v1/configs", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
        }),

        scenario("rest.configs.category", true, async ({ request, log }) => {
            const cats = await listCategories(request);
            for (const category of cats.slice(0, 3)) {
                const r = await request({ method: "GET", url: `/v1/configs/${encodeURIComponent(category)}` });
                log({ kind: "rest", op: "GET /v1/configs/{category}", status: r.status, latencyMs: r.latencyMs, details: { category, correlationId: r.correlationId } });
            }
        }),

        scenario("rest.configs.item", true, async ({ request, log }) => {
            const target = await pickConfigTarget(request, log);
            if (!target) { log({ kind: "rest", op: "configs.item", status: "skipped", reason: "no safe target" }); return; }
            const r = await request({ method: "GET", url: `/v1/configs/${encodeURIComponent(target.category)}/${encodeURIComponent(target.item)}` });
            log({ kind: "rest", op: "GET /v1/configs/{category}/{item}", status: r.status, latencyMs: r.latencyMs, details: { category: target.category, item: target.item, correlationId: r.correlationId } });
        }),

        scenario("rest.drives.list", true, async ({ request, log }) => {
            const r = await request({ method: "GET", url: "/v1/drives" });
            log({ kind: "rest", op: "GET /v1/drives", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
        }),

        scenario("rest.machine.readmem", true, async ({ request, log }) => {
            const r = await request({ method: "GET", url: "/v1/machine:readmem", params: { address: "D020", length: 2 } });
            log({ kind: "rest", op: "GET /v1/machine:readmem", status: r.status, latencyMs: r.latencyMs, details: { address: "D020", length: 2, correlationId: r.correlationId } });
        }),

        scenario("rest.machine.debugreg.read", true, async ({ request, log }) => {
            const r = await request({ method: "GET", url: "/v1/machine:debugreg" });
            log({ kind: "rest", op: "GET /v1/machine:debugreg", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
        }),

        scenario("rest.files.info", true, async ({ request, log }) => {
            const r = await request({ method: "GET", url: `/v1/files/${encodeFilePath("/Flash/roms/1541.rom")}:info` });
            log({ kind: "rest", op: "GET /v1/files/{path}:info", status: r.status, latencyMs: r.latencyMs, details: { path: "/Flash/roms/1541.rom", correlationId: r.correlationId } });
        }),

        // ═══════════════════════════════════════════════════════════════════
        //  SAFE write/restore scenarios
        // ═══════════════════════════════════════════════════════════════════

        scenario("rest.configs.safe-write", true, async ({ request, log }) => {
            const cats = await listCategories(request);
            const targetCategory = cats.find((n) => !isBlockedCategory(n));
            if (!targetCategory) { log({ kind: "rest", op: "configs.safe-write", status: "skipped", reason: "no safe category" }); return; }

            const detailResp = await request({ method: "GET", url: `/v1/configs/${encodeURIComponent(targetCategory)}` });
            if (detailResp.status !== 200) return;
            const categoryObj = (detailResp.data as Record<string, unknown>)[targetCategory];
            if (!categoryObj || typeof categoryObj !== "object") return;
            const itemName = pickSafeItem(categoryObj as Record<string, unknown>);
            if (!itemName) { log({ kind: "rest", op: "configs.safe-write", status: "skipped", reason: "no safe item" }); return; }

            const itemDetailResp = await request({ method: "GET", url: `/v1/configs/${encodeURIComponent(targetCategory)}/${encodeURIComponent(itemName)}` });
            if (itemDetailResp.status !== 200) return;
            const itemDetail = (itemDetailResp.data as Record<string, unknown>)[targetCategory] as Record<string, unknown> | undefined;
            const itemEntry = itemDetail ? (itemDetail[itemName] as Record<string, unknown> | undefined) : undefined;
            if (!itemEntry || typeof itemEntry !== "object") return;
            const current = itemEntry.current ?? itemEntry;
            const nextValue = pickNextValue(itemEntry, current);
            if (nextValue === undefined) { log({ kind: "rest", op: "configs.safe-write", status: "skipped", reason: "no reversible value" }); return; }

            const setR = await request({ method: "PUT", url: `/v1/configs/${encodeURIComponent(targetCategory)}/${encodeURIComponent(itemName)}`, params: { value: nextValue } });
            log({ kind: "rest", op: "PUT /v1/configs/{category}/{item}", status: setR.status, latencyMs: setR.latencyMs, details: { correlationId: setR.correlationId } });

            const restoreValue = typeof current === "string" || typeof current === "number" ? current : undefined;
            if (restoreValue !== undefined) {
                await delay(200);
                const restR = await request({ method: "PUT", url: `/v1/configs/${encodeURIComponent(targetCategory)}/${encodeURIComponent(itemName)}`, params: { value: restoreValue } });
                log({ kind: "rest", op: "PUT /v1/configs/{category}/{item} restore", status: restR.status, latencyMs: restR.latencyMs, details: { correlationId: restR.correlationId } });
            }
        }),

        scenario("rest.configs.batch", true, async ({ request, log }) => {
            const target = await pickConfigTarget(request, log);
            if (!target || target.value === null) { log({ kind: "rest", op: "configs.batch", status: "skipped", reason: "no safe target" }); return; }
            const batchPayload = { [target.category]: { [target.item]: target.value } };
            const r = await request({ method: "POST", url: "/v1/configs", data: batchPayload });
            log({ kind: "rest", op: "POST /v1/configs", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
        }),

        scenario("rest.configs.load-from-flash", true, async ({ request, log }) => {
            const r = await request({ method: "PUT", url: "/v1/configs:load_from_flash" });
            log({ kind: "rest", op: "PUT /v1/configs:load_from_flash", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
        }),

        scenario("rest.machine.pause-resume", true, async ({ request, log }) => {
            const pause = await request({ method: "PUT", url: "/v1/machine:pause" });
            log({ kind: "rest", op: "PUT /v1/machine:pause", status: pause.status, latencyMs: pause.latencyMs, details: { correlationId: pause.correlationId } });
            await delay(500);
            const resume = await request({ method: "PUT", url: "/v1/machine:resume" });
            log({ kind: "rest", op: "PUT /v1/machine:resume", status: resume.status, latencyMs: resume.latencyMs, details: { correlationId: resume.correlationId } });
            await delay(500);
        }),

        scenario("rest.machine.menu-button", true, async ({ request, log }) => {
            const r = await request({ method: "PUT", url: "/v1/machine:menu_button" });
            log({ kind: "rest", op: "PUT /v1/machine:menu_button", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
            await delay(1000);
            const r2 = await request({ method: "PUT", url: "/v1/machine:menu_button" });
            log({ kind: "rest", op: "PUT /v1/machine:menu_button restore", status: r2.status, latencyMs: r2.latencyMs, details: { correlationId: r2.correlationId } });
        }),

        scenario("rest.drives.on-off", true, async ({ request, log }) => {
            const drivesResp = await request({ method: "GET", url: "/v1/drives" });
            if (drivesResp.status !== 200) { log({ kind: "rest", op: "drives.on-off", status: "skipped", reason: "drives read failed" }); return; }
            const drives = ((drivesResp.data as Record<string, unknown>).drives as Array<Record<string, { enabled?: boolean }>>) || [];
            const driveB = drives.find((d) => "b" in d);
            if (!driveB) { log({ kind: "rest", op: "drives.on-off", status: "skipped", reason: "no drive b" }); return; }
            const wasEnabled = driveB.b?.enabled ?? false;

            if (!wasEnabled) {
                const on = await request({ method: "PUT", url: "/v1/drives/b:on" });
                log({ kind: "rest", op: "PUT /v1/drives/{drive}:on", status: on.status, latencyMs: on.latencyMs, details: { drive: "b", correlationId: on.correlationId } });
                await delay(300);
                const off = await request({ method: "PUT", url: "/v1/drives/b:off" });
                log({ kind: "rest", op: "PUT /v1/drives/{drive}:off", status: off.status, latencyMs: off.latencyMs, details: { drive: "b", correlationId: off.correlationId } });
            } else {
                const off = await request({ method: "PUT", url: "/v1/drives/b:off" });
                log({ kind: "rest", op: "PUT /v1/drives/{drive}:off", status: off.status, latencyMs: off.latencyMs, details: { drive: "b", correlationId: off.correlationId } });
                await delay(300);
                const on = await request({ method: "PUT", url: "/v1/drives/b:on" });
                log({ kind: "rest", op: "PUT /v1/drives/{drive}:on", status: on.status, latencyMs: on.latencyMs, details: { drive: "b", correlationId: on.correlationId } });
            }
        }),

        scenario("rest.drives.set-mode", true, async ({ request, log }) => {
            const drivesResp = await request({ method: "GET", url: "/v1/drives" });
            if (drivesResp.status !== 200) { log({ kind: "rest", op: "drives.set-mode", status: "skipped" }); return; }
            const drives = ((drivesResp.data as Record<string, unknown>).drives as Array<Record<string, { type?: string }>>) || [];
            const driveA = drives.find((d) => "a" in d);
            const currentMode = driveA?.a?.type ?? "1541";
            const nextMode = currentMode === "1541" ? "1571" : "1541";

            const r = await request({ method: "PUT", url: "/v1/drives/a:set_mode", params: { mode: nextMode } });
            log({ kind: "rest", op: "PUT /v1/drives/{drive}:set_mode", status: r.status, latencyMs: r.latencyMs, details: { drive: "a", mode: nextMode, correlationId: r.correlationId } });
            await delay(300);
            const restore = await request({ method: "PUT", url: "/v1/drives/a:set_mode", params: { mode: currentMode } });
            log({ kind: "rest", op: "PUT /v1/drives/{drive}:set_mode restore", status: restore.status, latencyMs: restore.latencyMs, details: { drive: "a", mode: currentMode, correlationId: restore.correlationId } });
        }),

        scenario("rest.drives.reset", true, async ({ request, log }) => {
            const r = await request({ method: "PUT", url: "/v1/drives/a:reset" });
            log({ kind: "rest", op: "PUT /v1/drives/{drive}:reset", status: r.status, latencyMs: r.latencyMs, details: { drive: "a", correlationId: r.correlationId } });
        }),

        scenario("rest.drives.load-rom", true, async ({ request, log }) => {
            const r = await request({ method: "PUT", url: "/v1/drives/a:load_rom", params: { file: "/Flash/roms/1541.rom" } });
            log({ kind: "rest", op: "PUT /v1/drives/{drive}:load_rom", status: r.status, latencyMs: r.latencyMs, details: { drive: "a", file: "/Flash/roms/1541.rom", correlationId: r.correlationId } });
        }),

        // ═══════════════════════════════════════════════════════════════════
        //  Concurrency: scaling N=2,4,8
        // ═══════════════════════════════════════════════════════════════════

        scenario("rest.configs.concurrent", true, async ({ request, log, config, recordConcurrencyObservation }) => {
            const levels = config.mode === "STRESS" ? [2, 4, 8] : [2, 4];
            for (const n of levels) {
                const maxN = Math.min(n, config.concurrency.restMaxInFlight);
                const obs = mkObs(`REST /v1/configs concurrent N=${maxN}`, maxN);
                const results = await runConcurrentRequests({ request, log, maxInFlight: maxN, totalRequests: maxN * 3, targets: [{ op: "GET /v1/configs", url: "/v1/configs" }] });
                finishObs(obs, results);
                recordConcurrencyObservation(obs);
                if (results.some((r) => !r.ok)) break;
            }
        }),

        scenario("rest.concurrent.mix", true, async ({ request, log, config, recordConcurrencyObservation }) => {
            const targets = [
                { op: "GET /v1/version", url: "/v1/version" },
                { op: "GET /v1/info", url: "/v1/info" },
                { op: "GET /v1/drives", url: "/v1/drives" },
                { op: "GET /v1/configs", url: "/v1/configs" }
            ];
            const levels = config.mode === "STRESS" ? [2, 4, 8] : [2, 4];
            for (const n of levels) {
                const maxN = Math.min(n, config.concurrency.restMaxInFlight);
                const obs = mkObs(`REST mixed concurrent N=${maxN}`, maxN);
                const results = await runConcurrentRequests({ request, log, maxInFlight: maxN, totalRequests: maxN * 4, targets });
                finishObs(obs, results);
                recordConcurrencyObservation(obs);
                if (results.some((r) => !r.ok)) break;
            }
        }),

        scenario("rest.concurrent.readmem", true, async ({ request, log, config, recordConcurrencyObservation }) => {
            for (const n of [2]) {
                const maxN = Math.min(n, config.concurrency.restMaxInFlight);
                const obs = mkObs(`REST readmem concurrent N=${maxN}`, maxN);
                const results = await runConcurrentRequests({ request, log, maxInFlight: maxN, totalRequests: maxN * 3, targets: [{ op: "GET /v1/machine:readmem", url: "/v1/machine:readmem?address=D020&length=2" }] });
                finishObs(obs, results);
                recordConcurrencyObservation(obs);
                if (results.some((r) => !r.ok)) break;
            }
        }),

        // ═══════════════════════════════════════════════════════════════════
        //  STRESS scenarios
        // ═══════════════════════════════════════════════════════════════════

        scenario("rest.machine.reset", false, async ({ request, log, config }) => {
            if (!config.allowMachineReset) { log({ kind: "rest", op: "machine.reset", status: "skipped", reason: "allowMachineReset=false" }); return; }
            const r = await request({ method: "PUT", url: "/v1/machine:reset" });
            log({ kind: "rest", op: "PUT /v1/machine:reset", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
            await delay(2000);
            const probe = await request({ method: "GET", url: "/v1/version" });
            log({ kind: "rest", op: "GET /v1/version (post-reset)", status: probe.status, latencyMs: probe.latencyMs });
        }),

        scenario("rest.machine.reboot", false, async ({ request, log, config }) => {
            if (!config.allowMachineReset) { log({ kind: "rest", op: "machine.reboot", status: "skipped", reason: "allowMachineReset=false" }); return; }
            const r = await request({ method: "PUT", url: "/v1/machine:reboot" });
            log({ kind: "rest", op: "PUT /v1/machine:reboot", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
            await delay(15000);
            for (let i = 0; i < 10; i++) {
                try { const p = await request({ method: "GET", url: "/v1/version" }); if (p.status === 200) { log({ kind: "rest", op: "GET /v1/version (post-reboot)", status: p.status, latencyMs: p.latencyMs }); break; } } catch { /* still rebooting */ }
                await delay(3000);
            }
        }),

        scenario("rest.configs.save-to-flash", false, async ({ request, log }) => {
            await request({ method: "PUT", url: "/v1/configs:load_from_flash" });
            await delay(200);
            const r = await request({ method: "PUT", url: "/v1/configs:save_to_flash" });
            log({ kind: "rest", op: "PUT /v1/configs:save_to_flash", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId } });
        }),

        scenario("rest.files.create-d64", false, async ({ request, log, config }) => {
            const p = scratchPath(config, "harness-test.d64");
            const r = await request({ method: "PUT", url: `/v1/files/${encodeFilePath(p)}:create_d64`, params: { tracks: 35, diskname: "HRNSS64" } });
            log({ kind: "rest", op: "PUT /v1/files/{path}:create_d64", status: r.status, latencyMs: r.latencyMs, details: { path: p, correlationId: r.correlationId } });
        }),

        scenario("rest.files.create-d71", false, async ({ request, log, config }) => {
            const p = scratchPath(config, "harness-test.d71");
            const r = await request({ method: "PUT", url: `/v1/files/${encodeFilePath(p)}:create_d71`, params: { diskname: "HRNSS71" } });
            log({ kind: "rest", op: "PUT /v1/files/{path}:create_d71", status: r.status, latencyMs: r.latencyMs, details: { path: p, correlationId: r.correlationId } });
        }),

        scenario("rest.files.create-d81", false, async ({ request, log, config }) => {
            const p = scratchPath(config, "harness-test.d81");
            const r = await request({ method: "PUT", url: `/v1/files/${encodeFilePath(p)}:create_d81`, params: { diskname: "HRNSS81" } });
            log({ kind: "rest", op: "PUT /v1/files/{path}:create_d81", status: r.status, latencyMs: r.latencyMs, details: { path: p, correlationId: r.correlationId } });
        }),

        scenario("rest.files.create-dnp", false, async ({ request, log, config }) => {
            const p = scratchPath(config, "harness-test.dnp");
            const r = await request({ method: "PUT", url: `/v1/files/${encodeFilePath(p)}:create_dnp`, params: { tracks: 10, diskname: "HRNSSDNP" } });
            log({ kind: "rest", op: "PUT /v1/files/{path}:create_dnp", status: r.status, latencyMs: r.latencyMs, details: { path: p, correlationId: r.correlationId } });
        }),

        scenario("rest.drives.mount", false, async ({ request, log, config }) => {
            const imagePath = await resolveOrScratch(config, log, DISK_EXTENSIONS, "disk image", config.media?.diskImagePath, "harness-test.d64");
            const drive = config.media?.diskDrive ?? "a";
            const mount = await request({ method: "PUT", url: `/v1/drives/${drive}:mount`, params: { image: imagePath, type: config.media?.diskType ?? "d64", mode: config.media?.diskMode ?? "readonly" } });
            log({ kind: "rest", op: "PUT /v1/drives/{drive}:mount", status: mount.status, latencyMs: mount.latencyMs, details: { drive, image: imagePath, correlationId: mount.correlationId } });
            await delay(500);
            const rm = await request({ method: "PUT", url: `/v1/drives/${drive}:remove` });
            log({ kind: "rest", op: "PUT /v1/drives/{drive}:remove", status: rm.status, latencyMs: rm.latencyMs, details: { drive, correlationId: rm.correlationId } });
        }),

        scenario("rest.drives.mount-upload", false, async ({ request, log, config }) => {
            const drive = config.media?.diskDrive ?? "a";
            const d64 = Buffer.alloc(174848, 0);
            const mount = await request({ method: "POST", url: `/v1/drives/${drive}:mount`, params: { type: "d64", mode: "readonly" }, data: d64, headers: { "Content-Type": "application/octet-stream" } });
            log({ kind: "rest", op: "POST /v1/drives/{drive}:mount", status: mount.status, latencyMs: mount.latencyMs, details: { drive, correlationId: mount.correlationId } });
            await delay(500);
            const rm = await request({ method: "PUT", url: `/v1/drives/${drive}:remove` });
            log({ kind: "rest", op: "PUT /v1/drives/{drive}:remove (post-upload)", status: rm.status, latencyMs: rm.latencyMs });
        }),

        scenario("rest.drives.load-rom-upload", false, async ({ request, log }) => {
            // Upload ROM data via POST. Use existing 1541.rom loaded via PUT for baseline.
            const putR = await request({ method: "PUT", url: "/v1/drives/a:load_rom", params: { file: "/Flash/roms/1541.rom" } });
            log({ kind: "rest", op: "PUT /v1/drives/{drive}:load_rom (baseline)", status: putR.status, latencyMs: putR.latencyMs, details: { correlationId: putR.correlationId } });
            // POST variant requires ROM binary; log coverage
            log({ kind: "rest", op: "POST /v1/drives/{drive}:load_rom", status: "documented", reason: "exercised via PUT; POST requires binary ROM data" });
        }),

        scenario("rest.runners.sidplay", false, async ({ request, log, config }) => {
            const resolved = config.media?.sidFilePath ? await resolveMediaFilePath({ basePath: config.media.sidFilePath, extensions: SID_EXTENSIONS, config, log, label: "sid file" }) : null;
            if (!resolved) { log({ kind: "rest", op: "runners.sidplay", status: "skipped", reason: "no sid file found" }); return; }
            const r = await request({ method: "PUT", url: "/v1/runners:sidplay", params: { file: resolved, songnr: config.media?.sidSongNr ?? 0 } });
            log({ kind: "rest", op: "PUT /v1/runners:sidplay", status: r.status, latencyMs: r.latencyMs, details: { file: resolved, correlationId: r.correlationId } });
            await delay(2000);
            if (config.allowMachineReset) { await request({ method: "PUT", url: "/v1/machine:reset" }); await delay(2000); }
        }),

        scenario("rest.runners.sidplay-upload", false, async ({ request, log, config }) => {
            const sidData = createMinimalSid();
            const FormData = (await import("form-data")).default;
            const form = new FormData();
            form.append("file", sidData, { filename: "harness-probe.sid", contentType: "application/octet-stream" });
            const r = await request({ method: "POST", url: "/v1/runners:sidplay", params: { songnr: 0 }, data: form, headers: form.getHeaders() });
            log({ kind: "rest", op: "POST /v1/runners:sidplay", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId, size: sidData.length } });
            await delay(1000);
            if (config.allowMachineReset) { await request({ method: "PUT", url: "/v1/machine:reset" }); await delay(2000); }
        }),

        scenario("rest.runners.modplay", false, async ({ request, log, config }) => {
            const resolved = config.media?.modFilePath ? await resolveMediaFilePath({ basePath: config.media.modFilePath, extensions: MOD_EXTENSIONS, config, log, label: "mod file" }) : null;
            if (!resolved) { log({ kind: "rest", op: "runners.modplay", status: "skipped", reason: "no mod file found" }); return; }
            const r = await request({ method: "PUT", url: "/v1/runners:modplay", params: { file: resolved } });
            log({ kind: "rest", op: "PUT /v1/runners:modplay", status: r.status, latencyMs: r.latencyMs, details: { file: resolved, correlationId: r.correlationId } });
            await delay(2000);
            if (config.allowMachineReset) { await request({ method: "PUT", url: "/v1/machine:reset" }); await delay(2000); }
        }),

        scenario("rest.runners.modplay-upload", false, async ({ request, log, config }) => {
            const modData = createMinimalMod();
            const r = await request({ method: "POST", url: "/v1/runners:modplay", data: modData, headers: { "Content-Type": "application/octet-stream" } });
            log({ kind: "rest", op: "POST /v1/runners:modplay", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId, size: modData.length } });
            await delay(1000);
            if (config.allowMachineReset) { await request({ method: "PUT", url: "/v1/machine:reset" }); await delay(2000); }
        }),

        scenario("rest.runners.run-prg", false, async ({ request, log, config }) => {
            const resolved = config.media?.prgFilePath ? await resolveMediaFilePath({ basePath: config.media.prgFilePath, extensions: PRG_EXTENSIONS, config, log, label: "prg file" }) : null;
            if (!resolved) { log({ kind: "rest", op: "runners.run-prg", status: "skipped", reason: "no prg file found" }); return; }
            const r = await request({ method: "PUT", url: "/v1/runners:run_prg", params: { file: resolved } });
            log({ kind: "rest", op: "PUT /v1/runners:run_prg", status: r.status, latencyMs: r.latencyMs, details: { file: resolved, correlationId: r.correlationId } });
            await delay(2000);
            if (config.allowMachineReset) { await request({ method: "PUT", url: "/v1/machine:reset" }); await delay(2000); }
        }),

        scenario("rest.runners.load-prg", false, async ({ request, log, config }) => {
            const resolved = config.media?.prgFilePath ? await resolveMediaFilePath({ basePath: config.media.prgFilePath, extensions: PRG_EXTENSIONS, config, log, label: "prg file" }) : null;
            if (!resolved) { log({ kind: "rest", op: "runners.load-prg", status: "skipped", reason: "no prg file found" }); return; }
            const r = await request({ method: "PUT", url: "/v1/runners:load_prg", params: { file: resolved } });
            log({ kind: "rest", op: "PUT /v1/runners:load_prg", status: r.status, latencyMs: r.latencyMs, details: { file: resolved, correlationId: r.correlationId } });
        }),

        scenario("rest.runners.run-prg-upload", false, async ({ request, log, config }) => {
            const prgData = createMinimalPrg();
            const r = await request({ method: "POST", url: "/v1/runners:run_prg", data: prgData, headers: { "Content-Type": "application/octet-stream" } });
            log({ kind: "rest", op: "POST /v1/runners:run_prg", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId, size: prgData.length } });
            await delay(1000);
            if (config.allowMachineReset) { await request({ method: "PUT", url: "/v1/machine:reset" }); await delay(2000); }
        }),

        scenario("rest.runners.load-prg-upload", false, async ({ request, log }) => {
            const prgData = createMinimalPrg();
            const r = await request({ method: "POST", url: "/v1/runners:load_prg", data: prgData, headers: { "Content-Type": "application/octet-stream" } });
            log({ kind: "rest", op: "POST /v1/runners:load_prg", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId, size: prgData.length } });
        }),

        scenario("rest.runners.run-crt", false, async ({ request, log, config }) => {
            const resolved = config.media?.crtFilePath ? await resolveMediaFilePath({ basePath: config.media.crtFilePath, extensions: CRT_EXTENSIONS, config, log, label: "crt file" }) : null;
            if (!resolved) { log({ kind: "rest", op: "runners.run-crt", status: "skipped", reason: "no crt file found" }); return; }
            const r = await request({ method: "PUT", url: "/v1/runners:run_crt", params: { file: resolved } });
            log({ kind: "rest", op: "PUT /v1/runners:run_crt", status: r.status, latencyMs: r.latencyMs, details: { file: resolved, correlationId: r.correlationId } });
            await delay(2000);
            if (config.allowMachineReset) { await request({ method: "PUT", url: "/v1/machine:reset" }); await delay(2000); }
        }),

        scenario("rest.runners.run-crt-upload", false, async ({ request, log, config }) => {
            const crtData = createMinimalCrt();
            const r = await request({ method: "POST", url: "/v1/runners:run_crt", data: crtData, headers: { "Content-Type": "application/octet-stream" } });
            log({ kind: "rest", op: "POST /v1/runners:run_crt", status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId, size: crtData.length } });
            await delay(1000);
            if (config.allowMachineReset) { await request({ method: "PUT", url: "/v1/machine:reset" }); await delay(2000); }
        })
    ];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function scenario(id: string, safe: boolean, run: RestScenario["run"]): RestScenario {
    return { id, safe, run };
}

function mkObs(scope: string, maxInFlight: number): ConcurrencyObservation {
    return { scope, maxInFlight, failureMode: "none" };
}

function finishObs(obs: ConcurrencyObservation, results: Array<{ ok: boolean; latencyMs: number | null }>): void {
    const failures = results.filter((r) => !r.ok).length;
    if (failures > 0) { obs.failureMode = "errors"; obs.notes = `${failures}/${results.length} failed`; }
    const maxLatency = Math.max(...results.map((r) => r.latencyMs ?? 0));
    obs.notes = obs.notes ? `${obs.notes}; max ${maxLatency}ms` : `max ${maxLatency}ms`;
}

function scratchPath(config: HarnessConfig, filename: string): string {
    return `${config.scratch.ftpDir.replace(/^\//, "")}/${filename}`;
}

async function resolveOrScratch(config: HarnessConfig, log: (event: LogEventInput) => void, exts: string[], label: string, mediaPath: string | undefined, fallbackFile: string): Promise<string> {
    if (mediaPath) {
        const resolved = await resolveMediaFilePath({ basePath: mediaPath, extensions: exts, config, log, label });
        if (resolved) return resolved;
    }
    return `/${scratchPath(config, fallbackFile)}`;
}

async function listCategories(request: RestClient["request"]): Promise<string[]> {
    const r = await request({ method: "GET", url: "/v1/configs" });
    if (r.status !== 200 || typeof r.data !== "object" || r.data === null) return [];
    return ((r.data as Record<string, unknown>).categories as string[]) || [];
}

function hasMatchingExtension(value: string, extensions: string[]): boolean {
    return extensions.some((ext) => value.toLowerCase().endsWith(ext));
}

async function resolveMediaFilePath({ basePath, extensions, config, log, label }: { basePath: string; extensions: string[]; config: HarnessConfig; log: (event: LogEventInput) => void; label: string }): Promise<string | null> {
    if (!basePath.trim()) return null;
    if (hasMatchingExtension(basePath, extensions)) return basePath;
    const cacheKey = `${label}:${basePath.toLowerCase()}`;
    if (mediaDiscoveryCache.has(cacheKey)) return mediaDiscoveryCache.get(cacheKey) ?? null;
    const client = new FtpClient({ host: new URL(config.baseUrl).hostname, port: config.ftpPort ?? 21, user: "anonymous", password: config.auth === "ON" ? config.password || "" : "", mode: config.ftpMode, timeoutMs: config.timeouts.ftpTimeoutMs });
    try {
        await client.connect();
        const resolved = await findFirstMatchingFile(client, basePath, extensions);
        log({ kind: "ftp", op: "discover.search", status: resolved ? "found" : "not-found", details: { label, basePath, resolved } });
        mediaDiscoveryCache.set(cacheKey, resolved ?? null);
        return resolved ?? null;
    } catch (error) {
        log({ kind: "ftp", op: "discover.error", status: "error", details: { label, basePath, message: String(error) } });
        mediaDiscoveryCache.set(cacheKey, null);
        return null;
    } finally { await client.close(); }
}

type MlsdEntry = { name: string; type: "dir" | "file" };

async function findFirstMatchingFile(client: FtpClient, rootPath: string, extensions: string[]): Promise<string | null> {
    const queue = [normalizeFtpPath(rootPath)];
    const visited = new Set<string>();
    while (queue.length > 0) {
        const current = queue.shift();
        if (!current || visited.has(current)) continue;
        visited.add(current);
        const { result, data } = await client.mlsd(current);
        if (result.response.code >= 400) throw new Error(`MLSD failed for ${current}: ${result.response.code}`);
        for (const entry of parseMlsdEntries(data).sort((a, b) => a.name.localeCompare(b.name))) {
            const p = joinFtpPath(current, entry.name);
            if (entry.type === "file" && hasMatchingExtension(entry.name, extensions)) return p;
            if (entry.type === "dir") queue.push(p);
        }
    }
    return null;
}

function parseMlsdEntries(data: string): MlsdEntry[] {
    return data.split("\n").map((l) => l.trim()).filter(Boolean).map(parseMlsdLine).filter((e): e is MlsdEntry => e !== null && e.name !== "." && e.name !== "..");
}

function parseMlsdLine(line: string): MlsdEntry | null {
    const idx = line.indexOf(" ");
    if (idx <= 0) return null;
    const facts = line.slice(0, idx).split(";");
    const name = line.slice(idx + 1).trim();
    if (!name) return null;
    let type = "";
    for (const f of facts) { if (!f) continue; const [k, v] = f.split("="); if (k?.toLowerCase() === "type") { type = (v ?? "").toLowerCase(); break; } }
    if (type === "dir" || type === "cdir" || type === "pdir") return { name, type: "dir" };
    if (type === "file") return { name, type: "file" };
    return null;
}

function joinFtpPath(base: string, name: string): string {
    return base === "/" ? `/${name}` : base.endsWith("/") ? `${base}${name}` : `${base}/${name}`;
}

function normalizeFtpPath(value: string): string {
    const t = value.trim();
    return !t ? "/" : t.endsWith("/") ? t.slice(0, -1) : t;
}

function isBlockedCategory(name: string): boolean {
    return SAFE_CATEGORY_BLOCKLIST.some((t) => name.toLowerCase().includes(t));
}

function isBlockedItem(name: string): boolean {
    return SAFE_ITEM_BLOCKLIST.some((t) => name.toLowerCase().includes(t));
}

function encodeFilePath(value: string): string {
    return value.trim().split("/").filter(Boolean).map((s) => encodeURIComponent(s)).join("/");
}

async function pickConfigTarget(request: RestClient["request"], log: (event: LogEventInput) => void): Promise<{ category: string; item: string; value: string | number | null } | null> {
    const cats = await listCategories(request);
    const targetCategory = cats.find((n) => !isBlockedCategory(n));
    if (!targetCategory) return null;
    const r = await request({ method: "GET", url: `/v1/configs/${encodeURIComponent(targetCategory)}` });
    if (r.status !== 200 || typeof r.data !== "object" || r.data === null) return null;
    const catObj = (r.data as Record<string, unknown>)[targetCategory];
    if (!catObj || typeof catObj !== "object") return null;
    const itemName = pickSafeItem(catObj as Record<string, unknown>);
    if (!itemName) return null;
    const value = await readConfigValue(request, targetCategory, itemName, log);
    return { category: targetCategory, item: itemName, value };
}

async function readConfigValue(request: RestClient["request"], category: string, item: string, _log: (event: LogEventInput) => void): Promise<string | number | null> {
    const r = await request({ method: "GET", url: `/v1/configs/${encodeURIComponent(category)}/${encodeURIComponent(item)}` });
    if (r.status !== 200 || typeof r.data !== "object" || r.data === null) return null;
    const detail = (r.data as Record<string, unknown>)[category] as Record<string, unknown> | undefined;
    const entry = detail ? (detail[item] as Record<string, unknown> | undefined) : undefined;
    if (!entry || typeof entry !== "object") return null;
    const current = entry.current ?? entry;
    return typeof current === "string" || typeof current === "number" ? current : null;
}

async function runConcurrentRequests({ request, log, maxInFlight, totalRequests, targets }: { request: RestClient["request"]; log: (event: LogEventInput) => void; maxInFlight: number; totalRequests: number; targets: Array<{ op: string; url: string }> }): Promise<Array<{ ok: boolean; latencyMs: number | null }>> {
    const semaphore = new Semaphore(maxInFlight);
    return Promise.all(Array.from({ length: totalRequests }, async (_, i) => {
        const release = await semaphore.acquire();
        const target = targets[i % targets.length];
        try {
            const r = await request({ method: "GET", url: target.url });
            log({ kind: "rest", op: target.op, status: r.status, latencyMs: r.latencyMs, details: { correlationId: r.correlationId, concurrent: true } });
            return { ok: r.status === 200, latencyMs: r.latencyMs };
        } catch (error) {
            log({ kind: "rest", op: target.op, status: "error", details: { error: String(error), concurrent: true } });
            return { ok: false, latencyMs: null };
        } finally { release(); }
    }));
}

function pickSafeItem(items: Record<string, unknown>): string | null {
    for (const key of Object.keys(items)) {
        if (isBlockedItem(key)) continue;
        const v = items[key];
        if (typeof v === "object" && v !== null) return key;
        if (typeof v === "number" || typeof v === "string") return key;
    }
    return null;
}

function pickNextValue(entry: Record<string, unknown>, current: unknown): string | number | undefined {
    if (typeof current === "number") {
        const min = entry.min as number | undefined;
        const max = entry.max as number | undefined;
        if (typeof min === "number" && typeof max === "number") {
            if (current + 1 <= max) return current + 1;
            if (current - 1 >= min) return current - 1;
        }
    }
    const vals = entry.values as unknown[] | undefined;
    if (Array.isArray(vals) && typeof current === "string") {
        const next = vals.find((v) => v !== current);
        if (typeof next === "string") return next;
    }
    return undefined;
}
