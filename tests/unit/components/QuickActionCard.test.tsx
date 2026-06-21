/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Music } from "lucide-react";

import { ProfileActionGrid } from "@/components/layout/PageContainer";
import { QuickActionCard } from "@/components/QuickActionCard";
import { DisplayProfileProvider } from "@/hooks/useDisplayProfile";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";

vi.mock("@/lib/ui/buttonInteraction", () => ({
  handlePointerButtonClick: vi.fn(),
}));

describe("QuickActionCard", () => {
  const setViewportWidth = (width: number) => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: width,
    });
  };

  const baseProps = {
    icon: Music,
    label: "Play",
    onClick: vi.fn(),
  };

  it("renders label and calls onClick", () => {
    render(<QuickActionCard {...baseProps} />);
    expect(screen.getByText("Play")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button"));
    expect(baseProps.onClick).toHaveBeenCalledTimes(1);
  });

  it("uses compact density from the shared action-grid boundary on wide screens", () => {
    localStorage.clear();
    setViewportWidth(800);

    render(
      <DisplayProfileProvider>
        <ProfileActionGrid cardDensity="compact">
          <QuickActionCard {...baseProps} />
        </ProfileActionGrid>
      </DisplayProfileProvider>,
    );

    expect(screen.getByRole("button", { name: "Play" }).className).toContain("min-h-[86px]");
  });

  it("falls back to adaptive compact density on compact displays", () => {
    localStorage.clear();
    setViewportWidth(360);

    render(
      <DisplayProfileProvider>
        <QuickActionCard {...baseProps} />
      </DisplayProfileProvider>,
    );

    expect(screen.getByRole("button", { name: "Play" }).className).toContain("min-h-[86px]");
  });

  it("applies disabled styles when disabled", () => {
    render(<QuickActionCard {...baseProps} disabled />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    expect(btn.className).toContain("opacity-50");
  });

  it("renders danger variant styles", () => {
    render(<QuickActionCard {...baseProps} variant="danger" />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("hover:border-destructive");
  });

  it("renders success variant styles", () => {
    render(<QuickActionCard {...baseProps} variant="success" />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("hover:border-success");
  });

  it("shows animate-pulse on icon when loading", () => {
    render(<QuickActionCard {...baseProps} loading />);
    const btn = screen.getByRole("button");
    expect(btn).toBeDisabled();
    const svg = btn.querySelector("svg");
    expect(svg?.getAttribute("class")).toContain("animate-pulse");
  });

  it("renders description when provided", () => {
    render(<QuickActionCard {...baseProps} description="Play a file" />);
    expect(screen.getByText("Play a file")).toBeInTheDocument();
  });

  describe("keypad focus ring (C64U Remote)", () => {
    it("joins the d-pad ring in focusOrder when given a focusId and center-activates", () => {
      const onSave = vi.fn();
      const onLoad = vi.fn();
      const onReset = vi.fn();

      render(
        <FocusNavigationProvider profileId="keypad">
          <QuickActionCard icon={Music} label="Save" focusId="save" focusOrder={100} onClick={onSave} />
          <QuickActionCard icon={Music} label="Load" focusId="load" focusOrder={110} onClick={onLoad} />
          <QuickActionCard icon={Music} label="Reset" focusId="reset" focusOrder={120} onClick={onReset} />
        </FocusNavigationProvider>,
      );

      // Selection starts on the first registered card; d-pad steps land in focusOrder.
      fireEvent.keyDown(document.body, { code: "DpadDown" });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Load" }));
      fireEvent.keyDown(document.body, { code: "DpadDown" });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset" }));

      fireEvent.keyDown(document.body, { code: "DpadCenter" });
      expect(onReset).toHaveBeenCalledTimes(1);
      expect(onSave).not.toHaveBeenCalled();
      expect(onLoad).not.toHaveBeenCalled();
    });

    it("skips a disabled card during d-pad traversal so it cannot be activated", () => {
      const onReset = vi.fn();

      render(
        <FocusNavigationProvider profileId="keypad">
          <QuickActionCard icon={Music} label="Save" focusId="save" focusOrder={100} onClick={vi.fn()} />
          <QuickActionCard icon={Music} label="Load" focusId="load" focusOrder={110} disabled onClick={vi.fn()} />
          <QuickActionCard icon={Music} label="Reset" focusId="reset" focusOrder={120} onClick={onReset} />
        </FocusNavigationProvider>,
      );

      // One step from Save jumps past the disabled Load straight to Reset.
      fireEvent.keyDown(document.body, { code: "DpadDown" });
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Reset" }));
      fireEvent.keyDown(document.body, { code: "DpadCenter" });
      expect(onReset).toHaveBeenCalledTimes(1);
    });

    it("auto-discovers a card even without an explicit focusId (reachable by construction)", () => {
      const onRegistered = vi.fn();
      const onUnregistered = vi.fn();

      render(
        <FocusNavigationProvider profileId="keypad">
          <QuickActionCard
            icon={Music}
            label="Registered"
            focusId="registered"
            focusOrder={100}
            onClick={onRegistered}
          />
          <QuickActionCard icon={Music} label="Unregistered" onClick={onUnregistered} />
        </FocusNavigationProvider>,
      );

      // Scope-based auto-discovery puts EVERY interactive element in the ring
      // (CONFIRMED DECISION 1) — a focusId is now only an optional refinement, not
      // the gate for reachability. The first card is the initial selection; OK
      // activates it, and the card without a focusId is still reachable by a step.
      fireEvent.keyDown(document.body, { code: "DpadCenter" });
      expect(onRegistered).toHaveBeenCalledTimes(1);

      fireEvent.keyDown(document.body, { code: "DpadDown" });
      fireEvent.keyDown(document.body, { code: "DpadCenter" });
      expect(onUnregistered).toHaveBeenCalledTimes(1);
    });
  });
});
