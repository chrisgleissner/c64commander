import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppChromeModeProvider, usePrimaryPageShellClassName } from "@/components/layout/AppChromeContext";

function TestPageShell() {
  const className = usePrimaryPageShellClassName("pb-24");
  return <div data-testid="page-shell" className={className} />;
}

describe("AppChromeContext", () => {
  it("adds the app bar offset when fixed chrome is active", () => {
    render(<TestPageShell />);

    expect(screen.getByTestId("page-shell").className).toContain("pt-[var(--app-bar-height)]");
  });

  it("omits the app bar offset when sticky chrome is active", () => {
    render(
      <AppChromeModeProvider mode="sticky">
        <TestPageShell />
      </AppChromeModeProvider>,
    );

    expect(screen.getByTestId("page-shell").className).not.toContain("pt-[var(--app-bar-height)]");
    expect(screen.getByTestId("page-shell").className).toContain("pb-24");
  });
});
