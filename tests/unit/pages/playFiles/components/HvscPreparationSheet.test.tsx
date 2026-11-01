import { act, fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { useHvscArchiveSize } from "@/lib/hvsc/hvscArchiveSize";
import { HvscPreparationSheet, READY_CLOSE_DELAY_MS } from "@/pages/playFiles/components/HvscPreparationSheet";

const buildProps = (overrides: Partial<ComponentProps<typeof HvscPreparationSheet>> = {}) => ({
  open: true,
  onOpenChange: vi.fn(),
  state: "DOWNLOADING" as const,
  statusLabel: "Downloading",
  failedPhase: null,
  stage: "download" as string | null,
  stagePercent: 25 as number | null,
  throughputLabel: "8.4 MB/s",
  readySongCount: 0,
  errorReason: null,
  onBrowse: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
  ...overrides,
});

vi.mock("@/lib/hvsc/hvscArchiveSize", () => ({ useHvscArchiveSize: vi.fn(() => null) }));

describe("HvscPreparationSheet", () => {
  it("renders the automatic preparation progress state", () => {
    render(<HvscPreparationSheet {...buildProps()} />);

    expect(screen.getByTestId("hvsc-preparation-sheet")).toBeVisible();
    expect(screen.getByText("Preparing HVSC library")).toBeVisible();
    expect(screen.getByTestId("hvsc-preparation-progress-download")).toHaveAttribute("data-status", "active");
    expect(screen.getByTestId("hvsc-preparation-progress-detail")).toHaveTextContent("25%");
    expect(screen.getByTestId("hvsc-preparation-phase")).toHaveTextContent("Downloading");
    expect(screen.getByTestId("hvsc-preparation-throughput")).toHaveTextContent("8.4 MB/s");
    expect(screen.getByTestId("hvsc-preparation-cancel")).toBeVisible();
    expect(screen.queryByTestId("hvsc-preparation-browse")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("shows the analysis step while a ready library is still being analyzed, and still offers to browse", () => {
    render(
      <HvscPreparationSheet
        {...buildProps({
          state: "READY",
          statusLabel: "Ready",
          stage: "sid_metadata_hydration",
          step: "analyze",
          analyzing: true,
          stagePercent: null,
          stageDone: 6_000,
          stageTotal: 60_000,
          throughputLabel: "600 songs/s · about 2 min left",
          readySongCount: 60_000,
        })}
      />,
    );

    expect(screen.getByTestId("hvsc-preparation-progress-analyze")).toHaveAttribute("data-status", "active");
    expect(screen.getByTestId("hvsc-preparation-progress-details")).toHaveAttribute("data-status", "done");
    expect(screen.getByText("Analyzing songs")).toBeVisible();
    expect(screen.getByTestId("hvsc-preparation-progress-detail")).toHaveTextContent("6,000 / 60,000");
    expect(screen.getByTestId("hvsc-preparation-browse")).toBeVisible();
  });

  it("renders success state and requires explicit browse confirmation", () => {
    const onBrowse = vi.fn();

    render(
      <HvscPreparationSheet
        {...buildProps({
          state: "READY",
          statusLabel: "Ready",
          stage: null,
          stagePercent: null,
          throughputLabel: null,
          readySongCount: 65890,
          onBrowse,
        })}
      />,
    );

    // Every step finished, which is the resting state — the old bar hid itself on completion, so the
    // one thing the user was waiting for was never rendered.
    for (const step of ["download", "unpack", "scan", "details", "analyze"]) {
      expect(screen.getByTestId(`hvsc-preparation-progress-${step}`)).toHaveAttribute("data-status", "done");
    }
    expect(screen.getByTestId("hvsc-preparation-success-count")).toHaveTextContent("65,890 songs ready");

    fireEvent.click(screen.getByTestId("hvsc-preparation-browse"));

    expect(onBrowse).toHaveBeenCalledTimes(1);
  });

  it("renders failure details and exposes retry and cancel actions", () => {
    const onRetry = vi.fn();
    const onCancel = vi.fn();

    render(
      <HvscPreparationSheet
        {...buildProps({
          state: "ERROR",
          statusLabel: "Indexing failed",
          failedPhase: "ingest",
          progressPercent: 73,
          throughputLabel: null,
          errorReason: "metadata parse failed",
          onRetry,
          onCancel,
        })}
      />,
    );

    expect(screen.getByText("Failure phase: Indexing")).toBeVisible();
    expect(screen.getByTestId("hvsc-preparation-error")).toHaveTextContent("metadata parse failed");

    fireEvent.click(screen.getByTestId("hvsc-preparation-retry"));
    fireEvent.click(screen.getByTestId("hvsc-preparation-cancel"));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  describe("asking before the download", () => {
    const consentProps = (overrides: Partial<ComponentProps<typeof HvscPreparationSheet>> = {}) =>
      buildProps({
        state: "NOT_PRESENT",
        statusLabel: "Not downloaded",
        stage: null,
        stagePercent: null,
        awaitingConsent: true,
        onConsent: vi.fn(),
        ...overrides,
      });

    it("SPM-START-02 the consent states the size the HVSC host reports", () => {
      vi.mocked(useHvscArchiveSize).mockReturnValue(84_827_547);
      render(<HvscPreparationSheet {...consentProps()} />);

      expect(screen.getByTestId("hvsc-consent").textContent).toMatch(/It is 81 MB and needs/);
      vi.mocked(useHvscArchiveSize).mockReturnValue(null);
    });

    it("SPM-START-02 the download waits for consent and shows its size", () => {
      const props = consentProps();
      render(<HvscPreparationSheet {...props} />);

      const text = screen.getByTestId("hvsc-consent").textContent ?? "";
      expect(text).toMatch(/It is about 81 MB and needs/);
      expect(text).toMatch(/about [\d.]+ GB of free space/);
      expect(text).toMatch(/Wi-Fi recommended/);
      expect(text).not.toMatch(/\b(REST|FTP|Telnet|host|IP|PAL|NTSC|dB|KERNAL|BASIC|HVSC)\b/);
      expect(screen.getByTestId("hvsc-consent-download")).toHaveTextContent("Download");
      expect(screen.getByTestId("hvsc-consent-not-now")).toHaveTextContent("Not now");
      expect(props.onConsent).not.toHaveBeenCalled();
    });

    it("SPM-START-02 the consent says what the person gets and that it can be removed, in plain words", () => {
      render(<HvscPreparationSheet {...consentProps()} />);

      const benefits = screen.getByTestId("hvsc-consent-benefits");
      expect(benefits.querySelectorAll("li")).toHaveLength(3);
      expect(screen.getByTestId("hvsc-consent").textContent).toMatch(/remove it again in Settings/);
    });

    it("SPM-START-02 after a download the person asked for, the ready sheet closes itself, and one nobody asked for stays", () => {
      vi.useFakeTimers();
      try {
        const asked = consentProps();
        const view = render(<HvscPreparationSheet {...asked} />);
        view.rerender(
          <HvscPreparationSheet
            {...asked}
            awaitingConsent={false}
            state="READY"
            statusLabel="Ready"
            readySongCount={10}
          />,
        );
        expect(asked.onOpenChange).not.toHaveBeenCalled();
        act(() => void vi.advanceTimersByTime(READY_CLOSE_DELAY_MS + 1));
        expect(asked.onOpenChange).toHaveBeenCalledWith(false);

        const unasked = buildProps({ state: "READY", statusLabel: "Ready", readySongCount: 10 });
        render(<HvscPreparationSheet {...unasked} />);
        act(() => void vi.advanceTimersByTime(READY_CLOSE_DELAY_MS + 1));
        expect(unasked.onOpenChange).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("SPM-START-02 Download grants consent and Not now closes the sheet without it", () => {
      const props = consentProps();
      render(<HvscPreparationSheet {...props} />);

      fireEvent.click(screen.getByTestId("hvsc-consent-not-now"));
      expect(props.onOpenChange).toHaveBeenCalledWith(false);
      expect(props.onConsent).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("hvsc-consent-download"));
      expect(props.onConsent).toHaveBeenCalledTimes(1);
    });

    it("SPM-START-02 without a consent request the sheet is the progress sheet it always was", () => {
      render(<HvscPreparationSheet {...buildProps()} />);
      expect(screen.queryByTestId("hvsc-consent")).toBeNull();
      expect(screen.queryByTestId("hvsc-consent-download")).toBeNull();
    });
  });
});
