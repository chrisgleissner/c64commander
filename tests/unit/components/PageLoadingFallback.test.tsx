/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PageLoadingFallback } from "@/components/PageLoadingFallback";
import { FocusNavigationProvider, useFocusItem } from "@/hooks/useFocusNavigation";
import { resetInputModality } from "@/lib/input";

const HomeTab = ({ onClick }: { onClick: () => void }) => {
  const ref = useFocusItem<HTMLButtonElement>({ id: "tab-home", order: 1000, group: "primary-tabs" });
  return (
    <button ref={ref} onClick={onClick}>
      Home
    </button>
  );
};

describe("PageLoadingFallback", () => {
  afterEach(() => resetInputModality());

  it("holds the keypad ring while a page loads, so OK does not open the Home tab", () => {
    const openHome = vi.fn();
    render(
      <FocusNavigationProvider>
        <PageLoadingFallback />
        <HomeTab onClick={openHome} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "Enter" });

    expect(screen.getByTestId("page-loading")).toHaveAttribute("data-key-selected", "true");
    expect(openHome).not.toHaveBeenCalled();
  });

  it("offers no OK action in the guidance bar while the page loads", () => {
    render(
      <FocusNavigationProvider>
        <PageLoadingFallback />
        <HomeTab onClick={vi.fn()} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    fireEvent.keyDown(document.body, { code: "ArrowUp" });

    expect(screen.getByTestId("keypad-guidance-breadcrumb")).toHaveTextContent("Loading screen...");
    expect(screen.getByTestId("keypad-guidance-center")).toHaveAttribute("hidden");
  });
});
