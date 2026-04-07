import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { HvscPreparationSheet } from "@/pages/playFiles/components/HvscPreparationSheet";

const buildProps = (overrides: Partial<ComponentProps<typeof HvscPreparationSheet>> = {}) => ({
  open: true,
  onOpenChange: vi.fn(),
  state: "DOWNLOADING" as const,
  statusLabel: "Downloading",
  failedPhase: null,
  progressPercent: 25,
  throughputLabel: "8.4 MB/s",
  readySongCount: 0,
  errorReason: null,
  onBrowse: vi.fn(),
  onCancel: vi.fn(),
  onRetry: vi.fn(),
  ...overrides,
});

describe("HvscPreparationSheet", () => {
  it("renders the automatic preparation progress state", () => {
    render(<HvscPreparationSheet {...buildProps()} />);

    expect(screen.getByTestId("hvsc-preparation-sheet")).toBeVisible();
    expect(screen.getByText("Preparing HVSC library")).toBeVisible();
    expect(screen.getByTestId("hvsc-preparation-progress-label")).toHaveTextContent("25%");
    expect(screen.getByTestId("hvsc-preparation-phase")).toHaveTextContent("Downloading");
    expect(screen.getByTestId("hvsc-preparation-throughput")).toHaveTextContent("8.4 MB/s");
    expect(screen.getByTestId("hvsc-preparation-cancel")).toBeVisible();
    expect(screen.queryByTestId("hvsc-preparation-browse")).toBeNull();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
  });

  it("renders success state and requires explicit browse confirmation", () => {
    const onBrowse = vi.fn();

    render(
      <HvscPreparationSheet
        {...buildProps({
          state: "READY",
          statusLabel: "Ready",
          progressPercent: null,
          throughputLabel: null,
          readySongCount: 65890,
          onBrowse,
        })}
      />,
    );

    expect(screen.getByTestId("hvsc-preparation-progress-label")).toHaveTextContent("100%");
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
});
