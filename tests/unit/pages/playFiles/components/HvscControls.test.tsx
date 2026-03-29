/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { Capacitor } from "@capacitor/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HvscControls, type HvscControlsProps } from "@/pages/playFiles/components/HvscControls";

const buildProps = (overrides: Partial<HvscControlsProps> = {}): HvscControlsProps => ({
  hvscInstalled: false,
  hvscInstalledVersion: null,
  hvscAvailable: true,
  hvscUpdating: false,
  hvscInProgress: false,
  hvscCanIngest: false,
  hvscPhase: "idle",
  hvscSummaryState: "idle",
  hvscSummaryFilesExtracted: null,
  hvscSummaryDurationMs: null,
  hvscSummaryUpdatedAt: null,
  hvscSummaryFailureLabel: "",
  hvscIngestionTotalSongs: 0,
  hvscIngestionIngestedSongs: 0,
  hvscIngestionFailedSongs: 0,
  hvscSonglengthSyntaxErrors: 0,
  hvscActionLabel: null,
  hvscDownloadBytes: null,
  hvscDownloadElapsedMs: null,
  hvscInlineError: null,
  formatHvscDuration: () => "0s",
  formatHvscTimestamp: () => "never",
  formatBytes: () => "0 B",
  onInstall: vi.fn(),
  onIngest: vi.fn(),
  onCancel: vi.fn(),
  onReset: vi.fn(),
  ...overrides,
});

describe("HvscControls", () => {
  it("exposes stable ids for maestro hvsc smoke selectors", () => {
    render(<HvscControls {...buildProps()} />);

    expect(screen.getByTestId("hvsc-controls")).toHaveAttribute("id", "hvsc-controls");
    expect(screen.getByRole("button", { name: "Download HVSC" })).toHaveAttribute("id", "hvsc-download");
    expect(screen.getByRole("button", { name: "Ingest HVSC" })).toHaveAttribute("id", "hvsc-ingest");
  });

  it("renders installed success state details and browse guidance", () => {
    render(
      <HvscControls
        {...buildProps({
          hvscInstalled: true,
          hvscInstalledVersion: 84,
          hvscCanIngest: true,
          hvscPhase: "ready",
          hvscSummaryState: "success",
          hvscSummaryFilesExtracted: 12,
          hvscSummaryDurationMs: 5400,
          hvscSummaryUpdatedAt: "2026-03-29T18:00:00Z",
          hvscIngestionTotalSongs: 120,
          hvscIngestionIngestedSongs: 118,
          hvscSonglengthSyntaxErrors: 2,
          formatHvscDuration: (value) => `${value ?? 0}ms`,
          formatHvscTimestamp: (value) => `at ${value}`,
        })}
      />,
    );

    expect(screen.getByText("Installed version 84")).toBeInTheDocument();
    expect(screen.getByText("Status: Ready")).toBeInTheDocument();
    expect(screen.getByText("HVSC downloaded successfully")).toBeInTheDocument();
    expect(screen.getByText("Ingested 118 of 120 songs.")).toBeInTheDocument();
    expect(screen.getByText("2 songlength entries had syntax errors and were ignored.")).toBeInTheDocument();
    expect(screen.getByText("Files extracted: 12")).toBeInTheDocument();
    expect(screen.getByText("Duration: 5400ms")).toBeInTheDocument();
    expect(screen.getByText("Last updated: at 2026-03-29T18:00:00Z")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset status" })).toBeInTheDocument();
    expect(
      screen.getByText("Browse and add HVSC songs from the shared “Add items” source chooser."),
    ).toBeInTheDocument();
  });

  it("renders failure, progress, and inline error details while ingestion is active", () => {
    render(
      <HvscControls
        {...buildProps({
          hvscUpdating: true,
          hvscInProgress: true,
          hvscCanIngest: true,
          hvscPhase: "extract",
          hvscSummaryState: "failure",
          hvscSummaryFailureLabel: "Archive checksum mismatch",
          hvscIngestionFailedSongs: 3,
          hvscActionLabel: "Extracting archive",
          hvscDownloadBytes: 6 * 1024 * 1024,
          hvscDownloadElapsedMs: 3200,
          hvscInlineError: "Temporary HVSC bridge error",
          formatHvscDuration: (value) => `${value ?? 0}ms`,
        })}
      />,
    );

    expect(screen.getByText("Status: Extracting")).toBeInTheDocument();
    expect(screen.getByText("HVSC download failed")).toBeInTheDocument();
    expect(screen.getByText("Archive checksum mismatch")).toBeInTheDocument();
    expect(screen.getByText("3 songs could not be imported. Check diagnostics logs for details.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset status" })).toBeDisabled();
    expect(screen.getByTestId("hvsc-stop")).toBeInTheDocument();
    expect(screen.getByTestId("hvsc-progress")).toBeInTheDocument();
    expect(screen.getByText("Extracting archive")).toBeInTheDocument();
    expect(screen.getByTestId("hvsc-download-bytes")).toHaveTextContent("6.0 MB · 3200ms");
    expect(screen.getByText("Temporary HVSC bridge error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download HVSC" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ingest HVSC" })).toBeDisabled();
  });

  it("renders the web-specific unavailable guidance", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");

    render(<HvscControls {...buildProps({ hvscAvailable: false, hvscPhase: "failed" })} />);

    expect(screen.getByText("Status: Failed")).toBeInTheDocument();
    expect(
      screen.getByText("HVSC is not available in web browsers. Install the Android or iOS app to use HVSC."),
    ).toBeInTheDocument();
  });

  it("renders the native unavailable guidance", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");

    render(<HvscControls {...buildProps({ hvscAvailable: false, hvscPhase: "download" })} />);

    expect(screen.getByText("Status: Downloading")).toBeInTheDocument();
    expect(
      screen.getByText("HVSC controls are available on native builds or when a mock bridge is enabled."),
    ).toBeInTheDocument();
  });
});
