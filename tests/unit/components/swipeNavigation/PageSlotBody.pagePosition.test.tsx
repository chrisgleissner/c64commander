/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const positions = vi.hoisted(() => ({
  rememberPagePosition: vi.fn(),
  restorePagePosition: vi.fn(),
}));

vi.mock("@/lib/navigation/pagePositions", () => positions);
vi.mock("@/pages/HomePage", () => ({ default: () => <div data-testid="home-page" /> }));

import { PageSlotBody } from "@/components/swipeNavigation/PageSlotBody";

describe("PageSlotBody scroll position of a kept page", () => {
  beforeEach(() => {
    positions.rememberPagePosition.mockClear();
    positions.restorePagePosition.mockClear();
  });

  it("does not measure the page when it stops being shown, only when it is torn down", async () => {
    const { rerender, unmount } = render(<PageSlotBody pageIndex={0} isActive cached />);
    await screen.findByTestId("home-page");

    rerender(<PageSlotBody pageIndex={0} isActive={false} cached />);
    rerender(<PageSlotBody pageIndex={0} isActive cached />);
    rerender(<PageSlotBody pageIndex={0} isActive={false} cached />);

    expect(positions.rememberPagePosition).not.toHaveBeenCalled();

    unmount();

    expect(positions.rememberPagePosition).toHaveBeenCalledTimes(1);
    expect(positions.rememberPagePosition).toHaveBeenCalledWith(0, null);
  });
});
