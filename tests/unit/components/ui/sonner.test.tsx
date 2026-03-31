/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-themes", () => ({
  useTheme: vi.fn(() => ({ theme: "dark" })),
}));

vi.mock("sonner", () => ({
  Toaster: vi.fn(({ theme, className }: { theme?: string; className?: string }) => (
    <div data-testid="sonner-toaster" data-theme={theme} className={className} />
  )),
  toast: vi.fn(),
}));

import { Toaster, toast } from "@/components/ui/sonner";

describe("sonner", () => {
  it("renders the Toaster with the current theme", () => {
    const { getByTestId } = render(<Toaster />);
    expect(getByTestId("sonner-toaster")).toBeInTheDocument();
    expect(getByTestId("sonner-toaster")).toHaveAttribute("data-theme", "dark");
  });

  it("passes className to the underlying Toaster", () => {
    const { getByTestId } = render(<Toaster />);
    expect(getByTestId("sonner-toaster")).toHaveAttribute("class", "toaster group");
  });

  it("exports toast function", () => {
    expect(toast).toBeDefined();
  });
});
