/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import React from "react";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { useOnPageLeft, useOnPageReturn } from "@/hooks/useOnPageLeft";

const renderInPage = (onLeft: () => void, initiallyOnScreen: boolean, onReturn: () => void = () => undefined) => {
  let pageOnScreen = initiallyOnScreen;
  const rendered = renderHook(
    () => {
      useOnPageLeft(onLeft);
      useOnPageReturn(onReturn);
    },
    {
      wrapper: ({ children }: { children: React.ReactNode }) => (
        <ScreenActivityProvider active={pageOnScreen}>{children}</ScreenActivityProvider>
      ),
    },
  );
  return (onScreen: boolean) => {
    pageOnScreen = onScreen;
    rendered.rerender();
  };
};

describe("useOnPageLeft", () => {
  it("runs each time another tab replaces the page, and not when the page is shown", () => {
    const onLeft = vi.fn();
    const show = renderInPage(onLeft, true);
    expect(onLeft).not.toHaveBeenCalled();
    show(false);
    expect(onLeft).toHaveBeenCalledTimes(1);
    show(true);
    show(true);
    expect(onLeft).toHaveBeenCalledTimes(1);
    show(false);
    expect(onLeft).toHaveBeenCalledTimes(2);
  });

  it("does not run for a page that was never on screen, such as a swipe preview", () => {
    const onLeft = vi.fn();
    const show = renderInPage(onLeft, false);
    show(false);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it("does not run when the app goes to the background, which never unmounted the page", () => {
    const onLeft = vi.fn();
    renderInPage(onLeft, true);
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    try {
      act(() => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
      expect(onLeft).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, "hidden");
    }
  });

  it("runs the return handler each time the page is shown again after another tab, never on first showing", () => {
    const onReturn = vi.fn();
    const show = renderInPage(() => undefined, true, onReturn);
    expect(onReturn).not.toHaveBeenCalled();
    show(false);
    expect(onReturn).not.toHaveBeenCalled();
    show(true);
    show(true);
    expect(onReturn).toHaveBeenCalledTimes(1);
    show(false);
    show(true);
    expect(onReturn).toHaveBeenCalledTimes(2);
  });
});
