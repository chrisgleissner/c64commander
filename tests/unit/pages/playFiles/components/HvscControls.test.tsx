/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { ReactNode } from "react";
import { Capacitor } from "@capacitor/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HvscControls, type HvscControlsProps } from "@/pages/playFiles/components/HvscControls";

const buildProps = (overrides: Partial<HvscControlsProps> = {}): HvscControlsProps => ({
  hvscInstalledVersion: null,
  hvscAvailable: true,
  hvscUpdating: false,
  hvscInProgress: false,
  hvscCanIngest: false,
  hvscPreparationState: "NOT_PRESENT",
  hvscPreparationStatusLabel: "Not installed",
  hvscStage: null,
  hvscStagePercent: null,
  hvscPreparationFailedPhase: null,
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
  onInstall: vi.fn(),
  onIngest: vi.fn(),
  onCancel: vi.fn(),
  onReindex: vi.fn(),
  onReset: vi.fn(),
  ...overrides,
});

/**
 * Renders the card and opens it. The card is closed on a first visit — it is a maintenance panel
 * (download / ingest / reindex) and the archive is prepared automatically the first time a
 * listener picks HVSC — so every assertion about its contents has to open it first.
 */
const renderOpen = (props: HvscControlsProps) => {
  const view = render(<HvscControls {...props} />);
  fireEvent.click(screen.getByTestId("play-section-toggle-hvsc"));
  return view;
};

// Framer's enter animation starts the card body at `opacity: 0`, which jest-dom reports as not
// visible, so the real library makes every assertion about the opened body fail in jsdom.
vi.mock("framer-motion", () => {
  const Motion = ({
    children,
    animate: _animate,
    initial: _initial,
    exit: _exit,
    transition: _transition,
    onAnimationComplete: _onAnimationComplete,
    ...rest
  }: Record<string, unknown> & { children?: ReactNode }) => <div {...rest}>{children}</div>;
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => <>{children}</>,
    motion: new Proxy({} as Record<string, unknown>, {
      get: (target, tag: string) => {
        target[tag] ??= (props: Record<string, unknown> & { children?: ReactNode }) => <Motion {...props} />;
        return target[tag];
      },
    }),
  };
});

