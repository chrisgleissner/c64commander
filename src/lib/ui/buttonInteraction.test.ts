/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyPointerButtonInteraction,
  CTA_HIGHLIGHT_DURATION_MS,
  CTA_PERSISTENT_ACTIVE_ATTR,
  handlePointerButtonClick,
  registerGlobalButtonInteractionModel,
} from "./buttonInteraction";

describe("buttonInteraction", () => {
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  it("adds transient tap flash and clears it automatically", () => {
    vi.useFakeTimers();
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    applyPointerButtonInteraction(button);
    expect(button.getAttribute("data-c64-tap-flash")).toBe("true");

    vi.advanceTimersByTime(CTA_HIGHLIGHT_DURATION_MS);
    expect(button.hasAttribute("data-c64-tap-flash")).toBe(false);
  });

  it("skips transient flash for persistent-active buttons", () => {
    const button = document.createElement("button");
    button.setAttribute(CTA_PERSISTENT_ACTIVE_ATTR, "true");
    document.body.appendChild(button);

    applyPointerButtonInteraction(button);
    expect(button.hasAttribute("data-c64-tap-flash")).toBe(false);
  });

  it("skips transient flash for aria-disabled custom controls", () => {
    const control = document.createElement("div");
    control.setAttribute("role", "button");
    control.setAttribute("aria-disabled", "true");
    document.body.appendChild(control);

    applyPointerButtonInteraction(control);
    expect(control.hasAttribute("data-c64-tap-flash")).toBe(false);
  });

  it("skips transient flash for data-disabled radix controls", () => {
    const control = document.createElement("div");
    control.setAttribute("role", "menuitem");
    control.setAttribute("data-disabled", "");
    document.body.appendChild(control);

    applyPointerButtonInteraction(control);
    expect(control.hasAttribute("data-c64-tap-flash")).toBe(false);
  });

  it("ignores keyboard-triggered clicks for stateless flash", () => {
    const button = document.createElement("button");
    document.body.appendChild(button);

    handlePointerButtonClick({ detail: 0, currentTarget: button });
    expect(button.hasAttribute("data-c64-tap-flash")).toBe(false);
  });

  it("applies interaction model globally to non-button CTAs", () => {
    const cleanup = registerGlobalButtonInteractionModel();
    const link = document.createElement("a");
    link.href = "#";
    document.body.appendChild(link);

    link.dispatchEvent(new MouseEvent("pointerup", { bubbles: true, button: 0 }));
    expect(link.getAttribute("data-c64-tap-flash")).toBe("true");

    cleanup();
  });

  it("applies interaction model for touch pointer events", () => {
    const cleanup = registerGlobalButtonInteractionModel();
    const button = document.createElement("button");
    document.body.appendChild(button);

    const event = new Event("pointerup", { bubbles: true }) as PointerEvent;
    Object.defineProperty(event, "button", { value: -1 });
    Object.defineProperty(event, "pointerType", { value: "touch" });

    button.dispatchEvent(event);
    expect(button.getAttribute("data-c64-tap-flash")).toBe("true");

    cleanup();
  });

  it("clears pending pointer focus when the window regains focus after a picker-like interruption", () => {
    vi.useFakeTimers();
    const cleanup = registerGlobalButtonInteractionModel();
    const button = document.createElement("button");
    document.body.appendChild(button);
    button.focus();

    applyPointerButtonInteraction(button);
    expect(document.activeElement).toBe(button);

    window.dispatchEvent(new Event("focus"));

    expect(document.activeElement).not.toBe(button);
    cleanup();
  });
});
