import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppBar } from "@/components/AppBar";
import { AppChromeModeProvider } from "@/components/layout/AppChromeContext";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";

vi.mock("@/components/UnifiedHealthBadge", () => ({
  UnifiedHealthBadge: () => <div data-testid="unified-health-badge" />,
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  isDiagnosticsOverlayActive: () => false,
  subscribeDiagnosticsOverlay: () => () => undefined,
  subscribeDiagnosticsSuppression: () => () => {},
  isDiagnosticsOverlaySuppressionArmed: () => false,
}));

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

describe("AppBar", () => {
  it("caps compact top padding to the horizontal shell inset", () => {
    localStorage.clear();
    setViewportWidth(360);

    const { container } = render(
      <DisplayProfileProvider>
        <AppBar title="Home" subtitle="Compact" />
      </DisplayProfileProvider>,
    );

    const header = container.querySelector("header");
    const shell = container.querySelector(".app-shell-container");

    expect(header?.style.paddingTop).toBe("0px");
    expect(shell).toHaveStyle({ paddingTop: "calc(0.5rem * 0.8)", paddingBottom: "calc(0.5rem * 0.8)" });
    expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
    expect(screen.queryByText("Compact")).not.toBeInTheDocument();
  });

  it("preserves the safe-area top padding outside compact mode", () => {
    localStorage.clear();
    setViewportWidth(800);

    const { container } = render(
      <DisplayProfileProvider>
        <AppBar title="Settings" subtitle="Expanded" />
      </DisplayProfileProvider>,
    );

    const header = container.querySelector("header");
    const shell = container.querySelector(".app-shell-container");

    expect(header?.style.paddingTop).toBe("var(--app-header-top-inset, env(safe-area-inset-top))");
    expect(shell).toHaveStyle({ paddingTop: "calc(1.5rem * 0.8)", paddingBottom: "calc(1.5rem * 0.8)" });
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
    expect(screen.queryByText("Expanded")).not.toBeInTheDocument();
  });

  it("renders the unified health badge as the sole diagnostic/connectivity element", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <AppBar title="Play" />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("unified-health-badge")).toBeVisible();
  });

  it("uses sticky chrome inside the swipe runway", () => {
    localStorage.clear();
    setViewportWidth(390);

    const { container } = render(
      <DisplayProfileProvider>
        <ScreenActivityProvider active>
          <AppChromeModeProvider mode="sticky">
            <AppBar title="Docs" subtitle="How to use this app" />
          </AppChromeModeProvider>
        </ScreenActivityProvider>
      </DisplayProfileProvider>,
    );

    const header = container.querySelector("header");
    expect(header?.getAttribute("data-app-chrome-mode")).toBe("sticky");
    expect(header?.className).toContain("sticky");
    expect(header?.className).not.toContain("fixed");
    expect(screen.getByRole("heading", { name: "Docs" })).toBeVisible();
  });

  it("uses a shared header row with balanced height", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <AppBar title="Config" />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("app-bar-row").className).toContain("min-h-[52px]");
    expect(screen.getByTestId("app-bar-title-zone")).toBeVisible();
  });
});