describe("HvscControls", () => {
  afterEach(() => {
    // The card remembers whether it was opened, so one test's open card would be restored in the
    // next one and `renderOpen`'s click would close it.
    localStorage.clear();
  });

  it("hides Stop once work has stopped, while still showing where it got to", () => {
    // Showing the steps for more states than the old bar also kept Stop on screen after a cancel:
    // "is there something to show" and "is work running" are different questions.
    renderOpen(buildProps({ hvscPreparationState: "ERROR", hvscStage: "archive_extraction" }));

    expect(screen.queryByTestId("hvsc-stop")).toBeNull();
    expect(screen.getByTestId("hvsc-stage-steps-unpack")).toHaveAttribute("data-status", "failed");
  });

  it("shows Stop while work is actually running", () => {
    renderOpen(buildProps({ hvscPreparationState: "INGESTING", hvscStage: "archive_extraction" }));

    expect(screen.getByTestId("hvsc-stop")).toBeVisible();
  });

  it("holds the finished steps on screen once the library is reachable", async () => {
    // Measured on the device: the display vanished the instant preparation finished, so the
    // completion the user had been waiting for was never shown. It went 73%, then gone.
    const { rerender } = renderOpen(
      buildProps({ hvscPreparationState: "INGESTING", hvscStage: "sid_metadata_hydration" }),
    );

    rerender(<HvscControls {...buildProps({ hvscPreparationState: "READY", hvscStage: null })} />);

    for (const step of ["download", "unpack", "scan", "details"]) {
      expect(screen.getByTestId(`hvsc-stage-steps-${step}`)).toHaveAttribute("data-status", "done");
    }
  });

  it("exposes stable ids for the primary and advanced actions", () => {
    renderOpen(buildProps({ hvscCanIngest: true }));

    // The card container itself no longer carries an HTML id: it renders through
    // `CollapsibleSection` now, and nothing in the app or the docs addressed `#hvsc-controls`.
    // The action ids below are the part of this contract anything external actually uses.
    expect(screen.getByTestId("hvsc-controls")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Download HVSC" }).getAttribute("id")).toBe("hvsc-download");
    expect(screen.getByRole("button", { name: "Ingest HVSC" }).getAttribute("id")).toBe("hvsc-ingest");
    expect(screen.getByRole("button", { name: "Reindex HVSC" }).getAttribute("id")).toBe("hvsc-reindex");
    expect(screen.getByRole("button", { name: "Reset HVSC" }).getAttribute("id")).toBe("hvsc-reset");
  });

  it("restores the explicit download and ingest controls", () => {
    const onInstall = vi.fn();
    const onIngest = vi.fn();

    renderOpen(
      buildProps({
        hvscCanIngest: true,
        onInstall,
        onIngest,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Download HVSC" }));
    fireEvent.click(screen.getByRole("button", { name: "Ingest HVSC" }));

    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onIngest).toHaveBeenCalledTimes(1);
  });

  it("renders the ready summary and Add items browse guidance", () => {
    renderOpen(
      buildProps({
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
      }),
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
    renderOpen(
      buildProps({
        hvscUpdating: true,
        hvscCanIngest: true,
        hvscPreparationState: "INGESTING",
        hvscPreparationStatusLabel: "Indexing",
        hvscStage: "sid_metadata_parsing",
        hvscStagePercent: 67,
        hvscPreparationThroughputLabel: "42 items/s",
      }),
    );

    expect(screen.getByTestId("hvsc-progress")).toBeTruthy();
    expect(screen.getByText("Status: Indexing")).toBeTruthy();
    expect(screen.getByText("HVSC summary")).toBeTruthy();
    // The named stage, and that stage's own figure. There is no install-wide percentage to assert:
    // two attempts at one both failed on hardware, so what is shown is which step is running.
    expect(screen.getByTestId("hvsc-stage-steps-details")).toHaveAttribute("data-status", "active");
    expect(screen.getByTestId("hvsc-stage-steps-download")).toHaveAttribute("data-status", "done");
    expect(screen.getByTestId("hvsc-stage-steps-detail")).toHaveTextContent("67% · 42 items/s");
    expect(screen.getByRole("button", { name: "Download HVSC" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Ingest HVSC" })).toBeDisabled();
    expect(screen.getByTestId("hvsc-stop")).toBeVisible();
    expect(screen.getByRole("button", { name: "Reindex HVSC" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Reset HVSC" })).toBeDisabled();
  });

  it("renders cached-download guidance before reindexing", () => {
    renderOpen(
      buildProps({
        hvscCanIngest: true,
        hvscPreparationState: "DOWNLOADED",
        hvscPreparationStatusLabel: "Downloaded",
      }),
    );

    expect(screen.getByText("Status: Downloaded")).toBeTruthy();
    expect(
      screen.getByText("The archive download is complete. Advanced reindex uses the cached archive."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Reindex HVSC" })).toBeEnabled();
  });

  it("renders error details and dispatches advanced actions", () => {
    const onInstall = vi.fn();
    const onIngest = vi.fn();
    const onCancel = vi.fn();
    const onReindex = vi.fn();
    const onReset = vi.fn();

    renderOpen(
      buildProps({
        hvscCanIngest: true,
        hvscPreparationState: "ERROR",
        hvscPreparationStatusLabel: "Indexing failed",
        hvscPreparationErrorReason: "metadata parse failed",
        onInstall,
        onIngest,
        onCancel,
        onReindex,
        onReset,
      }),
    );

    expect(screen.getByText("HVSC preparation failed")).toBeTruthy();
    expect(screen.getByText("metadata parse failed")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Download HVSC" }));
    fireEvent.click(screen.getByRole("button", { name: "Ingest HVSC" }));
    fireEvent.click(screen.getByRole("button", { name: "Reindex HVSC" }));
    fireEvent.click(screen.getByRole("button", { name: "Reset HVSC" }));

    expect(onInstall).toHaveBeenCalledTimes(1);
    expect(onIngest).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(0);
    expect(onReindex).toHaveBeenCalledTimes(1);
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it("renders the web-specific unavailable guidance", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");

    renderOpen(buildProps({ hvscAvailable: false }));

    expect(screen.getByText("Status: Not installed")).toBeTruthy();
    expect(
      screen.getByText("HVSC is not available in web browsers. Install the Android or iOS app to use HVSC."),
    ).toBeTruthy();
  });

  it("renders the native unavailable guidance", () => {
    vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");

    renderOpen(buildProps({ hvscAvailable: false }));

    expect(screen.getByText("Status: Not installed")).toBeTruthy();
    expect(
      screen.getByText("HVSC controls are available on native builds or when a mock bridge is enabled."),
    ).toBeTruthy();
  });
});
