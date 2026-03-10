/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveAdbSerialMock = vi.fn();
const resolvePreferredPhysicalTestDeviceSerialMock = vi.fn();
const runPreflightMock = vi.fn();
const discoverMirroredCorporaMock = vi.fn();
const runCaseMock = vi.fn();

vi.mock("../src/deviceRegistry.js", () => ({
    resolveAdbSerial: resolveAdbSerialMock,
    resolvePreferredPhysicalTestDeviceSerial: resolvePreferredPhysicalTestDeviceSerialMock,
}));

vi.mock("../src/preflight.js", () => ({
    runPreflight: runPreflightMock,
}));

vi.mock("../src/testDataDiscovery.js", () => ({
    discoverMirroredCorpora: discoverMirroredCorporaMock,
}));

vi.mock("../src/validation/runner.js", () => ({
    runCase: runCaseMock,
}));

vi.mock("../src/validation/cases/index.js", () => ({
    appFirstPlaybackContinuity: {
        id: "AF-009",
        caseId: "AF-PLAY-CONTINUITY-001",
        name: "Continuity",
    },
    appFirstPlaylistAutoAdvance: {
        id: "AF-010",
        caseId: "AF-PLAY-AUTOSKIP-001",
        name: "Auto-advance",
    },
}));

describe("agentic exploratory wave 1", () => {
    const originalCwd = process.cwd();

    beforeEach(() => {
        vi.resetModules();
        vi.restoreAllMocks();
        resolveAdbSerialMock.mockReset();
        resolvePreferredPhysicalTestDeviceSerialMock.mockReset();
        runPreflightMock.mockReset();
        discoverMirroredCorporaMock.mockReset();
        runCaseMock.mockReset();
        delete process.env["ANDROID_SERIAL"];
        delete process.env["C64U_HOST"];
        delete process.env["REPEAT"];
    });

    it("writes discovery and summary artifacts from the c64scope working directory", async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-wave1-"));
        const scopeRoot = path.join(tempRoot, "c64scope");
        await mkdir(scopeRoot, { recursive: true });
        const discovery = {
            local: {
                mirror: {
                    rootPath: path.join(tempRoot, "test-data"),
                    resolvedRootPath: path.join(tempRoot, "test-data"),
                    fileCount: 19,
                    directoryCount: 12,
                    symlinkCount: 1,
                    maxDepth: 4,
                    formatCounts: { sid: 2 },
                    topLevelEntries: ["SID"],
                    sampleFiles: [],
                    sampleDirectories: [],
                    symlinks: [],
                },
                hvscTarget: null,
            },
            device: {
                rootPath: "/USB2/test-data",
                sidPath: "/USB2/test-data/SID",
                topLevelEntries: ["SID", "d64"],
                d64Entries: ["last-ninja"],
                sidEntriesSample: ["Track1.sid", "Track2.sid"],
                hvscRootEntries: ["C64Music"],
                sidCandidates: ["Track1.sid", "Track2.sid"],
                multiDiskDirectories: ["last-ninja"],
                approximateFileCount: 60759,
                approximateDirectoryCount: 1996,
                approximateMaxDepth: 6,
                approximationBasis: "local parity",
            },
        };

        resolvePreferredPhysicalTestDeviceSerialMock.mockResolvedValue("serial-wave1");
        runPreflightMock.mockResolvedValue({
            ready: true,
            checks: [{ name: "adb", status: "pass", detail: "ok" }],
        });
        discoverMirroredCorporaMock.mockResolvedValue(discovery);
        runCaseMock
            .mockResolvedValueOnce({
                caseId: "AF-PLAY-CONTINUITY-001",
                outcome: "pass",
                failureClass: "none",
                runId: "run-1",
                artifactDir: "/tmp/run-1",
            })
            .mockResolvedValueOnce({
                caseId: "AF-PLAY-AUTOSKIP-001",
                outcome: "pass",
                failureClass: "none",
                runId: "run-2",
                artifactDir: "/tmp/run-2",
            })
            .mockResolvedValueOnce({
                caseId: "AF-PLAY-CONTINUITY-001",
                outcome: "pass",
                failureClass: "none",
                runId: "run-3",
                artifactDir: "/tmp/run-3",
            })
            .mockResolvedValueOnce({
                caseId: "AF-PLAY-AUTOSKIP-001",
                outcome: "pass",
                failureClass: "none",
                runId: "run-4",
                artifactDir: "/tmp/run-4",
            });
        process.env["REPEAT"] = "2";
        process.chdir(scopeRoot);

        const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
        const { main } = await import("../src/agenticExploratoryWave1.js");

        try {
            await main();
            expect(resolvePreferredPhysicalTestDeviceSerialMock).toHaveBeenCalledTimes(1);
            expect(runPreflightMock).toHaveBeenCalledWith({ deviceSerial: "serial-wave1", c64uHost: "c64u" });
            expect(discoverMirroredCorporaMock).toHaveBeenCalledWith(tempRoot, "c64u");
            expect(runCaseMock).toHaveBeenCalledTimes(4);
            expect(runCaseMock).toHaveBeenNthCalledWith(1, expect.objectContaining({ caseId: "AF-PLAY-CONTINUITY-001" }), "serial-wave1", "c64u", path.join(tempRoot, "c64scope", "artifacts"));
            expect(runCaseMock).toHaveBeenNthCalledWith(2, expect.objectContaining({ caseId: "AF-PLAY-AUTOSKIP-001" }), "serial-wave1", "c64u", path.join(tempRoot, "c64scope", "artifacts"));

            const runDirectories = await readdir(path.join(tempRoot, "c64scope", "artifacts"));
            expect(runDirectories).toHaveLength(1);
            const summary = await readFile(path.join(tempRoot, "c64scope", "artifacts", runDirectories[0]!, "summary.md"), "utf-8");
            expect(summary).toContain("Track1.sid");
            expect(summary).toContain("Resolved HVSC target files: unavailable");
            expect(logSpy).toHaveBeenCalledWith(expect.stringMatching(/Wave 1 summary written:/));
        } finally {
            logSpy.mockRestore();
            process.chdir(originalCwd);
            await rm(tempRoot, { recursive: true, force: true });
        }
    });

    it("uses explicit serial and host overrides and fails fast on preflight errors", async () => {
        process.env["ANDROID_SERIAL"] = "serial-explicit";
        process.env["C64U_HOST"] = "c64u-lab";
        runPreflightMock.mockResolvedValue({
            ready: false,
            checks: [
                { name: "adb", status: "fail", detail: "missing" },
                { name: "c64u", status: "warn", detail: "slow" },
                { name: "android", status: "pass", detail: "ok" },
            ],
        });
        resolveAdbSerialMock.mockResolvedValue("serial-resolved");

        const { main } = await import("../src/agenticExploratoryWave1.js");

        await expect(main()).rejects.toThrow(/Wave 1 preflight failed: adb: missing; c64u: slow/);
        expect(resolveAdbSerialMock).toHaveBeenCalledWith("serial-explicit");
        expect(resolvePreferredPhysicalTestDeviceSerialMock).not.toHaveBeenCalled();
        expect(discoverMirroredCorporaMock).not.toHaveBeenCalled();
        expect(runCaseMock).not.toHaveBeenCalled();
    });

    it("includes resolved hvsc details and default repeat handling when overrides are absent", async () => {
        const tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-wave1-hvsc-"));
        await mkdir(tempRoot, { recursive: true });
        resolvePreferredPhysicalTestDeviceSerialMock.mockResolvedValue("serial-default");
        runPreflightMock.mockResolvedValue({
            ready: true,
            checks: [{ name: "adb", status: "pass", detail: "ok" }],
        });
        discoverMirroredCorporaMock.mockResolvedValue({
            local: {
                mirror: {
                    rootPath: path.join(tempRoot, "test-data"),
                    resolvedRootPath: path.join(tempRoot, "test-data"),
                    fileCount: 1,
                    directoryCount: 1,
                    symlinkCount: 1,
                    maxDepth: 1,
                    formatCounts: { sid: 1 },
                    topLevelEntries: ["sid"],
                    sampleFiles: [],
                    sampleDirectories: [],
                    symlinks: [],
                },
                hvscTarget: {
                    rootPath: "/real/hvsc",
                    resolvedRootPath: "/real/hvsc",
                    fileCount: 99,
                    directoryCount: 12,
                    symlinkCount: 0,
                    maxDepth: 6,
                    formatCounts: { sid: 99 },
                    topLevelEntries: ["C64Music"],
                    sampleFiles: [],
                    sampleDirectories: [],
                    symlinks: [],
                },
            },
            device: {
                rootPath: "/USB2/test-data",
                sidPath: "/USB2/test-data/SID",
                topLevelEntries: ["SID"],
                d64Entries: [],
                sidEntriesSample: ["Tune.sid"],
                hvscRootEntries: ["C64Music"],
                sidCandidates: ["Tune.sid"],
                multiDiskDirectories: [],
                approximateFileCount: 100,
                approximateDirectoryCount: 13,
                approximateMaxDepth: 6,
                approximationBasis: "parity",
            },
        });
        runCaseMock.mockResolvedValue({
            caseId: "AF-PLAY-CONTINUITY-001",
            outcome: "pass",
            failureClass: "none",
            runId: "run-default",
            artifactDir: "/tmp/run-default",
        });
        process.chdir(tempRoot);

        const { main } = await import("../src/agenticExploratoryWave1.js");

        try {
            await main();
            expect(runCaseMock).toHaveBeenCalledTimes(6);
            const runDirectories = await readdir(path.join(tempRoot, "c64scope", "artifacts"));
            const summary = await readFile(path.join(tempRoot, "c64scope", "artifacts", runDirectories[0]!, "summary.md"), "utf-8");
            expect(summary).toContain("Resolved HVSC target files: 99");
            expect(summary).toContain("Repeat count: 3");
        } finally {
            process.chdir(originalCwd);
            await rm(tempRoot, { recursive: true, force: true });
        }
    });
});
