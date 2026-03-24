/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/diagnostics/configDrift", () => ({
  computeConfigDrift: vi.fn(),
}));

import { ConfigDriftView } from "@/components/diagnostics/ConfigDriftView";
import { computeConfigDrift } from "@/lib/diagnostics/configDrift";

const computeConfigDriftMock = vi.mocked(computeConfigDrift);

describe("ConfigDriftView", () => {
  it("renders grouped drift items after a successful load", async () => {
    computeConfigDriftMock.mockResolvedValue({
      timestamp: "2025-01-01T00:00:00.000Z",
      error: null,
      driftItems: [
        {
          category: "Audio",
          item: "Volume",
          persistedValue: "10",
          runtimeValue: "12",
        },
      ],
    });

    render(<ConfigDriftView onBack={vi.fn()} />);

    expect(screen.getByTestId("config-drift-loading")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId("config-drift-results")).toBeInTheDocument();
    });

    expect(screen.getByText("Audio")).toBeInTheDocument();
    expect(screen.getByText("Volume")).toBeInTheDocument();
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows the no-drift state and supports refreshing", async () => {
    computeConfigDriftMock.mockResolvedValue({
      timestamp: "2025-01-01T00:00:00.000Z",
      error: null,
      driftItems: [],
    });

    render(<ConfigDriftView onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("config-drift-no-drift")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("config-drift-refresh"));

    await waitFor(() => {
      expect(computeConfigDriftMock).toHaveBeenCalledTimes(2);
    });
  });

  it("shows an error message when drift loading fails", async () => {
    computeConfigDriftMock.mockRejectedValue(new Error("drift unavailable"));

    render(<ConfigDriftView onBack={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId("config-drift-error")).toHaveTextContent("drift unavailable");
    });
  });
});