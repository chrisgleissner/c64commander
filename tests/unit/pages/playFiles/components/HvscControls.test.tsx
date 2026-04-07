/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HvscControls, type HvscControlsProps } from "@/pages/playFiles/components/HvscControls";

const buildProps = (overrides: Partial<HvscControlsProps> = {}): HvscControlsProps => ({
  hvscInstalledVersion: null,
  hvscAvailable: true,
  hvscUpdating: false,
  hvscCanIngest: false,
  hvscPreparationState: "NOT_PRESENT",
  hvscPreparationStatusLabel: "Not installed",
  hvscPreparationProgressPercent: null,
  hvscPreparationThroughputLabel: null,
  hvscPreparationErrorReason: null,
  hvscReadySongCount: 0,
  hvscSummaryFilesExtracted: null,
  hvscSummaryDurationMs: null,
  hvscSummaryUpdatedAt: null,
  hvscMetadataProgressLabel: null,
  hvscMetadataUpdatedAt: null,
  hvscSonglengthSyntaxErrors: 0,
  formatHvscDuration: () => "0:00",
  formatHvscTimestamp: () => "never",
  onReindex: vi.fn(),
  onReset: vi.fn(),
  ...overrides,
});

describe("HvscControls", () => {
  it("exposes stable ids for the summary and advanced actions", () => {
    render(<HvscControls {...buildProps({ hvscCanIngest: true })} />);

    expect(screen.getByTestId("hvsc-controls").getAttribute("id")).toBe("hvsc-controls");
    expect(screen.getByRole("button", { name: "Reindex HVSC" }).getAttribute("id")).toBe("hvsc-reindex");
    expect(screen.getByRole("button", { name: "Reset HVSC" }).getAttribute("id")).toBe("hvsc-reset");
  });

  it("renders the ready summary and Add items browse guidance", () => {
    render(
      <HvscControls
        {...buildProps({
          hvscInstalledVersion: 84,
          hvscCanIngest: true,
          hvscPreparationState: "READY",
          hvscPreparationStatusLabel: "Ready",
          hvscReadySongCount: 118,
          hvscSummaryFilesExtracted: 12,
          hvscSummaryDurationMs: 5400,
          hvscSummaryUpdatedAt: "2026-03-29T18:00:00Z",
          hvscSonglengthSyntaxErrors: 2,
          formatHvscDuration: (value?: number | null) => `${value ?? 0}ms`,
          formatHvscTimestamp: (value?: string | null) => `at ${value}`,
        })}
      />,
    );

    expect(screen.getByText("Installed version 84")).toBeTruthy();
    expect(screen.getByText("Status: Ready")).toBeTruthy();
    expect(screen.getByText("HVSC ready")).toBeTruthy();
    expect(screen.getByTestId("hvsc-ready-source-hint")).toHaveTextContent("Ready to use: Add items -> HVSC.");
    expect(screen.getByText("118 songs indexed.")).toBeTruthy();
    expect(screen.getByText("2 songlength entries had syntax errors and were ignored.")).toBeTruthy();
    expect(screen.getByText("Files extracted: 12")).toBeTruthy();
    expect(screen.getByText("Duration: 5400ms")).toBeTruthy();
    expect(screen.getByText("Last updated: at 2026-03-29T18:00:00Z")).toBeTruthy();
  });

  it("renders preparation progress with throughput while indexing is active", () => {
    render(
      <HvscControls
        {...buildProps({
          hvscUpdating: true,
          hvscCanIngest: true,
          hvscPreparationState: "INGESTING",
          hvscPreparationStatusLabel: "Indexing",
          hvscPreparationProgressPercent: 67,
          hvscPreparationThroughputLabel: "42 items/s",
        })}
      />,
    );

    expect(screen.getByTestId("hvsc-progress")).toBeTruthy();
    expect(screen.getByText("Status: Indexing")).toBeTruthy();
    expect(screen.getByText("HVSC summary")).toBeTruthy();
    expect(screen.getByText("67%")).toBeTruthy();
    expect(screen.getByTestId("hvsc-download-bytes")).toHaveTextContent("42 items/s");
    expect(screen.getByRole("button", { name: "Reindex HVSC" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset HVSC" })).toBeDisabled();
  });

  it("renders cached-download guidance before reindexing", () => {
    render(
      <HvscControls
        {...buildProps({
          hvscCanIngest: true,
          hvscPreparationState: "DOWNLOADED",
          hvscPreparationStatusLabel: "Downloaded",
        })}
      />,
    );

    expect(screen.getByText("Status: Downloaded")).toBeTruthy();
    expect(
      screen.getByText("The archive download is complete. Advanced reindex uses the cached archive."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reindex HVSC" })).toBeEnabled();
  });

  it("renders error details and dispatches advanced actions", () => {
    const onReindex = vi.fn();
    const onReset = vi.fn();

    render(
      <HvscControls
        {...buildProps({
          hvscCanIngest: true,
          hvscPreparationState: "ERROR",
          hvscPreparationStatusLabel: "Indexing failed",
          hvscPreparationErrorReason: "metadata parse failed",
          onReindex,
          onReset,
        })}
      />,
    );

    expect(screen.getByText("HVSC preparation failed")).toBeTruthy();
    expect(screen.getByText("metadata parse failed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Reindex HVSC" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset HVSC" }));

    expect(onReindex).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders the web-specific unavailable guidance", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");

    render(<HvscControls {...buildProps({ hvscAvailable: false })} />);

    expect(screen.getByText("Status: Not installed")).toBeTruthy();
    expect(
      screen.getByText("HVSC is not available in web browsers. Install the Android or iOS app to use HVSC."),
    ).toBeTruthy();
  });

  it("renders the native unavailable guidance", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");

    render(<HvscControls {...buildProps({ hvscAvailable: false })} />);

    expect(screen.getByText("Status: Not installed")).toBeTruthy();
    expect(
      screen.getByText("HVSC controls are available on native builds or when a mock bridge is enabled."),
    ).toBeTruthy();
  });
});
