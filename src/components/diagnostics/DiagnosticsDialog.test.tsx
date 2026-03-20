import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import type { OverallHealthState } from "@/lib/diagnostics/healthModel";

const setViewportWidth = (width: number) => {
    Object.defineProperty(window, "innerWidth", {
        configurable: true,
        writable: true,
        value: width,
    });
};

const renderDialog = (props?: Partial<typeof defaultProps>) =>
    render(
        <DisplayProfileProvider>
            <DiagnosticsDialog {...defaultProps} {...props} />
        </DisplayProfileProvider>,
    );

const healthyHealthState: OverallHealthState = {
    state: "Healthy",
    connectivity: "Online",
    host: "c64u",
    connectedDeviceLabel: "C64U",
    problemCount: 0,
    contributors: {
        App: { state: "Healthy", problemCount: 0, totalOperations: 3, failedOperations: 0 },
        REST: { state: "Healthy", problemCount: 0, totalOperations: 4, failedOperations: 0 },
        FTP: { state: "Healthy", problemCount: 0, totalOperations: 2, failedOperations: 0 },
    },
    lastRestActivity: { operation: "GET /v1/info", result: "200", timestampMs: Date.now() - 5_000 },
    lastFtpActivity: { operation: "LIST /Usb0", result: "success", timestampMs: Date.now() - 8_000 },
    primaryProblem: null,
};

const unhealthyHealthState: OverallHealthState = {
    ...healthyHealthState,
    state: "Unhealthy",
    problemCount: 1,
    contributors: {
        ...healthyHealthState.contributors,
        REST: { state: "Unhealthy", problemCount: 1, totalOperations: 4, failedOperations: 2 },
    },
    primaryProblem: {
        id: "problem-1",
        title: "PUT /v1/configs/Audio/Volume failed",
        contributor: "REST",
        timestampMs: Date.now() - 10_000,
        impactLevel: 2,
        causeHint: "HTTP 403",
    },
};

const offlineHealthState: OverallHealthState = {
    ...healthyHealthState,
    state: "Unavailable",
    connectivity: "Offline",
    connectedDeviceLabel: null,
};

const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    healthState: healthyHealthState,
    logs: [
        {
            id: "log-1",
            level: "info" as const,
            message: "Configuration updated successfully",
            timestamp: new Date(Date.now() - 4_000).toISOString(),
        },
    ],
    errorLogs: [
        {
            id: "error-1",
            level: "error" as const,
            message: "Failed to save audio profile",
            timestamp: new Date(Date.now() - 6_000).toISOString(),
            details: { code: "E_AUDIO" },
        },
    ],
    traceEvents: [
        {
            id: "trace-1",
            timestamp: new Date(Date.now() - 5_000).toISOString(),
            relativeMs: 0,
            type: "rest-response" as const,
            origin: "user" as const,
            correlationId: "action-1",
            data: {
                lifecycleState: "foreground" as const,
                sourceKind: null,
                localAccessMode: null,
                trackInstanceId: null,
                playlistItemId: null,
                method: "GET",
                path: "/v1/info",
                status: 200,
            },
        },
    ],
    actionSummaries: [
        {
            correlationId: "action-1",
            actionName: "Configuration updated successfully",
            origin: "user" as const,
            originalOrigin: "user" as const,
            startTimestamp: new Date(Date.now() - 7_000).toISOString(),
            endTimestamp: new Date(Date.now() - 6_500).toISOString(),
            durationMs: 500,
            outcome: "success" as const,
            startRelativeMs: 0,
            effects: [
                {
                    type: "REST" as const,
                    label: "Save",
                    method: "PUT",
                    path: "/v1/configs",
                    target: null,
                    status: 200,
                    durationMs: 500,
                },
            ],
        },
    ],
    onShareAll: vi.fn(),
    onShareFiltered: vi.fn(),
    onClearAll: vi.fn(),
    onRetryConnection: vi.fn(),
    connectionCallbacks: {
        onRetryConnection: vi.fn().mockResolvedValue({ success: true, message: "Connected to c64u" }),
        onSwitchDevice: vi.fn().mockResolvedValue({ success: true, message: "Switched to c64u-backup" }),
    },
    deviceInfo: null,
    healthCheckRunning: false,
    onRunHealthCheck: vi.fn(),
    lastHealthCheckResult: {
        runId: "hc-1",
        startTimestamp: new Date(Date.now() - 60_000).toISOString(),
        endTimestamp: new Date(Date.now() - 59_000).toISOString(),
        totalDurationMs: 1000,
        overallHealth: "Healthy" as const,
        probes: {
            REST: { probe: "REST" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 0 },
            FTP: { probe: "FTP" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 100 },
            CONFIG: { probe: "CONFIG" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 200 },
            RASTER: { probe: "RASTER" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 300 },
            JIFFY: { probe: "JIFFY" as const, outcome: "Success" as const, durationMs: 100, reason: null, startMs: 400 },
        },
        latency: { p50: 10, p90: 20, p99: 30 },
        deviceInfo: null,
    },
    liveHealthCheckProbes: null,
};

