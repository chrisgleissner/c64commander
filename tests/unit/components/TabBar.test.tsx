import { describe, expect, it } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";

import { TabBar } from "@/components/TabBar";
import { InterstitialStateProvider, useRegisterInterstitial } from "@/components/ui/interstitial-state";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";

const InterstitialRegistrar = ({ active }: { active: boolean }) => {
  useRegisterInterstitial("modal", active);
  return null;
};

const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
};

describe("TabBar", () => {
  it("exposes tab labels as accessibility labels", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <TabBar />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Home")).toHaveAttribute("data-testid", "tab-home");
    expect(screen.getByLabelText("Play")).toHaveAttribute("data-testid", "tab-play");
    expect(screen.getByLabelText("Settings")).toHaveAttribute("data-testid", "tab-settings");
  });

  it("marks the active tab with aria-current", () => {
    render(
      <MemoryRouter initialEntries={["/play"]}>
        <TabBar />
      </MemoryRouter>,
    );

    expect(screen.getByLabelText("Play")).toHaveAttribute("aria-current", "page");
    expect(screen.getByLabelText("Home")).not.toHaveAttribute("aria-current");
  });

  it("slides out of view when an interstitial is active", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <InterstitialStateProvider>
          <InterstitialRegistrar active />
          <TabBar />
        </InterstitialStateProvider>
      </MemoryRouter>,
    );

    expect(container.firstElementChild).toHaveAttribute("data-interstitial-active", "true");
    expect(container.firstElementChild?.className).toContain("translate-y-full");
  });

  it("registers the primary tabs into the keypad focus ring (d-pad traversal + center-activate)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <FocusNavigationProvider profileId="keypad">
          <LocationProbe />
          <TabBar />
        </FocusNavigationProvider>
      </MemoryRouter>,
    );

    // Selection starts on the first tab (Home); a d-pad step lands on Play, the next on Disks.
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("tab-play"));
    fireEvent.keyDown(document.body, { code: "DpadDown" });
    expect(document.activeElement).toBe(screen.getByTestId("tab-disks"));

    // Center activates the focused tab → router navigates to its route.
    fireEvent.keyDown(document.body, { code: "DpadCenter" });
    expect(screen.getByTestId("location")).toHaveTextContent("/disks");
  });

  it("leaves the tabs inert with no focus provider (default variant unchanged)", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <LocationProbe />
        <TabBar />
      </MemoryRouter>,
    );

    // No provider → no global key listener → keypad codes do nothing and never throw.
    expect(fireEvent.keyDown(document.body, { code: "DpadCenter" })).toBe(true);
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });
});
