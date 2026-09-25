/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";

describe("DropdownMenuContent", () => {
  const originalResizeObserver = window.ResizeObserver;

  afterEach(() => {
    window.ResizeObserver = originalResizeObserver;
  });

  it("scrolls the focused item back into view when the menu is resized", () => {
    const callbacks: ResizeObserverCallback[] = [];
    window.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        callbacks.push(callback);
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    render(
      <DropdownMenu open modal={false}>
        <DropdownMenuContent>
          <DropdownMenuItem disabled>Type: CRT cartridge</DropdownMenuItem>
          <DropdownMenuItem>Review playback config</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>,
    );
    const item = screen.getByRole("menuitem", { name: "Review playback config" });
    const scrollIntoView = vi.fn();
    item.scrollIntoView = scrollIntoView;
    item.focus();

    act(() => {
      callbacks.forEach((callback) => callback([], {} as ResizeObserver));
    });

    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("hands its element to a callback ref and to an object ref", () => {
    const callbackRef = vi.fn();
    const objectRef = { current: null as HTMLDivElement | null };
    render(
      <>
        <DropdownMenu open modal={false}>
          <DropdownMenuContent ref={callbackRef} data-testid="with-callback">
            <DropdownMenuItem>One</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <DropdownMenu open modal={false}>
          <DropdownMenuContent ref={objectRef} data-testid="with-object">
            <DropdownMenuItem>Two</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </>,
    );

    expect(callbackRef).toHaveBeenCalledWith(screen.getByTestId("with-callback"));
    expect(objectRef.current).toBe(screen.getByTestId("with-object"));
  });
});
