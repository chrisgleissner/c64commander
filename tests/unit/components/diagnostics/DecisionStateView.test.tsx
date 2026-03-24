/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DecisionStateView } from "@/components/diagnostics/DecisionStateView";
import { resetDecisionStateSnapshot, setPlaybackDecisionState, setReconcilerState } from "@/lib/diagnostics/decisionState";
import {
    resetHealthCheckStateSnapshot,
    setHealthCheckStateSnapshot,
} from "@/lib/diagnostics/healthCheckState";
import type { ActionSummary } from "@/lib/diagnostics/actionSummaries";

const makeActionSummary = (effects: ActionSummary["effects"]): ActionSummary => ({
    correlationId: "corr-1",
    actionName: "Refresh diagnostics",
    origin: "user",
    originalOrigin: "user",
    startTimestamp: "2025-01-01T10:00:00.000Z",
    endTimestamp: "2025-01-01T10:00:01.000Z",
    durationMs: 1000,
    outcome: "success",
    effects,
    startRelativeMs: 0,
});

describe("DecisionStateView", () => {
    beforeEach(() => {
        resetDecisionStateSnapshot();
        resetHealthCheckStateSnapshot();
    });

    afterEach(() => {
        resetDecisionStateSnapshot();
        resetHealthCheckStateSnapshot();
    });

    it("renders the fallback metrics when no recent transport effects exist", () => {
        render(
            <DecisionStateView onBack={vi.fn()} onRepair={vi.fn()} repairRunning={false} actionSummaries={[]} />,
        );

        expect(screen.getByTestId("decision-state-view")).toBeVisible();
        expect(screen.getByTestId("decision-state-transport")).toHaveTextContent("REST avg-");
        expect(screen.getByTestId("decision-state-transport")).toHaveTextContent("FTP avg-");
        expect(screen.getByText("No recent REST or FTP effects.")).toBeInTheDocument();
        expect(screen.getByTestId("decision-state-health-check")).toHaveTextContent("Run stateIDLE");
        expect(screen.getByTestId("decision-state-health-check")).toHaveTextContent("Run ID-");
    });

    it("renders populated decision, health-check, and transport metrics", () => {
        setPlaybackDecisionState({
            state: "PLAYING",
            confidence: "HIGH",
            reason: "Trace confirmed playback",
            sourceKind: "hvsc",
            currentItemId: "item-1",
            elapsedMs: 4321,
            lastUpdatedAt: "2025-01-01T10:00:00.000Z",
        });
        setReconcilerState(
            "config",
            {
                lastRunAt: "2025-01-01T10:00:02.000Z",
                result: "failure",
                driftDetected: true,
                actionsTaken: ["reloaded-config", "prompted-user"],
                detail: "Remote config differed from local cache",
            },
            "config drift detected",
        );
        setReconcilerState("playback", {
            lastRunAt: null,
            result: "success",
            driftDetected: false,
            actionsTaken: [],
            detail: null,
        });
        setHealthCheckStateSnapshot({
            runState: "FAILED",
            currentRunId: "hc-77",
            lastTransitionReason: "REST timeout",
            probeStates: {
                REST: {
                    state: "TIMEOUT",
                    outcome: null,
                    startedAt: null,
                    endedAt: null,
                    durationMs: 980,
                    reason: "REST timeout",
                },
                FTP: {
                    state: "SUCCESS",
                    outcome: "Success",
                    startedAt: null,
                    endedAt: null,
                    durationMs: 120,
                    reason: null,
                },
                CONFIG: {
                    state: "PENDING",
                    outcome: null,
                    startedAt: null,
                    endedAt: null,
                    durationMs: null,
                    reason: null,
                },
                RASTER: {
                    state: "PENDING",
                    outcome: null,
                    startedAt: null,
                    endedAt: null,
                    durationMs: null,
                    reason: null,
                },
                JIFFY: {
                    state: "PENDING",
                    outcome: null,
                    startedAt: null,
                    endedAt: null,
                    durationMs: null,
                    reason: null,
                },
            },
            transitions: [
                {
                    id: "health-transition-1",
                    timestamp: "2025-01-01T10:00:04.000Z",
                    scope: "probe",
                    target: "REST",
                    from: "RUNNING",
                    to: "TIMEOUT",
                    reason: "REST timeout",
                },
            ],
        });

        const actionSummaries: ActionSummary[] = [
            makeActionSummary([
                {
                    type: "REST",
                    label: "Fetch info",
                    method: "GET",
                    protocol: null,
                    hostname: null,
                    port: null,
                    path: "/v1/info",
                    query: null,
                    normalizedPath: null,
                    target: null,
                    status: 200,
                    durationMs: 240,
                },
                {
                    type: "FTP",
                    label: "List disks",
                    operation: "LIST",
                    command: null,
                    hostname: null,
                    port: null,
                    path: "/Usb0",
                    target: null,
                    result: "success",
                    durationMs: 120,
                    error: "Recovered after retry",
                },
            ]),
        ];

        render(
            <DecisionStateView onBack={vi.fn()} onRepair={vi.fn()} repairRunning={false} actionSummaries={actionSummaries} />,
        );

        expect(screen.getByTestId("decision-state-playback")).toHaveTextContent("PLAYING");
        expect(screen.getByTestId("decision-state-playback")).toHaveTextContent("HIGH");
        expect(screen.getByTestId("decision-state-playback")).toHaveTextContent("Trace confirmed playback");

        expect(screen.getByTestId("decision-state-reconcilers")).toHaveTextContent("failure");
        expect(screen.getByTestId("decision-state-reconcilers")).toHaveTextContent("yes");
        expect(screen.getByTestId("decision-state-reconcilers")).toHaveTextContent("reloaded-config | prompted-user");
        expect(screen.getByTestId("decision-state-reconcilers")).toHaveTextContent("Remote config differed from local cache");
        expect(screen.getByTestId("decision-state-reconcilers")).toHaveTextContent("no");

        expect(screen.getByTestId("decision-state-health-check")).toHaveTextContent("Run stateFAILED");
        expect(screen.getByTestId("decision-state-health-check")).toHaveTextContent("Run IDhc-77");
        expect(screen.getByTestId("decision-state-health-check")).toHaveTextContent("REST timeout");
        expect(screen.getByTestId("decision-state-health-check")).toHaveTextContent("TIMEOUT");

        expect(screen.getByTestId("decision-state-transport")).toHaveTextContent("REST avg240ms");
        expect(screen.getByTestId("decision-state-transport")).toHaveTextContent("FTP avg120ms");
        expect(screen.getByText("GET /v1/info")).toBeInTheDocument();
        expect(screen.getByText("status 200 · 240ms")).toBeInTheDocument();
        expect(screen.getByText("LIST /Usb0")).toBeInTheDocument();
        expect(screen.getByText("result success · 120ms · Recovered after retry")).toBeInTheDocument();

        expect(screen.getByTestId("decision-state-transitions")).toHaveTextContent("REST");
        expect(screen.getByTestId("decision-state-transitions")).toHaveTextContent("RUNNING to TIMEOUT");
        expect(screen.getByTestId("decision-state-transitions")).toHaveTextContent("config");
        expect(screen.getByTestId("decision-state-transitions")).toHaveTextContent("idle to failure");
    });

    it("invokes back and repair actions and disables repair while running", () => {
        const onBack = vi.fn();
        const onRepair = vi.fn();

        render(
            <DecisionStateView onBack={onBack} onRepair={onRepair} repairRunning={true} actionSummaries={[]} />,
        );

        fireEvent.click(screen.getByTestId("decision-state-back"));
        expect(onBack).toHaveBeenCalledOnce();

        const repairButton = screen.getByTestId("decision-state-repair");
        expect(repairButton).toBeDisabled();
        expect(repairButton).toHaveTextContent("Repairing");
    });

    it("renders transport entries without optional duration or reason text and omits empty transition reasons", () => {
        setHealthCheckStateSnapshot({
            transitions: [
                {
                    id: "health-transition-2",
                    timestamp: "2025-01-01T10:00:01.000Z",
                    scope: "probe",
                    target: "FTP",
                    from: null,
                    to: "SUCCESS",
                    reason: null,
                },
            ],
        });

        const actionSummaries: ActionSummary[] = [
            makeActionSummary([
                {
                    type: "REST",
                    label: "Read info",
                    method: "GET",
                    protocol: null,
                    hostname: null,
                    port: null,
                    path: "/v1/info",
                    query: null,
                    normalizedPath: null,
                    target: null,
                    status: null,
                    durationMs: null,
                },
            ]),
        ];

        render(
            <DecisionStateView onBack={vi.fn()} onRepair={vi.fn()} repairRunning={false} actionSummaries={actionSummaries} />,
        );

        expect(screen.getByTestId("decision-state-transport")).toHaveTextContent("GET /v1/info");
        expect(screen.getByText("status unknown")).toBeInTheDocument();

        const transitions = screen.getByTestId("decision-state-transitions");
        expect(transitions).toHaveTextContent("FTP");
        expect(transitions).toHaveTextContent("- to SUCCESS");
    });

    it("falls back to the latest health result reason and ignores non-transport effects in the transport summary", () => {
        setHealthCheckStateSnapshot({
            lastTransitionReason: null,
            latestResult: {
                runId: "hc-latest",
                startTimestamp: "2025-01-01T00:00:00.000Z",
                endTimestamp: "2025-01-01T00:00:01.000Z",
                totalDurationMs: 1000,
                overallHealth: "Healthy",
                probes: {
                    REST: { probe: "REST", outcome: "Success", durationMs: 100, reason: null, startMs: 0 },
                    FTP: { probe: "FTP", outcome: "Success", durationMs: 100, reason: null, startMs: 100 },
                    CONFIG: { probe: "CONFIG", outcome: "Success", durationMs: 100, reason: null, startMs: 200 },
                    RASTER: { probe: "RASTER", outcome: "Success", durationMs: 100, reason: null, startMs: 300 },
                    JIFFY: { probe: "JIFFY", outcome: "Success", durationMs: 100, reason: null, startMs: 400 },
                },
                latency: { p50: 10, p90: 20, p99: 30 },
            },
        });

        const actionSummaries: ActionSummary[] = [
            makeActionSummary([
                {
                    type: "ERROR",
                    label: "Error",
                    message: "Ignored for transport metrics",
                },
            ]),
        ];

        render(
            <DecisionStateView onBack={vi.fn()} onRepair={vi.fn()} repairRunning={false} actionSummaries={actionSummaries} />,
        );

        expect(screen.getByTestId("decision-state-health-check")).toHaveTextContent("ReasonHealthy");
        expect(screen.getByText("No recent REST or FTP effects.")).toBeInTheDocument();
    });
});
