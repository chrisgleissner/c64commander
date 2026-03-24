/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/query/c64QueryInvalidation", () => ({
    invalidateForVisibilityResume: vi.fn(),
}));

vi.mock("@/lib/diagnostics/healthCheckEngine", () => ({
    recoverStaleHealthCheckRun: vi.fn(),
    isHealthCheckRunning: vi.fn(),
}));

import { getDecisionStateSnapshot, resetDecisionStateSnapshot, setPlaybackDecisionState } from "@/lib/diagnostics/decisionState";
import { runConfigReconciler, runDiagnosticsReconciler, runPlaybackReconciler, runRepair } from "@/lib/diagnostics/diagnosticsReconciler";
import { resetHealthCheckStateSnapshot, setHealthCheckStateSnapshot } from "@/lib/diagnostics/healthCheckState";
import { invalidateForVisibilityResume } from "@/lib/query/c64QueryInvalidation";
import { isHealthCheckRunning, recoverStaleHealthCheckRun } from "@/lib/diagnostics/healthCheckEngine";

const invalidateForVisibilityResumeMock = vi.mocked(invalidateForVisibilityResume);
const recoverStaleHealthCheckRunMock = vi.mocked(recoverStaleHealthCheckRun);
const isHealthCheckRunningMock = vi.mocked(isHealthCheckRunning);

describe("diagnosticsReconciler", () => {
    beforeEach(() => {
        resetDecisionStateSnapshot();
        resetHealthCheckStateSnapshot();
        vi.clearAllMocks();
    });

    afterEach(() => {
        resetDecisionStateSnapshot();
        resetHealthCheckStateSnapshot();
    });

    it("reports stale diagnostics recovery when a stuck health check is converted", async () => {
        recoverStaleHealthCheckRunMock.mockReturnValue(true);
        setHealthCheckStateSnapshot({ runState: "TIMEOUT" });

        await expect(runDiagnosticsReconciler("resume diagnostics")).resolves.toEqual({
            driftDetected: true,
            actionsTaken: ["Converted stale health-check run to TIMEOUT"],
            detail: "Recovered a stale health-check run",
        });

        expect(getDecisionStateSnapshot().reconcilers.diagnostics).toMatchObject({
            result: "success",
            driftDetected: true,
            actionsTaken: ["Converted stale health-check run to TIMEOUT"],
            detail: "Recovered a stale health-check run",
        });
    });

    it("keeps diagnostics successful when the health check is still actively running", async () => {
        recoverStaleHealthCheckRunMock.mockReturnValue(false);
        setHealthCheckStateSnapshot({ runState: "RUNNING" });

        await expect(runDiagnosticsReconciler("poll diagnostics")).resolves.toEqual({
            driftDetected: false,
            actionsTaken: [],
            detail: "Health check still within its active time budget",
        });
    });

    it("records a diagnostics failure and rethrows reconciliation errors", async () => {
        recoverStaleHealthCheckRunMock.mockImplementation(() => {
            throw new Error("snapshot unavailable");
        });

        await expect(runDiagnosticsReconciler("poll diagnostics")).rejects.toThrow("snapshot unavailable");
        expect(getDecisionStateSnapshot().reconcilers.diagnostics).toMatchObject({
            result: "failure",
            detail: "snapshot unavailable",
        });
    });

    it("invalidates route queries during config reconciliation", async () => {
        const queryClient = {} as never;

        await expect(runConfigReconciler(queryClient, "/home", "visibility resume")).resolves.toEqual({
            driftDetected: false,
            actionsTaken: ["Invalidated and refetched active route queries for /home"],
            detail: "Re-synced UI config views from device-backed queries",
        });

        expect(invalidateForVisibilityResumeMock).toHaveBeenCalledWith(queryClient, "/home");
        expect(getDecisionStateSnapshot().reconcilers.config).toMatchObject({
            result: "success",
            detail: "Re-synced UI config views from device-backed queries",
        });
    });

    it("records a config reconciliation failure when invalidation throws", async () => {
        invalidateForVisibilityResumeMock.mockImplementation(() => {
            throw new Error("query invalidation failed");
        });

        await expect(runConfigReconciler({} as never, "", "visibility resume")).rejects.toThrow(
            "query invalidation failed",
        );
        expect(getDecisionStateSnapshot().reconcilers.config).toMatchObject({
            result: "failure",
            detail: "query invalidation failed",
        });
    });

    it("marks playback uncertain after a diagnostics timeout when no health check is running", async () => {
        isHealthCheckRunningMock.mockReturnValue(false);
        setPlaybackDecisionState({
            state: "PLAYING",
            confidence: "HIGH",
            reason: "Playback detected",
            sourceKind: "hvsc",
            currentItemId: "song-1",
            elapsedMs: 42,
            lastUpdatedAt: "2025-01-01T00:00:00.000Z",
        });
        setHealthCheckStateSnapshot({ runState: "TIMEOUT" });

        await expect(runPlaybackReconciler("timeout follow-up")).resolves.toEqual({
            driftDetected: false,
            actionsTaken: ["Marked playback state UNKNOWN/LOW after diagnostics timeout"],
            detail: "Marked playback state UNKNOWN/LOW after diagnostics timeout",
        });

        expect(getDecisionStateSnapshot().playback).toMatchObject({
            state: "UNKNOWN",
            confidence: "LOW",
            reason: "Device health-check timed out; playback certainty reduced",
        });
    });

    it("reports the adjusted playback confidence when no timeout recovery is needed", async () => {
        isHealthCheckRunningMock.mockReturnValue(true);
        setPlaybackDecisionState({
            state: "PLAYING",
            confidence: "HIGH",
            reason: "Playback detected",
            sourceKind: "hvsc",
            currentItemId: "song-1",
            elapsedMs: 42,
            lastUpdatedAt: "2025-01-01T00:00:00.000Z",
        });
        setHealthCheckStateSnapshot({ runState: "COMPLETED" });

        await expect(runPlaybackReconciler("idle check")).resolves.toEqual({
            driftDetected: false,
            actionsTaken: ["Adjusted playback confidence to LOW"],
            detail: "Adjusted playback confidence to LOW",
        });
    });

    it("runs the full repair sequence and records success or failure", async () => {
        recoverStaleHealthCheckRunMock.mockReturnValue(false);
        isHealthCheckRunningMock.mockReturnValue(true);
        invalidateForVisibilityResumeMock.mockReset();
        const queryClient = {} as never;

        await expect(runRepair(queryClient, "/diagnostics", "manual repair")).resolves.toBeUndefined();
        expect(getDecisionStateSnapshot()).toMatchObject({
            lastRepairResult: "success",
        });

        invalidateForVisibilityResumeMock.mockImplementationOnce(() => {
            throw new Error("repair failed");
        });

        await expect(runRepair(queryClient, "/diagnostics", "manual repair")).rejects.toThrow("repair failed");
        expect(getDecisionStateSnapshot()).toMatchObject({
            lastRepairResult: "failure",
        });
    });
});
