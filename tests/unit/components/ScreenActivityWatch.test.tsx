/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ScreenActivityWatch } from "@/components/ScreenActivityWatch";
import { ScreenActivityProvider } from "@/hooks/useScreenActivity";

const setDocumentHidden = (hidden: boolean) => {
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

const tab = (active: boolean, onChange: (onScreen: boolean) => void) => (
  <ScreenActivityProvider active={active}>
    <ScreenActivityWatch onChange={onChange} />
  </ScreenActivityProvider>
);

afterEach(() => {
  setDocumentHidden(false);
});

describe("ScreenActivityWatch", () => {
  it("reports the page on screen when it mounts, and off screen once another tab is shown", () => {
    const onChange = vi.fn();
    const view = render(tab(true, onChange));
    expect(onChange.mock.calls).toEqual([[true]]);

    view.rerender(tab(false, onChange));

    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });

  it("does not report the page as left when the app goes to the background and comes back", () => {
    const onChange = vi.fn();
    render(tab(true, onChange));

    setDocumentHidden(true);
    setDocumentHidden(false);

    expect(onChange.mock.calls).toEqual([[true]]);
  });

  it("calls the latest callback without re-reporting an unchanged answer", () => {
    const first = vi.fn();
    const second = vi.fn();
    const view = render(tab(true, first));
    view.rerender(tab(true, second));
    expect(second).not.toHaveBeenCalled();

    view.rerender(tab(false, second));

    expect(first.mock.calls).toEqual([[true]]);
    expect(second.mock.calls).toEqual([[false]]);
  });

  it("keeps a hidden page reported off screen while the app is in the background", () => {
    const onChange = vi.fn();
    const view = render(tab(true, onChange));
    view.rerender(tab(false, onChange));

    setDocumentHidden(true);
    setDocumentHidden(false);

    expect(onChange.mock.calls).toEqual([[true], [false]]);
  });
});
