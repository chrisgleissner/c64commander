#!/usr/bin/env node

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Writable } from 'node:stream';
import { Client as BasicFtpClient } from 'basic-ftp';

const DEFAULT_BASE_URL = process.env.C64U_BASE_URL?.trim() || 'http://c64u';
const DEFAULT_PASSWORD = process.env.C64U_PASSWORD?.trim() || '';
const SAMPLE_COUNT = Number(process.env.C64U_TIMING_SAMPLE_COUNT || '5');
const SAMPLE_DELAY_MS = Number(process.env.C64U_TIMING_SAMPLE_DELAY_MS || '900');
const MUTATION_RECOVERY_DELAY_MS = Number(process.env.C64U_TIMING_MUTATION_RECOVERY_DELAY_MS || '300');
const REQUEST_TIMEOUT_MS = Number(process.env.C64U_TIMING_REQUEST_TIMEOUT_MS || '15000');
const REBOOT_SETTLE_DELAY_MS = Number(process.env.C64U_TIMING_REBOOT_SETTLE_DELAY_MS || '2500');
const REBOOT_READY_TIMEOUT_MS = Number(process.env.C64U_TIMING_REBOOT_READY_TIMEOUT_MS || '90000');
const REBOOT_POLL_DELAY_MS = Number(process.env.C64U_TIMING_REBOOT_POLL_DELAY_MS || '1000');
const REBOOT_BEFORE_EACH_OPERATION = process.env.C64U_TIMING_REBOOT_BEFORE_EACH_OPERATION !== '0';
const SLOW_SAMPLE_THRESHOLD_MS = Number(process.env.C64U_TIMING_SLOW_SAMPLE_THRESHOLD_MS || '3000');
const VARIATION_THRESHOLD_MS = Number(process.env.C64U_TIMING_VARIATION_THRESHOLD_MS || '1500');
const COMPLETION_TIMEOUT_MS = Number(process.env.C64U_TIMING_COMPLETION_TIMEOUT_MS || '10000');
const COMPLETION_POLL_DELAY_MS = Number(process.env.C64U_TIMING_COMPLETION_POLL_DELAY_MS || '50');
const OPERATION_FILTER = process.env.C64U_TIMING_OPERATION_FILTER?.trim() || '';
const OUTPUT_PATH =
    process.env.C64U_TIMING_OUTPUT_PATH?.trim() ||
    path.resolve('doc/c64/mock-timing-calibration-2026-03-12.json');

const SAFE_CATEGORY_BLOCKLIST = ['network', 'wifi', 'modem', 'http', 'ftp', 'telnet', 'hostname', 'password'];
const SAFE_ITEM_BLOCKLIST = ['password', 'hostname', 'ip', 'mac', 'dns', 'gateway', 'ssid', 'token'];

const encodeFilePath = (value) => encodeURIComponent(value.startsWith('/') ? value : `/${value}`);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const median = (values) => {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
};

const toHexByte = (value) => value.toString(16).padStart(2, '0').toUpperCase();

function createMinimalSid() {
    const header = Buffer.alloc(0x7c, 0);
    header.write('PSID', 0, 4, 'ascii');
    header.writeUInt16BE(0x0002, 4);
    header.writeUInt16BE(0x007c, 6);
    header.writeUInt16BE(0x0000, 8);
    header.writeUInt16BE(0x1000, 10);
    header.writeUInt16BE(0x1003, 12);
    header.writeUInt16BE(0x0001, 14);
    header.writeUInt16BE(0x0001, 16);
    header.write('TimingProbe', 0x16, 0x16 + 11, 'ascii');
    header.write('c64commander', 0x36, 0x36 + 12, 'ascii');
    const data = Buffer.from([0x00, 0x10, 0x78, 0x4c, 0x03, 0x10, 0x60]);
    return Buffer.concat([header, data]);
}

function createMinimalPrg() {
    return Buffer.from([0x01, 0x08, 0x60]);
}

function createMinimalMod() {
    const buffer = Buffer.alloc(1084 + 1024, 0);
    buffer.write('TimingProbe', 0, 11, 'ascii');
    buffer[950] = 1;
    buffer.write('M.K.', 1080, 4, 'ascii');
    return buffer;
}

function createMinimalCrt() {
    const header = Buffer.alloc(64, 0);
    header.write('C64 CARTRIDGE   ', 0, 16, 'ascii');
    header.writeUInt32BE(64, 16);
    header.writeUInt16BE(0x0100, 20);
    const chip = Buffer.alloc(18, 0);
    chip.write('CHIP', 0, 4, 'ascii');
    chip.writeUInt32BE(18, 4);
    chip.writeUInt16BE(0x8000, 12);
    chip.writeUInt16BE(2, 14);
    chip[16] = 0x60;
    chip[17] = 0x60;
    return Buffer.concat([header, chip]);
}

