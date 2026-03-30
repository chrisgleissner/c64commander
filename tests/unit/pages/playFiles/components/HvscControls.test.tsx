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

        expect(screen.getByTestId("hvsc-controls").getAttribute("id")).toBe("hvsc-controls");
        expect(screen.getByRole("button", { name: "Download HVSC" }).getAttribute("id")).toBe("hvsc-download");
        expect(screen.getByRole("button", { name: "Ingest HVSC" }).getAttribute("id")).toBe("hvsc-ingest");
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
                    formatHvscDuration: (value?: number | null) => `${value ?? 0}ms`,
                    formatHvscTimestamp: (value?: string | null) => `at ${value}`,
                })}
            />,
        );

        expect(screen.getByText("Installed version 84")).toBeTruthy();
        expect(screen.getByText("Status: Ready")).toBeTruthy();
        expect(screen.getByText("HVSC ready")).toBeTruthy();
        expect(screen.getByText("Indexed 118 of 120 songs.")).toBeTruthy();
        expect(screen.getByText("2 songlength entries had syntax errors and were ignored.")).toBeTruthy();
        expect(screen.getByText("Files extracted: 12")).toBeTruthy();
        expect(screen.getByText("Duration: 5400ms")).toBeTruthy();
        expect(screen.getByText("Last updated: at 2026-03-29T18:00:00Z")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Reset status" })).toBeTruthy();
        expect(screen.getByText("Browse and add HVSC songs from the shared “Add items” source chooser.")).toBeTruthy();
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
                    formatHvscDuration: (value?: number | null) => `${value ?? 0}ms`,
                })}
            />,
        );

        expect(screen.getByText("Status: Extracting")).toBeTruthy();
        expect(screen.getByText("HVSC update failed")).toBeTruthy();
        expect(screen.getByText("Archive checksum mismatch")).toBeTruthy();
        expect(screen.getByText("3 songs could not be imported. Check diagnostics logs for details.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Reset status" }).hasAttribute("disabled")).toBe(true);
        expect(screen.getByTestId("hvsc-stop")).toBeTruthy();
        expect(screen.getByTestId("hvsc-progress")).toBeTruthy();
        expect(screen.getByText("Extracting archive")).toBeTruthy();
        expect(screen.getByTestId("hvsc-download-bytes").textContent).toContain("6.0 MB · 3200ms");
        expect(screen.getByText("Temporary HVSC bridge error")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Download HVSC" }).hasAttribute("disabled")).toBe(true);
        expect(screen.getByRole("button", { name: "Ingest HVSC" }).hasAttribute("disabled")).toBe(true);
    });

    it("renders cache-only success guidance before the library has been ingested", () => {
        render(
            <HvscControls
                {...buildProps({
                    hvscSummaryState: "success",
                    hvscSummaryFilesExtracted: 12,
                    hvscSummaryDurationMs: 5400,
                    hvscSummaryUpdatedAt: "2026-03-29T18:00:00Z",
                    formatHvscDuration: (value?: number | null) => `${value ?? 0}ms`,
                    formatHvscTimestamp: (value?: string | null) => `at ${value}`,
                })}
            />,
        );

        expect(screen.getByText("HVSC ready")).toBeTruthy();
        expect(screen.getByText("HVSC archives are cached. Run Ingest HVSC to build the browseable library.")).toBeTruthy();
        expect(screen.queryByText("Browse and add HVSC songs from the shared “Add items” source chooser.")).toBeNull();
    });

    it("renders progress fallback text when download byte totals are unavailable", () => {
        render(
            <HvscControls
                {...buildProps({
                    hvscUpdating: true,
                    hvscInProgress: true,
                    hvscPhase: "download",
                    hvscActionLabel: null,
                    hvscDownloadBytes: null,
                    hvscDownloadElapsedMs: null,
                })}
            />,
        );

        expect(screen.getByTestId("hvsc-progress")).toBeTruthy();
        expect(screen.getByText("Processing HVSC…")).toBeTruthy();
        expect(screen.getByTestId("hvsc-download-bytes").textContent).toBe("—");
    });

    it("shows reset controls for inline errors even when no summary card is visible", () => {
        render(
            <HvscControls
                {...buildProps({
                    hvscInlineError: "Temporary HVSC bridge error",
                })}
            />,
        );

        expect(screen.getByRole("button", { name: "Reset status" })).toBeTruthy();
        expect(screen.queryByTestId("hvsc-summary")).toBeNull();
        expect(screen.getByText("Temporary HVSC bridge error")).toBeTruthy();
    });

    it("omits failed-song details when a failure summary has no import failures", () => {
        render(
            <HvscControls
                {...buildProps({
                    hvscSummaryState: "failure",
                    hvscSummaryFailureLabel: "Archive checksum mismatch",
                    hvscIngestionFailedSongs: 0,
                })}
            />,
        );

        expect(screen.getByText("HVSC update failed")).toBeTruthy();
        expect(screen.getByText("Archive checksum mismatch")).toBeTruthy();
        expect(screen.queryByText(/songs could not be imported/i)).toBeNull();
    });

    it("renders the web-specific unavailable guidance", () => {
        vi.spyOn(Capacitor, "getPlatform").mockReturnValue("web");

        render(<HvscControls {...buildProps({ hvscAvailable: false, hvscPhase: "failed" })} />);

        expect(screen.getByText("Status: Failed")).toBeTruthy();
        expect(
            screen.getByText("HVSC is not available in web browsers. Install the Android or iOS app to use HVSC."),
        ).toBeTruthy();
    });

    it("renders the native unavailable guidance", () => {
        vi.spyOn(Capacitor, "getPlatform").mockReturnValue("android");

        render(<HvscControls {...buildProps({ hvscAvailable: false, hvscPhase: "download" })} />);

        expect(screen.getByText("Status: Downloading")).toBeTruthy();
        expect(
            screen.getByText("HVSC controls are available on native builds or when a mock bridge is enabled."),
        ).toBeTruthy();
    });
});
