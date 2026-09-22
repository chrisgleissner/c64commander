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
import { createNormalNavigationFunctionShortcut, runFunctionShortcut } from "@/lib/input/functionKeyShortcuts";

/*
 * The normal-navigation function-key chain: neutral normalization, a single
 * owner in FocusNavigationProvider, and no route-changing transport fallback.
 */
describe("configured function shortcuts", () => {
  const calls = { playPause: vi.fn(), nextTune: vi.fn(), search: vi.fn(), quickMenu: vi.fn(), gameMode: vi.fn() };

  const renderApp = () =>
    render(
      <FocusNavigationProvider
        profileId="keypad"
        shortcuts={{
          runFunctionShortcut: (key) => runFunctionShortcut(key === 1 ? "playPause" : "nextTune", calls),
        }}
      >
        <button type="button">anything focusable</button>
      </FocusNavigationProvider>,
    );

  beforeEach(() => {
    Object.values(calls).forEach((call) => call.mockClear());
    transportCommandBus.reset();
  });
  afterEach(() => transportCommandBus.reset());

  it("runs the F1 assignment once without navigating", () => {
    renderApp();

    fireEvent.keyDown(document.body, { code: "F1", key: "F1" });

    expect(calls.playPause).toHaveBeenCalledOnce();
  });

  it("runs the F3 assignment once", () => {
    renderApp();

    fireEvent.keyDown(document.body, { code: "F3", key: "F3" });

    expect(calls.nextTune).toHaveBeenCalledOnce();
  });

  it("suppresses OS repeat for one-shot function assignments", () => {
    renderApp();

    fireEvent.keyDown(document.body, { code: "F1", key: "F1", repeat: true });
    expect(calls.playPause).not.toHaveBeenCalled();
  });

  it("swallows an OS repeat of F3 too, so a held key cannot run a second one-shot command", () => {
    renderApp();

    const event = new KeyboardEvent("keydown", { code: "F3", key: "F3", repeat: true, cancelable: true });
    document.body.dispatchEvent(event);

    expect(calls.nextTune).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it("leaves F1 alone when no function shortcut handler is wired", () => {
    render(
      <FocusNavigationProvider profileId="keypad" shortcuts={{}}>
        <button type="button">anything focusable</button>
      </FocusNavigationProvider>,
    );

    const event = new KeyboardEvent("keydown", { code: "F1", key: "F1", bubbles: true, cancelable: true });
    document.body.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it("consumes an Unassigned assignment without calling another action", () => {
    expect(runFunctionShortcut("unassigned", calls)).toBe(true);
    expect(calls.playPause).not.toHaveBeenCalled();
  });

  it("keeps C64 Commander F1/F3 as route-changing transport shortcuts", () => {
    let path = "/";
    const navigate = vi.fn((next: string) => {
      path = next;
    });
    const shortcut = createNormalNavigationFunctionShortcut({
      variantId: "c64commander",
      loadAssignment: () => "unassigned",
      remoteHandlers: calls,
      transportOptions: { navigate, currentPath: () => path },
    });

    shortcut(1);

    expect(navigate).toHaveBeenCalledWith("/play");
    expect(transportCommandBus.takePending()).toBe("playPause");
  });

  it("uses persisted assignments without navigation in the C64U Remote variant", () => {
    const navigate = vi.fn();
    const shortcut = createNormalNavigationFunctionShortcut({
      variantId: "c64u-remote",
      loadAssignment: () => "search",
      remoteHandlers: calls,
      transportOptions: { navigate, currentPath: () => "/" },
    });

    shortcut(1);

    expect(calls.search).toHaveBeenCalledOnce();
    expect(navigate).not.toHaveBeenCalled();
    expect(transportCommandBus.takePending()).toBeNull();
  });
});