describe("DiagnosticsDialog", () => {
    it("shows only the summary card on first open in healthy mode", () => {
        localStorage.clear();
        setViewportWidth(600);

        renderDialog();

        expect(screen.getByTestId("status-summary-card")).toBeVisible();
        expect(screen.getByText("Healthy")).toBeVisible();
        expect(screen.getByText("C64U")).toBeVisible();
        expect(screen.getByText("All systems working.")).toBeVisible();
        expect(screen.queryByTestId("issue-card")).toBeNull();
        expect(screen.queryByTestId("evidence-preview-card")).toBeNull();
        expect(screen.queryByTestId("technical-details-card")).toBeNull();
        expect(screen.queryByTestId("tools-card")).toBeNull();
        expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();
    });

    it("shows only the dominant summary card on first open in unhealthy mode", () => {
        localStorage.clear();
        setViewportWidth(600);

        renderDialog({ healthState: unhealthyHealthState });

        expect(screen.getByTestId("status-summary-card")).toBeVisible();
        expect(screen.getByText("Needs attention")).toBeVisible();
        expect(screen.queryByTestId("issue-card")).toBeNull();
        expect(screen.queryByTestId("evidence-preview-card")).toBeNull();
        expect(screen.queryByTestId("evidence-full-view")).toBeNull();
    });

    it("shows retry and switch-device actions on the offline summary card without exposing diagnostics tools", () => {
        localStorage.clear();
        setViewportWidth(600);

        renderDialog({ healthState: offlineHealthState });

        expect(screen.getByText("Device not reachable")).toBeVisible();
        expect(screen.getByTestId("retry-connection-action")).toBeVisible();
        expect(screen.getByTestId("switch-device-toggle")).toBeVisible();
        expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();
        expect(screen.queryByTestId("tools-card")).toBeNull();
    });

    it("reveals the issue card and disclosure cards after unhealthy issue disclosure", () => {
        localStorage.clear();
        setViewportWidth(600);

        renderDialog({ healthState: unhealthyHealthState });

        fireEvent.click(screen.getByTestId("show-details-button"));

        expect(screen.getByTestId("issue-card")).toBeVisible();
        expect(screen.getByTestId("evidence-preview-card")).toBeVisible();
        expect(screen.getByTestId("technical-details-card")).toBeVisible();
        expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();
        expect(screen.queryByTestId("evidence-full-view")).toBeNull();
    });

    it("reveals collapsed evidence and technical cards after healthy disclosure", () => {
        localStorage.clear();
        setViewportWidth(600);

        renderDialog();

        fireEvent.click(screen.getByTestId("show-details-button"));

        expect(screen.getByTestId("diagnostics-subtitle")).not.toHaveClass("hidden");
        expect(screen.getByTestId("evidence-preview-card")).toBeVisible();
        expect(screen.getByTestId("technical-details-card")).toBeVisible();
        expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();
        expect(screen.queryByTestId("refine-button")).toBeNull();
    });

    it("shows up to three human-readable preview items only after expanding the evidence preview", () => {
        localStorage.clear();
        setViewportWidth(600);

        renderDialog();

        fireEvent.click(screen.getByTestId("show-details-button"));
        fireEvent.click(screen.getByTestId("evidence-preview-toggle"));

        expect(screen.getByTestId("preview-item-action-1")).toBeVisible();
        expect(screen.getByText("Configuration updated successfully")).toBeVisible();
        expect(screen.queryAllByTestId(/preview-item-/).length).toBeLessThanOrEqual(3);
    });

    it("keeps filters hidden until the tools card is expanded", () => {
        localStorage.clear();
        setViewportWidth(600);

        renderDialog();

        fireEvent.click(screen.getByTestId("show-details-button"));

        expect(screen.queryByTestId("tools-card")).toBeNull();
        expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();

        fireEvent.click(screen.getByTestId("technical-details-toggle"));

        expect(screen.getByTestId("tools-card")).toBeVisible();
        expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();

        fireEvent.click(screen.getByTestId("tools-card-toggle"));

        expect(screen.getByTestId("diagnostics-filter-input")).toBeVisible();
        expect(screen.getByTestId("evidence-full-view")).toBeVisible();
        expect(screen.getByTestId("diagnostics-share-all")).toBeVisible();
    });

    it("opens the full activity tools flow from the preview card CTA", () => {
        localStorage.clear();
        setViewportWidth(600);

        renderDialog();

        fireEvent.click(screen.getByTestId("show-details-button"));
        fireEvent.click(screen.getByTestId("evidence-preview-toggle"));
        fireEvent.click(screen.getByTestId("view-all-activity"));

        expect(screen.getByTestId("tools-card")).toBeVisible();
        expect(screen.getByTestId("diagnostics-filter-input")).toBeVisible();
        expect(screen.getByTestId("evidence-full-view")).toBeVisible();
    });
});
