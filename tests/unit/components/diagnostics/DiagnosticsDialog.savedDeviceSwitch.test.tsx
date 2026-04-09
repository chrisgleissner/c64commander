/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { type ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DiagnosticsDialog } from "@/components/diagnostics/DiagnosticsDialog";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import type { OverallHealthState } from "@/lib/diagnostics/healthModel";

const healthyHealthState: OverallHealthState = {
  state: "Healthy",
  connectivity: "Online",
  host: "c64u",
  connectedDeviceLabel: "Office U64",
  problemCount: 0,
  contributors: {
    App: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
    REST: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
    FTP: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
    TELNET: { state: "Healthy", problemCount: 0, totalOperations: 1, failedOperations: 0 },
  },
  lastRestActivity: null,
  lastFtpActivity: null,
  lastTelnetActivity: null,
  primaryProblem: null,
};

const renderInProviders = (ui: ReactNode) =>
  render(
    <MemoryRouter>
      <QueryClientProvider
        client={
          new QueryClient({
            defaultOptions: {
              queries: { retry: false },
              mutations: { retry: false },
            },
          })
        }
      >
        <DisplayProfileProvider>{ui}</DisplayProfileProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );

describe("DiagnosticsDialog saved-device switching", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it("removes saved-device switching controls from diagnostics and keeps device management in overflow", () => {
    renderInProviders(
      <DiagnosticsDialog
        open
        onOpenChange={vi.fn()}
        healthState={healthyHealthState}
        logs={[]}
        errorLogs={[]}
        traceEvents={[]}
        actionSummaries={[]}
        onShareAll={vi.fn()}
        onShareFiltered={vi.fn()}
        onClearAll={vi.fn()}
        onRetryConnection={vi.fn()}
      />,
    );

    expect(screen.queryByTestId("diagnostics-devices")).toBeNull();
    expect(screen.queryByTestId("diagnostics-devices-toggle")).toBeNull();
    expect(screen.queryByText("Switch saved devices from diagnostics.")).toBeNull();

    fireEvent.click(screen.getByTestId("diagnostics-overflow-menu"));

    expect(screen.getByTestId("diagnostics-connection-details-action")).toBeVisible();
    expect(screen.getByTestId("diagnostics-manage-devices-action")).toBeVisible();
  });
});
