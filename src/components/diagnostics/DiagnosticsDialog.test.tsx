import { render, screen } from "@testing-library/react";
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

const idleHealthState: OverallHealthState = {
  state: "Idle",
  connectivity: "Online",
  host: "c64u",
  problemCount: 0,
  contributors: {
    App: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
    REST: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
    FTP: { state: "Idle", problemCount: 0, totalOperations: 0, failedOperations: 0 },
  },
  lastRestActivity: null,
  lastFtpActivity: null,
  primaryProblem: null,
};

const defaultProps = {
  open: true,
  onOpenChange: vi.fn(),
  healthState: idleHealthState,
  logs: [],
  errorLogs: [],
  traceEvents: [],
  actionSummaries: [],
  onShareAll: vi.fn(),
  onShareFiltered: vi.fn(),
  onClearAll: vi.fn(),
  onRetryConnection: vi.fn(),
};

describe("DiagnosticsDialog", () => {
  it("adds compact inner padding so the title and toolbar do not sit flush to the fullscreen shell", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    const title = screen.getByText("Diagnostics");
    expect(title.parentElement).toHaveClass("px-3");

    const shareAllButton = screen.getByTestId("diagnostics-share-all");
    expect(shareAllButton.parentElement).toHaveClass("px-3");
  });

  it("keeps medium and expanded padding aligned with tighter list-browser rhythm", () => {
    localStorage.clear();
    setViewportWidth(900);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    const title = screen.getByText("Diagnostics");
    expect(title.parentElement).toHaveClass("px-4");
    expect(title.parentElement).not.toHaveClass("px-6");

    const shareAllButton = screen.getByTestId("diagnostics-share-all");
    expect(shareAllButton.parentElement).toHaveClass("px-4");
    expect(shareAllButton.parentElement).not.toHaveClass("px-6");
  });

  it("shows the description text", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByText("Health, connectivity, and supporting evidence.")).toBeVisible();
  });

  it("shows empty session message when no data and no filters active", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-empty-message")).toBeVisible();
  });

  it("shows evidence type toggles — Problems and Actions active by default", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    const problemsBtn = screen.getByTestId("evidence-toggle-problems");
    const actionsBtn = screen.getByTestId("evidence-toggle-actions");
    const logsBtn = screen.getByTestId("evidence-toggle-logs");
    const tracesBtn = screen.getByTestId("evidence-toggle-traces");

    expect(problemsBtn).toHaveAttribute("aria-pressed", "true");
    expect(actionsBtn).toHaveAttribute("aria-pressed", "true");
    expect(logsBtn).toHaveAttribute("aria-pressed", "false");
    expect(tracesBtn).toHaveAttribute("aria-pressed", "false");
  });

  it("shows health summary with connectivity and overall health row", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          {...defaultProps}
          healthState={{ ...idleHealthState, state: "Healthy", connectivity: "Online" }}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("health-summary")).toBeVisible();
    expect(screen.getByTestId("overall-health-row")).toBeVisible();
  });

  it("shows contributor rows for App, REST, FTP", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("contributor-row-app")).toBeVisible();
    expect(screen.getByTestId("contributor-row-rest")).toBeVisible();
    expect(screen.getByTestId("contributor-row-ftp")).toBeVisible();
  });

  it("shows retry connection button when connectivity is Offline", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog
          {...defaultProps}
          healthState={{ ...idleHealthState, state: "Unavailable", connectivity: "Offline" }}
        />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("retry-connection-button")).toBeVisible();
  });

  it("does not show retry button when connectivity is Online", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.queryByTestId("retry-connection-button")).toBeNull();
  });

  it("shows search input on medium and expanded profiles", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-filter-input")).toBeVisible();
  });

  it("does not show search input on compact profile (behind Refine)", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.queryByTestId("diagnostics-filter-input")).toBeNull();
  });

  it("shows Share all and Share filtered buttons in toolbar", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("diagnostics-share-all")).toBeVisible();
    expect(screen.getByTestId("diagnostics-share-filtered")).toBeVisible();
    expect(screen.getByTestId("diagnostics-clear-all-trigger")).toBeVisible();
  });

  it("shows primary problem spotlight when healthState includes a primary problem", () => {
    localStorage.clear();
    setViewportWidth(600);

    const healthWithProblem: OverallHealthState = {
      ...idleHealthState,
      state: "Unhealthy",
      primaryProblem: {
        id: "prob-1",
        title: "GET /v1/machine failed",
        contributor: "REST",
        timestampMs: Date.now() - 10_000,
        impactLevel: 2,
        causeHint: "HTTP 500",
      },
    };

    render(
      <DisplayProfileProvider>
        <DiagnosticsDialog {...defaultProps} healthState={healthWithProblem} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("primary-problem-spotlight")).toBeVisible();
    expect(screen.getByText("Investigate now")).toBeVisible();
  });
});
