import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppBar } from "@/components/AppBar";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";

vi.mock("@/components/ConnectivityIndicator", () => ({
  ConnectivityIndicator: () => <div data-testid="connectivity-indicator" />,
}));

vi.mock("@/components/DiagnosticsActivityIndicator", () => ({
  DiagnosticsActivityIndicator: ({ onClick }: { onClick: () => void }) => (
    <button type="button" onClick={onClick} data-testid="diagnostics-activity-indicator" />
  ),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlay", () => ({
  requestDiagnosticsOpen: vi.fn(),
}));

vi.mock("@/lib/diagnostics/diagnosticsOverlayState", () => ({
  isDiagnosticsOverlayActive: () => false,
  subscribeDiagnosticsOverlay: () => () => undefined,
}));

vi.mock("@/hooks/useDiagnosticsActivity", () => ({
  useDiagnosticsActivity: () => ({ restInFlight: 0 }),
}));

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(() => ({
    id: "rest-toast",
    dismiss: vi.fn(),
    update: vi.fn(),
  })),
  useToast: () => ({ toasts: [] }),
}));

const setViewportWidth = (width: number) => {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
};

describe("AppBar", () => {
  it("keeps safe-area top padding while preserving compact shell insets", () => {
    localStorage.clear();
    setViewportWidth(360);

    const { container } = render(
      <DisplayProfileProvider>
        <AppBar title="Home" subtitle="Compact" />
      </DisplayProfileProvider>,
    );

    const header = container.querySelector("header");
    const shell = container.querySelector(".app-shell-container");

    expect(header?.className).toContain("pt-safe");
    expect(shell).toHaveStyle({ paddingTop: "0.5rem", paddingBottom: "0.5rem" });
    expect(screen.getByRole("heading", { name: "Home" })).toBeVisible();
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

    expect(header?.className).toContain("pt-safe");
    expect(shell?.className).toContain("py-4");
    expect(screen.getByRole("heading", { name: "Settings" })).toBeVisible();
  });
});
