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
  it.each([
    { profile: "compact", width: 360, title: "Home" },
    { profile: "medium", width: 393, title: "Settings" },
    { profile: "expanded", width: 800, title: "Docs" },
  ])("uses the same dense header rail for $profile", ({ profile, width, title }) => {
    localStorage.clear();
    setViewportWidth(width);

    const { container, unmount } = render(
      <DisplayProfileProvider>
        <AppBar title={title} subtitle={profile} />
      </DisplayProfileProvider>,
    );

    const header = container.querySelector("header");
    const shell = container.querySelector(".app-shell-container");

    expect(header?.style.paddingTop).toBe("var(--safe-area-inset-top)");
    expect(shell).toHaveStyle({
      paddingTop: "var(--app-chrome-rail-padding-y)",
      paddingBottom: "var(--app-chrome-rail-padding-y)",
    });
    expect(header).toHaveAttribute("data-display-profile", profile);
    expect(header?.className).toContain("app-chrome-rail");
    expect(screen.getByRole("heading", { name: title })).toBeVisible();
    expect(screen.queryByText(profile)).not.toBeInTheDocument();

    unmount();
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

  it("uses shell-owned relative chrome inside the swipe runway", () => {
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
    expect(header?.className).toContain("relative");
    expect(header?.className).not.toContain("fixed");
    expect(screen.getByRole("heading", { name: "Docs" })).toBeVisible();
  });

  it("uses a shared single header row with dense balanced height", () => {
    localStorage.clear();
    setViewportWidth(600);

    render(
      <DisplayProfileProvider>
        <AppBar title="Config" />
      </DisplayProfileProvider>,
    );

    expect(screen.getByTestId("app-bar-row").className).toContain("min-h-11");
    expect(screen.getByTestId("app-bar-title-zone")).toBeVisible();
    expect(screen.getByTestId("app-bar-title-zone").className).toContain("min-h-11");
  });
});
