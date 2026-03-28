import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  InterstitialStateProvider,
  useInterstitialDepth,
  useRegisterInterstitial,
} from "@/components/ui/interstitial-state";

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
});
