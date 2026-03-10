/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { C64API, DrivesResponse } from "@/lib/c64api";
import { buildPlayPlan, executePlayPlan } from "@/lib/playback/playbackRouter";
import { loadFirstDiskPrgViaDma } from "@/lib/playback/diskFirstPrg";

vi.mock("@/lib/logging", () => ({
    addErrorLog: vi.fn(),
    addLog: vi.fn(),
}));

vi.mock("@/lib/c64api", () => ({
    getC64APIConfigSnapshot: vi.fn(() => ({ deviceHost: "c64u", password: "" })),
}));

vi.mock("@/lib/ftp/ftpClient", () => ({
    readFtpFile: vi.fn(),
}));

vi.mock("@/lib/ftp/ftpConfig", () => ({
    getStoredFtpPort: vi.fn(() => 21),
}));

vi.mock("@/lib/sourceNavigation/ftpSourceAdapter", () => ({
    normalizeFtpHost: vi.fn((host: string) => host),
}));

vi.mock("@/lib/tracing/actionTrace", () => ({
    getActiveAction: vi.fn(() => null),
}));

vi.mock("@/lib/tracing/traceSession", () => ({
    recordDeviceGuard: vi.fn(),
    recordTraceError: vi.fn(),
}));

vi.mock("@/lib/tracing/failureTaxonomy", () => ({
    classifyError: vi.fn(() => ({ category: "unknown", isExpected: false })),
}));

vi.mock("@/lib/disks/diskMount", () => ({
    mountDiskToDrive: vi.fn(async () => undefined),
    resolveLocalDiskBlob: vi.fn(),
}));

vi.mock("@/lib/playback/autostart", () => ({
    AUTOSTART_SEQUENCE: new Uint8Array([42]),
    injectAutostart: vi.fn(async () => undefined),
}));

vi.mock("@/lib/playback/diskFirstPrg", () => ({
    loadFirstDiskPrgViaDma: vi.fn(async () => undefined),
}));

describe("executePlayPlan disk autoplay drive configuration", () => {
    const originalBlobArrayBuffer = Blob.prototype.arrayBuffer;

    const createApi = (driveInfo: DrivesResponse["drives"][number]["a"]) => {
        return {
            getDrives: vi.fn(async () => ({ drives: [{ a: driveInfo }], errors: [] }) satisfies DrivesResponse),
            driveOn: vi.fn(async () => ({ errors: [] })),
            setDriveMode: vi.fn(async () => ({ errors: [] })),
            mountDriveUpload: vi.fn(async () => ({ errors: [] })),
            machineReset: vi.fn(async () => ({ errors: [] })),
            machineReboot: vi.fn(async () => ({ errors: [] })),
        } as unknown as C64API;
    };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    beforeAll(() => {
        if (!Blob.prototype.arrayBuffer) {
            Object.defineProperty(Blob.prototype, "arrayBuffer", {
                configurable: true,
                value() {
                    return new Response(this).arrayBuffer();
                },
            });
        }
    });

    afterAll(() => {
        if (originalBlobArrayBuffer) {
            Object.defineProperty(Blob.prototype, "arrayBuffer", {
                configurable: true,
                value: originalBlobArrayBuffer,
            });
            return;
        }

        delete (Blob.prototype as Blob & { arrayBuffer?: unknown }).arrayBuffer;
    });

    it("powers on Drive A and switches to 1541 before autoplaying a d64", async () => {
        const api = createApi({ enabled: false, type: "1571" });

        await executePlayPlan(
            api,
            buildPlayPlan({
                source: "local",
                path: "/games/demo.d64",
                file: new Blob([Uint8Array.from([1, 2, 3])]),
            }),
            { resetBeforeMount: false, diskAutostartMode: "dma" },
        );

        expect(api.driveOn).toHaveBeenCalledWith("a");
        expect(api.setDriveMode).toHaveBeenCalledWith("a", "1541");
        expect(api.mountDriveUpload).toHaveBeenCalledWith("a", expect.any(Blob), "d64", "readwrite");
        expect(loadFirstDiskPrgViaDma).toHaveBeenCalled();
        expect(api.driveOn.mock.invocationCallOrder[0]).toBeLessThan(api.setDriveMode.mock.invocationCallOrder[0]);
        expect(api.setDriveMode.mock.invocationCallOrder[0]).toBeLessThan(api.mountDriveUpload.mock.invocationCallOrder[0]);
    });

    it("switches Drive A to 1571 before autoplaying a d71", async () => {
        const api = createApi({ enabled: true, type: "1541" });

        await executePlayPlan(
            api,
            buildPlayPlan({
                source: "local",
                path: "/games/demo.d71",
                file: new Blob([Uint8Array.from([1, 2, 3])]),
            }),
            { resetBeforeMount: false, diskAutostartMode: "dma" },
        );

        expect(api.driveOn).not.toHaveBeenCalled();
        expect(api.setDriveMode).toHaveBeenCalledWith("a", "1571");
        expect(api.mountDriveUpload).toHaveBeenCalledWith("a", expect.any(Blob), "d71", "readwrite");
    });

    it("switches Drive A to 1581 before autoplaying a d81", async () => {
        const api = createApi({ enabled: true, type: "1541" });

        await executePlayPlan(
            api,
            buildPlayPlan({
                source: "local",
                path: "/games/demo.d81",
                file: new Blob([Uint8Array.from([1, 2, 3])]),
            }),
            { resetBeforeMount: false, diskAutostartMode: "dma" },
        );

        expect(api.setDriveMode).toHaveBeenCalledWith("a", "1581");
        expect(api.mountDriveUpload).toHaveBeenCalledWith("a", expect.any(Blob), "d81", "readwrite");
    });

    it("skips drive power and mode changes when Drive A is already ready", async () => {
        const api = createApi({ enabled: true, type: "1541" });

        await executePlayPlan(
            api,
            buildPlayPlan({
                source: "local",
                path: "/games/demo.d64",
                file: new Blob([Uint8Array.from([1, 2, 3])]),
            }),
            { resetBeforeMount: false, diskAutostartMode: "dma" },
        );

        expect(api.driveOn).not.toHaveBeenCalled();
        expect(api.setDriveMode).not.toHaveBeenCalled();
        expect(api.mountDriveUpload).toHaveBeenCalledWith("a", expect.any(Blob), "d64", "readwrite");
    });
});
