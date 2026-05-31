import { act, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppDialog,
  AppDialogBody,
  AppDialogContent,
  AppDialogHeader,
  AppDialogTitle,
} from "@/components/ui/app-surface";
import {
  InterstitialStateProvider,
  useInterstitialDepth,
  useRegisterInterstitial,
} from "@/components/ui/interstitial-state";
import { addLog } from "@/lib/logging";

const appListenerState = vi.hoisted(() => ({
  backButtonListener: null as null | (() => void),
  addListener: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: {
    addListener: appListenerState.addListener,
  },
}));

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

const addLogMock = vi.mocked(addLog);

function OverlayProbe({
  active,
  kind,
  label,
}: {
  active: boolean;
  kind: "modal" | "sheet" | "progress";
  label: string;
}) {
  const layer = useRegisterInterstitial(kind, active);
  return (
    <div
      data-testid={label}
      data-depth={layer?.depth ?? 0}
      data-surface-z={layer?.surfaceZIndex ?? 0}
      data-backdrop-z={layer?.backdropZIndex ?? 0}
      data-backdrop-opacity={layer?.backdropOpacity ?? 0}
    />
  );
}

function DepthProbe() {
  const depth = useInterstitialDepth();
  return <div data-testid="stack-depth">{depth}</div>;
}

describe("interstitial-state", () => {
  beforeEach(() => {
    appListenerState.backButtonListener = null;
    appListenerState.addListener.mockReset();
    appListenerState.remove.mockReset();
    appListenerState.addListener.mockImplementation(async (eventName: string, listener: () => void) => {
      if (eventName === "backButton") {
        appListenerState.backButtonListener = listener;
      }
      return { remove: appListenerState.remove };
    });
    addLogMock.mockReset();
  });

  it("assigns deterministic layered depths for three simultaneous overlays", () => {
    render(
      <InterstitialStateProvider>
        <DepthProbe />
        <OverlayProbe active kind="sheet" label="sheet" />
        <OverlayProbe active kind="modal" label="dialog" />
        <OverlayProbe active kind="progress" label="progress" />
      </InterstitialStateProvider>,
    );

    expect(screen.getByTestId("stack-depth")).toHaveTextContent("3");
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-depth", "1");
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-backdrop-opacity", "0.4");
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-backdrop-z", "200");
    expect(screen.getByTestId("sheet")).toHaveAttribute("data-surface-z", "210");

    expect(screen.getByTestId("dialog")).toHaveAttribute("data-depth", "2");
    expect(screen.getByTestId("dialog")).toHaveAttribute("data-backdrop-opacity", "0.25");
    expect(screen.getByTestId("dialog")).toHaveAttribute("data-backdrop-z", "220");
    expect(screen.getByTestId("dialog")).toHaveAttribute("data-surface-z", "230");

    expect(screen.getByTestId("progress")).toHaveAttribute("data-depth", "3");
    expect(screen.getByTestId("progress")).toHaveAttribute("data-backdrop-opacity", "0.15");
    expect(screen.getByTestId("progress")).toHaveAttribute("data-backdrop-z", "240");
    expect(screen.getByTestId("progress")).toHaveAttribute("data-surface-z", "250");
  });

  it("does not register an Android Back interceptor when no interstitial is open", () => {
    render(
      <InterstitialStateProvider>
        <DepthProbe />
      </InterstitialStateProvider>,
    );

    expect(screen.getByTestId("stack-depth")).toHaveTextContent("0");
    expect(appListenerState.addListener).not.toHaveBeenCalled();
  });

  it("dismisses the topmost interstitial on Android Back", async () => {
    function DialogHarness() {
      const [open, setOpen] = React.useState(true);
      return (
        <InterstitialStateProvider>
          <DepthProbe />
          <AppDialog open={open} onOpenChange={setOpen}>
            <AppDialogContent>
              <AppDialogHeader>
                <AppDialogTitle>Confirm reset</AppDialogTitle>
              </AppDialogHeader>
              <AppDialogBody>Reset the machine?</AppDialogBody>
            </AppDialogContent>
          </AppDialog>
        </InterstitialStateProvider>
      );
    }

    render(<DialogHarness />);

    await waitFor(() => {
      expect(appListenerState.backButtonListener).not.toBeNull();
      expect(screen.getByTestId("stack-depth")).toHaveTextContent("1");
    });

    act(() => {
      appListenerState.backButtonListener?.();
    });

    await waitFor(() => {
      expect(screen.queryByText("Confirm reset")).not.toBeInTheDocument();
      expect(screen.getByTestId("stack-depth")).toHaveTextContent("0");
    });
  });

  it("keeps one Android Back interceptor while the active interstitial stack changes", async () => {
    function StackHarness() {
      const [showSheet, setShowSheet] = React.useState(false);
      return (
        <InterstitialStateProvider>
          <OverlayProbe active kind="modal" label="dialog" />
          <OverlayProbe active={showSheet} kind="sheet" label="sheet" />
          <button type="button" onClick={() => setShowSheet(true)}>
            Show sheet
          </button>
        </InterstitialStateProvider>
      );
    }

    render(<StackHarness />);

    await waitFor(() => {
      expect(appListenerState.addListener).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      screen.getByRole("button", { name: "Show sheet" }).click();
    });

    expect(screen.getByTestId("sheet")).toHaveAttribute("data-depth", "2");
    expect(appListenerState.addListener).toHaveBeenCalledTimes(1);

    act(() => {
      appListenerState.backButtonListener?.();
    });

    expect(addLogMock).toHaveBeenCalledWith("debug", "Android Back dismissed topmost interstitial", {
      depth: 2,
      topKind: "sheet",
    });
  });

  it("logs a warning when Android Back listener registration fails", async () => {
    appListenerState.addListener.mockRejectedValueOnce(new Error("listener unavailable"));

    render(
      <InterstitialStateProvider>
        <OverlayProbe active kind="modal" label="dialog" />
      </InterstitialStateProvider>,
    );

    await waitFor(() => {
      expect(addLogMock).toHaveBeenCalledWith("warn", "Failed to register Android Back interstitial handler", {
        error: "listener unavailable",
      });
    });
  });
});
