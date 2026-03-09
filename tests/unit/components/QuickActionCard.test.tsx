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
import { QuickActionCard } from "@/components/QuickActionCard";

vi.mock("@/lib/ui/buttonInteraction", () => ({
  handlePointerButtonClick: vi.fn(),
}));

describe("QuickActionCard", () => {
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

  it("applies compact class when compact prop is true", () => {
    render(<QuickActionCard {...baseProps} compact />);
    const btn = screen.getByRole("button");
    expect(btn.className).toContain("gap-1.5");
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
