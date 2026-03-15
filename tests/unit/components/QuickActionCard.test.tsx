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
});
