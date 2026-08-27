import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  /*
   * Six labels do not fit 320 CSS px at the larger Text sizes, so the bar scrolls and "Docs", the
   * last tab, is the one drawn past the edge. Scrolling alone left the tab for the page you are on
   * off screen whenever the page was reached any other way — the Quick menu, a deep link, or the
   * keypad — so the selected tab is scrolled into view. jsdom reports no layout, so the overflow is
   * simulated: the guard is that a bar which does NOT overflow is left alone.
   */
  const stubBarGeometry = ({ overflows, tabRight }: { overflows: boolean; tabRight: number }) => {
    Object.defineProperty(HTMLElement.prototype, "scrollWidth", {
      configurable: true,
      get: () => (overflows ? 600 : 300),
    });
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 320 });
    HTMLElement.prototype.getBoundingClientRect = function stub(this: HTMLElement) {
      const isNav = this.tagName === "NAV";
      const right = isNav ? 320 : tabRight;
      return { left: 0, right, top: 0, bottom: 0, width: right, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
    };
  };

  it("scrolls a selected tab that sits past the right edge back into view", async () => {
    stubBarGeometry({ overflows: true, tabRight: 371 });

    render(
      <MemoryRouter initialEntries={["/docs"]}>
        <TabBar />
      </MemoryRouter>,
    );
    const nav = document.querySelector("nav.tab-bar") as HTMLElement;
    await waitFor(() => expect(nav.scrollLeft).toBeGreaterThan(0));
    // 371 - 320 past the edge, plus the 12px sliver that shows the row keeps going.
    expect(nav.scrollLeft).toBe(63);
  });

  it("leaves the bar alone when every tab already fits", async () => {
    stubBarGeometry({ overflows: false, tabRight: 300 });

    render(
      <MemoryRouter initialEntries={["/docs"]}>
        <TabBar />
      </MemoryRouter>,
    );
    const nav = document.querySelector("nav.tab-bar") as HTMLElement;
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    expect(nav.scrollLeft).toBe(0);
  });

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