class TimingProbe {
    constructor({ baseUrl, password }) {
        this.baseUrl = new URL(baseUrl);
        this.password = password;
        this.cachedMediaPaths = null;
        this.cachedConfigTarget = null;
        this.cachedDriveBState = null;
        this.cachedRomBytes = null;
        this.cachedDiskBytes = null;
        this.localStreamIp = null;
    }

    async request({ method, pathName, query, headers, body }) {
        const url = new URL(pathName, this.baseUrl);
        if (query) {
            Object.entries(query).forEach(([key, value]) => {
                if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
            });
        }
        const requestHeaders = new Headers(headers || {});
        if (this.password) requestHeaders.set('X-Password', this.password);
        const startedAt = performance.now();
        const response = await fetch(url, {
            method,
            headers: requestHeaders,
            body,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const latencyMs = Number((performance.now() - startedAt).toFixed(3));
        const text = await response.text();
        let json = null;
        if (text.trim()) {
            try {
                json = JSON.parse(text);
            } catch {
                json = null;
            }
        }
        if (!response.ok) {
            throw new Error(`${method} ${url.pathname}${url.search} failed with ${response.status}: ${text}`);
        }
        return { latencyMs, status: response.status, text, json, url: url.toString() };
    }

    async waitUntilReady() {
        const deadline = Date.now() + REBOOT_READY_TIMEOUT_MS;
        let stableSuccessCount = 0;

        while (Date.now() < deadline) {
            try {
                await this.request({ method: 'GET', pathName: '/v1/version' });
                stableSuccessCount += 1;
                if (stableSuccessCount >= 2) return;
            } catch {
                stableSuccessCount = 0;
            }
            await delay(REBOOT_POLL_DELAY_MS);
        }

        throw new Error(`Device did not become ready within ${REBOOT_READY_TIMEOUT_MS}ms after reboot`);
    }

    async hardRebootAndWait() {
        const startedAt = performance.now();
        try {
            await this.request({ method: 'PUT', pathName: '/v1/machine:reboot' });
        } catch (error) {
            const message = String(error);
            if (!/fetch failed|ECONNRESET|Connection reset|socket hang up|aborted/i.test(message)) {
                throw error;
            }
        }

        await delay(REBOOT_SETTLE_DELAY_MS);
        await this.waitUntilReady();
        return Number((performance.now() - startedAt).toFixed(3));
    }

    async withFtp(callback) {
        const client = new BasicFtpClient(REQUEST_TIMEOUT_MS);
        client.ftp.verbose = false;
        await client.access({
            host: this.baseUrl.hostname,
            port: 21,
            user: 'anonymous',
            password: this.password || 'anonymous@',
            secure: false,
        });
        try {
            return await callback(client);
        } finally {
            client.close();
        }
    }

    async listFolder(remotePath) {
        return this.withFtp((client) => client.list(remotePath));
    }

    async readRemoteFile(remotePath) {
        return this.withFtp(async (client) => {
            const chunks = [];
            const sink = new Writable({
                write(chunk, _encoding, callback) {
                    chunks.push(Buffer.from(chunk));
                    callback();
                },
            });
            await client.downloadTo(sink, remotePath);
            return Buffer.concat(chunks);
        });
    }

    async deleteRemoteFile(remotePath) {
        return this.withFtp(async (client) => {
            try {
                await client.remove(remotePath);
            } catch (error) {
                const message = String(error);
                if (!/550|not found|No such file/i.test(message)) throw error;
            }
        });
    }

    async getMediaPaths() {
        if (this.cachedMediaPaths) return this.cachedMediaPaths;
        const firstMatch = async (folder, extension) => {
            const entries = await this.listFolder(folder);
            const match = entries
                .filter((entry) => entry.isFile && entry.name.toLowerCase().endsWith(extension))
                .sort((left, right) => left.name.localeCompare(right.name))[0];
            if (!match) throw new Error(`No ${extension} file found in ${folder}`);
            return `${folder}/${match.name}`;
        };
        this.cachedMediaPaths = {
            sid: await firstMatch('/USB2/test-data/SID', '.sid'),
            mod: await firstMatch('/USB2/test-data/mod', '.mod'),
            prg: await firstMatch('/USB2/test-data/prg', '.prg'),
            crt: await firstMatch('/USB2/test-data/crt', '.crt'),
            d64: await firstMatch('/USB2/test-data/d64', '.d64'),
            d71: await firstMatch('/USB2/test-data/d71', '.d71'),
            d81: await firstMatch('/USB2/test-data/d81', '.d81'),
        };
        return this.cachedMediaPaths;
    }

    async getConfigTarget() {
        if (this.cachedConfigTarget) return this.cachedConfigTarget;
        const categoriesResponse = await this.request({ method: 'GET', pathName: '/v1/configs' });
        const categories = categoriesResponse.json?.categories || [];
        const safeCategory = categories.find(
            (name) => !SAFE_CATEGORY_BLOCKLIST.some((token) => String(name).toLowerCase().includes(token)),
        );
        if (!safeCategory) throw new Error('No safe configuration category found');
        const categoryResponse = await this.request({
            method: 'GET',
            pathName: `/v1/configs/${encodeURIComponent(safeCategory)}`,
        });
        const categoryObject = categoryResponse.json?.[safeCategory] || {};
        const items = categoryObject.items && typeof categoryObject.items === 'object' ? categoryObject.items : categoryObject;
        const safeItem = Object.keys(items).find(
            (name) => !SAFE_ITEM_BLOCKLIST.some((token) => name.toLowerCase().includes(token)),
        );
        if (!safeItem) throw new Error(`No safe configuration item found in ${safeCategory}`);
        const detailResponse = await this.request({
            method: 'GET',
            pathName: `/v1/configs/${encodeURIComponent(safeCategory)}/${encodeURIComponent(safeItem)}`,
        });
        const detailCategory = detailResponse.json?.[safeCategory] || {};
        const detailItems =
            detailCategory.items && typeof detailCategory.items === 'object' ? detailCategory.items : detailCategory;
        const entry = detailItems?.[safeItem];
        const currentValue =
            entry && typeof entry === 'object'
                ? entry.current ?? entry.selected ?? entry.default ?? null
                : typeof entry === 'string' || typeof entry === 'number'
                    ? entry
                    : null;
        this.cachedConfigTarget = {
            category: safeCategory,
            item: safeItem,
            value: currentValue,
        };
        return this.cachedConfigTarget;
    }

    async getDrivesByKey() {
        const response = await this.request({ method: 'GET', pathName: '/v1/drives' });
        const result = {};
        for (const entry of response.json?.drives || []) {
            const [key, value] = Object.entries(entry)[0] || [];
            if (key) result[key] = value;
        }
        return result;
    }

    async getDriveBState() {
        const drives = await this.getDrivesByKey();
        const driveB = drives.b;
        if (!driveB) throw new Error('Drive B not present');
        this.cachedDriveBState = { ...driveB };
        return { ...driveB };
    }

    async ensureDriveBEnabled() {
        const driveB = await this.getDriveBState();
        if (driveB.enabled) return;
        await this.request({ method: 'PUT', pathName: '/v1/drives/b:on' });
        await delay(MUTATION_RECOVERY_DELAY_MS);
    }

    async restoreDriveB(original) {
        const current = (await this.getDrivesByKey()).b;
        if (!current) throw new Error('Drive B not present while restoring');

        if (String(current.type || '') !== String(original.type || '')) {
            await this.request({
                method: 'PUT',
                pathName: '/v1/drives/b:set_mode',
                query: { mode: String(original.type || '1541') },
            });
            await delay(MUTATION_RECOVERY_DELAY_MS);
        }

        if (current.image_file || current.image_path) {
            await this.request({ method: 'PUT', pathName: '/v1/drives/b:remove' });
            await delay(MUTATION_RECOVERY_DELAY_MS);
        }
        if (original.image_file) {
            const imagePath = `${original.image_path || ''}/${original.image_file}`.replace(/\/+/g, '/');
            await this.request({
                method: 'PUT',
                pathName: '/v1/drives/b:mount',
                query: { image: imagePath, type: diskTypeFromFile(original.image_file), mode: 'readonly' },
            });
            await delay(MUTATION_RECOVERY_DELAY_MS);
        }

        const desiredEnabled = Boolean(original.enabled);
        if (Boolean((await this.getDrivesByKey()).b.enabled) !== desiredEnabled) {
            await this.request({ method: 'PUT', pathName: desiredEnabled ? '/v1/drives/b:on' : '/v1/drives/b:off' });
            await delay(MUTATION_RECOVERY_DELAY_MS);
        }

        if (original.rom) {
            await this.request({
                method: 'PUT',
                pathName: '/v1/drives/b:load_rom',
                query: { file: `/Flash/roms/${original.rom}` },
            });
            await delay(MUTATION_RECOVERY_DELAY_MS);
        }
    }

    async getRomBytes() {
        if (this.cachedRomBytes) return this.cachedRomBytes;
        const drive = await this.getDriveBState();
        const romName = drive.rom || '1541.rom';
        this.cachedRomBytes = await this.readRemoteFile(`/Flash/roms/${romName}`);
        return this.cachedRomBytes;
    }

    async getDiskBytes() {
        if (this.cachedDiskBytes) return this.cachedDiskBytes;
        const media = await this.getMediaPaths();
        this.cachedDiskBytes = await this.readRemoteFile(media.d64);
        return this.cachedDiskBytes;
    }

    async getLocalStreamIp() {
        if (this.localStreamIp) return this.localStreamIp;
        const candidates = Object.values(os.networkInterfaces())
            .flat()
            .filter(Boolean)
            .filter((entry) => entry.family === 'IPv4' && !entry.internal)
            .map((entry) => entry.address);
        const preferred = candidates.find((address) => address.startsWith('192.168.')) || candidates[0];
        if (!preferred) throw new Error('Unable to determine local IPv4 address for stream start');
        this.localStreamIp = preferred;
        return preferred;
    }

    async waitForDriveState({ driveKey, predicate, timeoutMs = COMPLETION_TIMEOUT_MS }) {
        const deadline = Date.now() + timeoutMs;
        while (Date.now() < deadline) {
            const drives = await this.getDrivesByKey();
            const drive = drives[driveKey];
            if (drive && predicate(drive)) {
                return;
            }
            await delay(COMPLETION_POLL_DELAY_MS);
        }
        throw new Error(`Timed out waiting for drive ${driveKey} to reach the expected state`);
    }
}

function diskTypeFromFile(filename) {
    const ext = filename.toLowerCase().split('.').pop();
    return ['d64', 'd71', 'd81', 'g64', 'g71'].includes(ext) ? ext : 'd64';
}

function normalizeMeasurementSample(result) {
    if (typeof result === 'number') {
        const latencyMs = Number(result.toFixed(3));
        return { responseLatencyMs: latencyMs, completionLatencyMs: latencyMs };
    }
    const responseLatencyMs = Number(result.responseLatencyMs.toFixed(3));
    const completionLatencyMs = Number((result.completionLatencyMs ?? result.responseLatencyMs).toFixed(3));
    return { responseLatencyMs, completionLatencyMs };
}

async function measureOperation({ probe, id, description, invoke }) {
    const responseSamples = [];
    const completionSamples = [];
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
        const result = normalizeMeasurementSample(await invoke(probe, index));
        responseSamples.push(result.responseLatencyMs);
        completionSamples.push(result.completionLatencyMs);
        await delay(SAMPLE_DELAY_MS);
    }
    return {
        id,
        description,
        sampleCount: SAMPLE_COUNT,
        sampleDelayMs: SAMPLE_DELAY_MS,
        responseMedianMs: Number(median(responseSamples).toFixed(3)),
        responseMinMs: Number(Math.min(...responseSamples).toFixed(3)),
        responseMaxMs: Number(Math.max(...responseSamples).toFixed(3)),
        responseSamplesMs: responseSamples,
        activityCompletionMedianMs: Number(median(completionSamples).toFixed(3)),
        activityCompletionMinMs: Number(Math.min(...completionSamples).toFixed(3)),
        activityCompletionMaxMs: Number(Math.max(...completionSamples).toFixed(3)),
        activityCompletionSamplesMs: completionSamples,
        completionDeltaMedianMs: Number((median(completionSamples) - median(responseSamples)).toFixed(3)),
    };
}

function shouldRerunMeasurement(measurement) {
    const responseRangeMs = measurement.responseMaxMs - measurement.responseMinMs;
    const completionRangeMs = measurement.activityCompletionMaxMs - measurement.activityCompletionMinMs;
    return (
        measurement.responseMaxMs > SLOW_SAMPLE_THRESHOLD_MS ||
        measurement.activityCompletionMaxMs > SLOW_SAMPLE_THRESHOLD_MS ||
        responseRangeMs > VARIATION_THRESHOLD_MS ||
        completionRangeMs > VARIATION_THRESHOLD_MS
    );
}

async function main() {
    if (!Number.isFinite(SAMPLE_COUNT) || SAMPLE_COUNT < 5) {
        throw new Error(`C64U_TIMING_SAMPLE_COUNT must be >= 5, received ${SAMPLE_COUNT}`);
    }

    const probe = new TimingProbe({ baseUrl: DEFAULT_BASE_URL, password: DEFAULT_PASSWORD });
    const media = await probe.getMediaPaths();
    const configTarget = await probe.getConfigTarget();
    const fileInfoPath = media.d64;
    const fileScratchBase = '/USB2/test-data/c64commander-timing';
    const streamIp = await probe.getLocalStreamIp();

    const operations = [
        {
            id: 'options.root',
            description: 'OPTIONS /',
            invoke: (ctx) => ctx.request({ method: 'OPTIONS', pathName: '/' }).then((response) => response.latencyMs),
        },
        {
            id: 'version.read',
            description: 'GET /v1/version',
            invoke: (ctx) => ctx.request({ method: 'GET', pathName: '/v1/version' }).then((response) => response.latencyMs),
        },
        {
            id: 'info.read',
            description: 'GET /v1/info',
            invoke: (ctx) => ctx.request({ method: 'GET', pathName: '/v1/info' }).then((response) => response.latencyMs),
        },
        {
            id: 'runner.sidplay.put',
            description: 'PUT /v1/runners:sidplay',
            invoke: (ctx) =>
                ctx
                    .request({ method: 'PUT', pathName: '/v1/runners:sidplay', query: { file: media.sid, songnr: 0 } })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'runner.sidplay.post',
            description: 'POST /v1/runners:sidplay',
            invoke: async (ctx) => {
                const form = new FormData();
                form.append('file', new Blob([createMinimalSid()], { type: 'application/octet-stream' }), 'probe.sid');
                const response = await ctx.request({ method: 'POST', pathName: '/v1/runners:sidplay', body: form });
                return response.latencyMs;
            },
        },
        {
            id: 'runner.modplay.put',
            description: 'PUT /v1/runners:modplay',
            invoke: (ctx) =>
                ctx.request({ method: 'PUT', pathName: '/v1/runners:modplay', query: { file: media.mod } }).then((response) => response.latencyMs),
        },
        {
            id: 'runner.modplay.post',
            description: 'POST /v1/runners:modplay',
            invoke: (ctx) =>
                ctx
                    .request({
                        method: 'POST',
                        pathName: '/v1/runners:modplay',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: createMinimalMod(),
                    })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'runner.load_prg.put',
            description: 'PUT /v1/runners:load_prg',
            invoke: (ctx) =>
                ctx.request({ method: 'PUT', pathName: '/v1/runners:load_prg', query: { file: media.prg } }).then((response) => response.latencyMs),
        },
        {
            id: 'runner.load_prg.post',
            description: 'POST /v1/runners:load_prg',
            invoke: (ctx) =>
                ctx
                    .request({
                        method: 'POST',
                        pathName: '/v1/runners:load_prg',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: createMinimalPrg(),
                    })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'runner.run_prg.put',
            description: 'PUT /v1/runners:run_prg',
            invoke: (ctx) =>
                ctx.request({ method: 'PUT', pathName: '/v1/runners:run_prg', query: { file: media.prg } }).then((response) => response.latencyMs),
        },
        {
            id: 'runner.run_prg.post',
            description: 'POST /v1/runners:run_prg',
            invoke: (ctx) =>
                ctx
                    .request({
                        method: 'POST',
                        pathName: '/v1/runners:run_prg',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: createMinimalPrg(),
                    })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'runner.run_crt.put',
            description: 'PUT /v1/runners:run_crt',
            invoke: (ctx) =>
                ctx.request({ method: 'PUT', pathName: '/v1/runners:run_crt', query: { file: media.crt } }).then((response) => response.latencyMs),
        },
        {
            id: 'runner.run_crt.post',
            description: 'POST /v1/runners:run_crt',
            invoke: (ctx) =>
                ctx
                    .request({
                        method: 'POST',
                        pathName: '/v1/runners:run_crt',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: createMinimalCrt(),
                    })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'configs.list.read',
            description: 'GET /v1/configs',
            invoke: (ctx) => ctx.request({ method: 'GET', pathName: '/v1/configs' }).then((response) => response.latencyMs),
        },
        {
            id: 'configs.category.read',
            description: 'GET /v1/configs/{category}',
            invoke: (ctx) =>
                ctx
                    .request({
                        method: 'GET',
                        pathName: `/v1/configs/${encodeURIComponent(configTarget.category)}`,
                    })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'configs.item.read',
            description: 'GET /v1/configs/{category}/{item}',
            invoke: (ctx) =>
                ctx
                    .request({
                        method: 'GET',
                        pathName: `/v1/configs/${encodeURIComponent(configTarget.category)}/${encodeURIComponent(configTarget.item)}`,
                    })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'configs.batch.write',
            description: 'POST /v1/configs',
            invoke: (ctx) =>
                ctx
                    .request({
                        method: 'POST',
                        pathName: '/v1/configs',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ [configTarget.category]: { [configTarget.item]: configTarget.value } }),
                    })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'configs.item.write',
            description: 'PUT /v1/configs/{category}/{item}',
            invoke: (ctx) =>
                ctx
                    .request({
                        method: 'PUT',
                        pathName: `/v1/configs/${encodeURIComponent(configTarget.category)}/${encodeURIComponent(configTarget.item)}`,
                        query: { value: configTarget.value },
                    })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'configs.load_from_flash.write',
            description: 'PUT /v1/configs:load_from_flash',
            invoke: async (ctx) => {
                const startedAt = performance.now();
                try {
                    const response = await ctx.request({ method: 'PUT', pathName: '/v1/configs:load_from_flash' });
                    return response.latencyMs;
                } catch (error) {
                    const message = String(error);
                    if (/fetch failed|ECONNRESET|Connection reset/i.test(message)) {
                        return Number((performance.now() - startedAt).toFixed(3));
                    }
                    throw error;
                }
            },
        },
        {
            id: 'configs.save_to_flash.write',
            description: 'PUT /v1/configs:save_to_flash',
            invoke: (ctx) =>
                ctx.request({ method: 'PUT', pathName: '/v1/configs:save_to_flash' }).then((response) => response.latencyMs),
        },
        {
            id: 'machine.pause.write',
            description: 'PUT /v1/machine:pause',
            invoke: async (ctx) => {
                const response = await ctx.request({ method: 'PUT', pathName: '/v1/machine:pause' });
                await delay(MUTATION_RECOVERY_DELAY_MS);
                await ctx.request({ method: 'PUT', pathName: '/v1/machine:resume' });
                return response.latencyMs;
            },
        },
        {
            id: 'machine.resume.write',
            description: 'PUT /v1/machine:resume',
            invoke: async (ctx) => {
                await ctx.request({ method: 'PUT', pathName: '/v1/machine:pause' });
                await delay(MUTATION_RECOVERY_DELAY_MS);
                const response = await ctx.request({ method: 'PUT', pathName: '/v1/machine:resume' });
                return response.latencyMs;
            },
        },
        {
            id: 'machine.menu_button.write',
            description: 'PUT /v1/machine:menu_button',
            invoke: async (ctx) => {
                const response = await ctx.request({ method: 'PUT', pathName: '/v1/machine:menu_button' });
                await delay(MUTATION_RECOVERY_DELAY_MS);
                await ctx.request({ method: 'PUT', pathName: '/v1/machine:menu_button' });
                return response.latencyMs;
            },
        },
        {
            id: 'machine.writemem.query.write',
            description: 'PUT /v1/machine:writemem',
            invoke: async (ctx) => {
                const current = await ctx.request({
                    method: 'GET',
                    pathName: '/v1/machine:readmem',
                    query: { address: '00C6', length: 1 },
                });
                const byteValue = Number(current.json?.data?.[0] || 0);
                const response = await ctx.request({
                    method: 'PUT',
                    pathName: '/v1/machine:writemem',
                    query: { address: '00C6', data: toHexByte(byteValue) },
                });
                return response.latencyMs;
            },
        },
        {
            id: 'machine.writemem.binary.write',
            description: 'POST /v1/machine:writemem',
            invoke: async (ctx) => {
                const current = await ctx.request({
                    method: 'GET',
                    pathName: '/v1/machine:readmem',
                    query: { address: '00C6', length: 1 },
                });
                const byteValue = Number(current.json?.data?.[0] || 0);
                const response = await ctx.request({
                    method: 'POST',
                    pathName: '/v1/machine:writemem',
                    query: { address: '00C6' },
                    headers: { 'Content-Type': 'application/octet-stream' },
                    body: Buffer.from([byteValue]),
                });
                return response.latencyMs;
            },
        },
        {
            id: 'machine.readmem.read',
            description: 'GET /v1/machine:readmem',
            invoke: (ctx) =>
                ctx
                    .request({ method: 'GET', pathName: '/v1/machine:readmem', query: { address: '00A2', length: 3 } })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'machine.debugreg.read',
            description: 'GET /v1/machine:debugreg',
            invoke: (ctx) => ctx.request({ method: 'GET', pathName: '/v1/machine:debugreg' }).then((response) => response.latencyMs),
        },
        {
            id: 'machine.debugreg.write',
            description: 'PUT /v1/machine:debugreg',
            invoke: async (ctx) => {
                const current = await ctx.request({ method: 'GET', pathName: '/v1/machine:debugreg' });
                const value = current.json?.value ?? '0';
                const response = await ctx.request({
                    method: 'PUT',
                    pathName: '/v1/machine:debugreg',
                    query: { value },
                });
                return response.latencyMs;
            },
        },
        {
            id: 'drives.list.read',
            description: 'GET /v1/drives',
            invoke: (ctx) => ctx.request({ method: 'GET', pathName: '/v1/drives' }).then((response) => response.latencyMs),
        },
        {
            id: 'drives.mount.put',
            description: 'PUT /v1/drives/{drive}:mount',
            invoke: async (ctx) => {
                const original = await ctx.getDriveBState();
                try {
                    await ctx.ensureDriveBEnabled();
                    const startedAt = performance.now();
                    const response = await ctx.request({
                        method: 'PUT',
                        pathName: '/v1/drives/b:mount',
                        query: { image: media.d64, type: 'd64', mode: 'readonly' },
                    });
                    await ctx.waitForDriveState({
                        driveKey: 'b',
                        predicate: (drive) => drive.image_file === path.basename(media.d64),
                    });
                    return {
                        responseLatencyMs: response.latencyMs,
                        completionLatencyMs: Number((performance.now() - startedAt).toFixed(3)),
                    };
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.restoreDriveB(original);
                }
            },
        },
        {
            id: 'drives.mount.post',
            description: 'POST /v1/drives/{drive}:mount',
            invoke: async (ctx) => {
                const original = await ctx.getDriveBState();
                try {
                    await ctx.ensureDriveBEnabled();
                    const startedAt = performance.now();
                    const response = await ctx.request({
                        method: 'POST',
                        pathName: '/v1/drives/b:mount',
                        query: { type: 'd64', mode: 'readonly' },
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: await ctx.getDiskBytes(),
                    });
                    await ctx.waitForDriveState({
                        driveKey: 'b',
                        predicate: (drive) => Boolean(drive.image_file),
                    });
                    return {
                        responseLatencyMs: response.latencyMs,
                        completionLatencyMs: Number((performance.now() - startedAt).toFixed(3)),
                    };
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.restoreDriveB(original);
                }
            },
        },
        {
            id: 'drives.reset.write',
            description: 'PUT /v1/drives/{drive}:reset',
            invoke: (ctx) => ctx.request({ method: 'PUT', pathName: '/v1/drives/b:reset' }).then((response) => response.latencyMs),
        },
        {
            id: 'drives.remove.write',
            description: 'PUT /v1/drives/{drive}:remove',
            invoke: async (ctx) => {
                const original = await ctx.getDriveBState();
                try {
                    if (!original.image_file) {
                        await ctx.request({
                            method: 'PUT',
                            pathName: '/v1/drives/b:mount',
                            query: { image: media.d64, type: 'd64', mode: 'readonly' },
                        });
                        await delay(MUTATION_RECOVERY_DELAY_MS);
                    }
                    const response = await ctx.request({ method: 'PUT', pathName: '/v1/drives/b:remove' });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.restoreDriveB(original);
                }
            },
        },
        {
            id: 'drives.on.write',
            description: 'PUT /v1/drives/{drive}:on',
            invoke: async (ctx) => {
                const original = await ctx.getDriveBState();
                try {
                    await ctx.request({ method: 'PUT', pathName: '/v1/drives/b:off' });
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    const response = await ctx.request({ method: 'PUT', pathName: '/v1/drives/b:on' });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.restoreDriveB(original);
                }
            },
        },
        {
            id: 'drives.off.write',
            description: 'PUT /v1/drives/{drive}:off',
            invoke: async (ctx) => {
                const original = await ctx.getDriveBState();
                try {
                    await ctx.request({ method: 'PUT', pathName: '/v1/drives/b:on' });
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    const response = await ctx.request({ method: 'PUT', pathName: '/v1/drives/b:off' });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.restoreDriveB(original);
                }
            },
        },
        {
            id: 'drives.load_rom.put',
            description: 'PUT /v1/drives/{drive}:load_rom',
            invoke: async (ctx) => {
                const original = await ctx.getDriveBState();
                try {
                    const romName = original.rom || '1541.rom';
                    const response = await ctx.request({
                        method: 'PUT',
                        pathName: '/v1/drives/b:load_rom',
                        query: { file: `/Flash/roms/${romName}` },
                    });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.restoreDriveB(original);
                }
            },
        },
        {
            id: 'drives.load_rom.post',
            description: 'POST /v1/drives/{drive}:load_rom',
            invoke: async (ctx) => {
                const original = await ctx.getDriveBState();
                try {
                    const response = await ctx.request({
                        method: 'POST',
                        pathName: '/v1/drives/b:load_rom',
                        headers: { 'Content-Type': 'application/octet-stream' },
                        body: await ctx.getRomBytes(),
                    });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.restoreDriveB(original);
                }
            },
        },
        {
            id: 'drives.set_mode.write',
            description: 'PUT /v1/drives/{drive}:set_mode',
            invoke: async (ctx) => {
                const original = await ctx.getDriveBState();
                const currentMode = String(original.type || '1541');
                const nextMode = currentMode === '1541' ? '1571' : '1541';
                try {
                    const response = await ctx.request({
                        method: 'PUT',
                        pathName: '/v1/drives/b:set_mode',
                        query: { mode: nextMode },
                    });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.restoreDriveB(original);
                }
            },
        },
        {
            id: 'streams.start.write',
            description: 'PUT /v1/streams/{stream}:start',
            invoke: async (ctx) => {
                const startedAt = performance.now();
                try {
                    const response = await ctx.request({
                        method: 'PUT',
                        pathName: '/v1/streams/debug:start',
                        query: { ip: `${streamIp}:6510` },
                    });
                    return response.latencyMs;
                } catch (error) {
                    const message = String(error);
                    if (/Network Host Resolve Error/i.test(message)) {
                        return Number((performance.now() - startedAt).toFixed(3));
                    }
                    throw error;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.request({ method: 'PUT', pathName: '/v1/streams/debug:stop' });
                }
            },
        },
        {
            id: 'streams.stop.write',
            description: 'PUT /v1/streams/{stream}:stop',
            invoke: async (ctx) => {
                try {
                    await ctx.request({
                        method: 'PUT',
                        pathName: '/v1/streams/debug:start',
                        query: { ip: `${streamIp}:6510` },
                    });
                } catch (error) {
                    const message = String(error);
                    if (!/Network Host Resolve Error/i.test(message)) {
                        throw error;
                    }
                }
                await delay(MUTATION_RECOVERY_DELAY_MS);
                const response = await ctx.request({ method: 'PUT', pathName: '/v1/streams/debug:stop' });
                return response.latencyMs;
            },
        },
        {
            id: 'files.info.read',
            description: 'GET /v1/files/{path}:info',
            invoke: (ctx) =>
                ctx
                    .request({ method: 'GET', pathName: `/v1/files/${encodeFilePath(fileInfoPath)}:info` })
                    .then((response) => response.latencyMs),
        },
        {
            id: 'files.create_d64.write',
            description: 'PUT /v1/files/{path}:create_d64',
            invoke: async (ctx, sampleIndex) => {
                const scratchPath = `${fileScratchBase}-${sampleIndex}.d64`;
                await ctx.deleteRemoteFile(scratchPath);
                try {
                    const response = await ctx.request({
                        method: 'PUT',
                        pathName: `/v1/files/${encodeFilePath(scratchPath)}:create_d64`,
                        query: { tracks: 35, diskname: 'TIMD64' },
                    });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.deleteRemoteFile(scratchPath);
                }
            },
        },
        {
            id: 'files.create_d71.write',
            description: 'PUT /v1/files/{path}:create_d71',
            invoke: async (ctx, sampleIndex) => {
                const scratchPath = `${fileScratchBase}-${sampleIndex}.d71`;
                await ctx.deleteRemoteFile(scratchPath);
                try {
                    const response = await ctx.request({
                        method: 'PUT',
                        pathName: `/v1/files/${encodeFilePath(scratchPath)}:create_d71`,
                        query: { diskname: 'TIMD71' },
                    });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.deleteRemoteFile(scratchPath);
                }
            },
        },
        {
            id: 'files.create_d81.write',
            description: 'PUT /v1/files/{path}:create_d81',
            invoke: async (ctx, sampleIndex) => {
                const scratchPath = `${fileScratchBase}-${sampleIndex}.d81`;
                await ctx.deleteRemoteFile(scratchPath);
                try {
                    const response = await ctx.request({
                        method: 'PUT',
                        pathName: `/v1/files/${encodeFilePath(scratchPath)}:create_d81`,
                        query: { diskname: 'TIMD81' },
                    });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.deleteRemoteFile(scratchPath);
                }
            },
        },
        {
            id: 'files.create_dnp.write',
            description: 'PUT /v1/files/{path}:create_dnp',
            invoke: async (ctx, sampleIndex) => {
                const scratchPath = `${fileScratchBase}-${sampleIndex}.dnp`;
                await ctx.deleteRemoteFile(scratchPath);
                try {
                    const response = await ctx.request({
                        method: 'PUT',
                        pathName: `/v1/files/${encodeFilePath(scratchPath)}:create_dnp`,
                        query: { tracks: 16, diskname: 'TIMDNP' },
                    });
                    return response.latencyMs;
                } finally {
                    await delay(MUTATION_RECOVERY_DELAY_MS);
                    await ctx.deleteRemoteFile(scratchPath);
                }
            },
        },
    ];

    const operationMatcher = OPERATION_FILTER ? new RegExp(OPERATION_FILTER) : null;
    const selectedOperations = operationMatcher
        ? operations.filter((operation) => operationMatcher.test(operation.id))
        : operations;

    if (selectedOperations.length === 0) {
        throw new Error(`No operations matched C64U_TIMING_OPERATION_FILTER=${OPERATION_FILTER}`);
    }

    const measurements = [];
    for (const operation of selectedOperations) {
        console.log(`Measuring ${operation.id} (${operation.description})`);
        if (REBOOT_BEFORE_EACH_OPERATION) {
            console.log('  hard rebooting device before series');
            await probe.hardRebootAndWait();
        }
        let measurement = await measureOperation({
            probe,
            id: operation.id,
            description: operation.description,
            invoke: operation.invoke,
        });
        if (shouldRerunMeasurement(measurement)) {
            console.log(
                `  repeating series because responseMax=${measurement.responseMaxMs}ms responseRange=${Number((measurement.responseMaxMs - measurement.responseMinMs).toFixed(3))}ms completionMax=${measurement.activityCompletionMaxMs}ms completionRange=${Number((measurement.activityCompletionMaxMs - measurement.activityCompletionMinMs).toFixed(3))}ms`,
            );
            if (REBOOT_BEFORE_EACH_OPERATION) {
                console.log('  hard rebooting device before repeat');
                await probe.hardRebootAndWait();
            }
            measurement = await measureOperation({
                probe,
                id: operation.id,
                description: operation.description,
                invoke: operation.invoke,
            });
        }
        console.log(
            `  response median=${measurement.responseMedianMs}ms range=${measurement.responseMinMs}-${measurement.responseMaxMs}ms completion median=${measurement.activityCompletionMedianMs}ms range=${measurement.activityCompletionMinMs}-${measurement.activityCompletionMaxMs}ms`,
        );
        measurements.push(measurement);
    }

    const payload = {
        capturedAt: new Date().toISOString(),
        baseUrl: probe.baseUrl.toString(),
        sampleCount: SAMPLE_COUNT,
        sampleDelayMs: SAMPLE_DELAY_MS,
        mutationRecoveryDelayMs: MUTATION_RECOVERY_DELAY_MS,
        rebootBeforeEachOperation: REBOOT_BEFORE_EACH_OPERATION,
        rebootSettleDelayMs: REBOOT_SETTLE_DELAY_MS,
        rebootReadyTimeoutMs: REBOOT_READY_TIMEOUT_MS,
        measuredSafeOperations: measurements,
        skippedDestructiveOperations: [
            'PUT /v1/configs:reset_to_default',
            'PUT /v1/machine:reset',
            'PUT /v1/machine:poweroff',
        ],
    };

    await fs.writeFile(OUTPUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${OUTPUT_PATH}`);
}

main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
});
