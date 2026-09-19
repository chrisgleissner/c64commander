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

  /*
   * The three Android-Back cases that stood here moved to
   * tests/unit/lib/input/deviceBackButton.test.ts. This provider no longer registers a listener of
   * its own: Back is turned into an Escape keydown once, for the whole app, because on an ordinary
   * page there was no listener at all and the key did nothing.
   */
  it("registers no Android Back listener of its own", async () => {
    render(
      <InterstitialStateProvider>
        <OverlayProbe active kind="modal" label="dialog" />
      </InterstitialStateProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId("dialog")).toHaveAttribute("data-depth", "1");
    });
    expect(appListenerState.addListener).not.toHaveBeenCalled();
  });
});
