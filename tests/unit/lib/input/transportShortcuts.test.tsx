/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { transportCommandBus } from "@/lib/input/latchedCommandBus";
import { createTransportShortcut } from "@/lib/input/transportShortcuts";

/*
 * The whole F1/F3 chain, end to end: the key press, the keypad profile's binding, the shortcut
 * dispatch inside FocusNavigationProvider, and the production factory App builds the two handlers
 * with. The binding test next door asserts the profile alone, which stayed green while nothing
 * downstream of it was wired.
 */
describe("the transport shortcuts", () => {
  let path = "/";
  const navigate = vi.fn((next: string) => {
    path = next;
  });

  const renderApp = () =>
    render(
      <FocusNavigationProvider
        profileId="keypad"
        shortcuts={{
          mediaPlayPause: createTransportShortcut("playPause", { navigate, currentPath: () => path }),
          mediaNext: createTransportShortcut("next", { navigate, currentPath: () => path }),
        }}
      >
        <button type="button">anything focusable</button>
      </FocusNavigationProvider>,
    );

  beforeEach(() => {
    path = "/";
    navigate.mockClear();
    transportCommandBus.reset();
  });
  afterEach(() => transportCommandBus.reset());

  it("carries F1 from the key press to the transport bus", () => {
    const heard: string[] = [];
    const stop = transportCommandBus.subscribe((command) => heard.push(command));
    renderApp();

    fireEvent.keyDown(document.body, { code: "F1", key: "F1" });

    expect(heard).toEqual(["playPause"]);
    stop();
  });

  it("carries F3 as next", () => {
    const heard: string[] = [];
    const stop = transportCommandBus.subscribe((command) => heard.push(command));
    renderApp();

    fireEvent.keyDown(document.body, { code: "F3", key: "F3" });

    expect(heard).toEqual(["next"]);
    stop();
  });

  it("goes to Play from a page that has no transport, and latches the command for it", () => {
    renderApp();

    fireEvent.keyDown(document.body, { code: "F1", key: "F1" });

    expect(navigate).toHaveBeenCalledWith("/play");
    // Play mounts after the navigation, so the press has to survive it (spec.md section 9.5).
    expect(transportCommandBus.takePending()).toBe("playPause");
  });

  it("stays where it is when the transport is already on screen", () => {
    path = "/play";
    renderApp();

    fireEvent.keyDown(document.body, { code: "F1", key: "F1" });

    expect(navigate).not.toHaveBeenCalled();
  });
});
