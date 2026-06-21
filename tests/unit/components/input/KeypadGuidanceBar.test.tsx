/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { KeypadGuidanceBar } from "@/components/input/KeypadGuidanceBar";
import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { resetInputModality } from "@/lib/input";

/**
 * Integration coverage for the guidance bar — the keypad-first device's soft-key +
 * breadcrumb strip and its only modality-gated discoverability affordance.
 *
 * The PURE label policy lives in `@/lib/input/guidance` (unit-tested in isolation);
 * THIS suite proves the React adapter wires that policy onto the DOM imperatively:
 * visibility follows the same flag+modality gate as the highlight, the breadcrumb /
 * soft-key text mirror the resolved labels, the Menu slot shows/hides with a context
 * menu, the empty-scope fallback reads "Navigation", and the bar is a harmless no-op
 * outside a provider. The provider renders the bar itself, so most cases just drive
 * keys at the provider and read the bar back; only the no-provider case renders it
 * standalone.
 */

/** The contextual action text written into a soft-key slot (excludes the static `<kbd>` cap). */
const actionText = (slotTestId: string): string =>
  screen.getByTestId(slotTestId).querySelector(".keypad-guidance-action")?.textContent ?? "";

const bar = () => screen.getByTestId("keypad-guidance-bar");
const breadcrumb = () => screen.getByTestId("keypad-guidance-breadcrumb");

describe("KeypadGuidanceBar", () => {
  afterEach(() => resetInputModality());

  it("renders nothing and stays inert with no provider (null context)", () => {
    // No FocusNavigationContext → the bar must not render or throw (mirrors the
    // "useFocusItem with no provider is harmless" contract).
    expect(() => render(<KeypadGuidanceBar />)).not.toThrow();
    expect(screen.queryByTestId("keypad-guidance-bar")).toBeNull();
  });

  it("stays hidden in pointer modality (no recognized key yet)", () => {
    render(
      <FocusNavigationProvider enabled>
        <button>Home</button>
        <button>Settings</button>
      </FocusNavigationProvider>,
    );

    // Default modality is pointer → the bar is mounted but not shown.
    expect(bar()).toHaveAttribute("data-visible", "false");
  });

  it("stays hidden while the keypad flag is off even after a key", () => {
    render(
      <FocusNavigationProvider enabled={false}>
        <button>Home</button>
        <button>Settings</button>
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });
    expect(bar()).toHaveAttribute("data-visible", "false");
  });

  it("shows with the focused item's label and OK action after a nav key", () => {
    render(
      <FocusNavigationProvider enabled>
        <button>Home</button>
        <button>Settings</button>
      </FocusNavigationProvider>,
    );

    // ArrowDown flips modality to key-navigation and moves the ring onto Settings.
    fireEvent.keyDown(document.body, { code: "ArrowDown" });

    expect(bar()).toHaveAttribute("data-visible", "true");
    expect(breadcrumb()).toHaveTextContent("Settings");
    // A plain button → OK activates it; at the page root the left soft key is Back;
    // no context menu → the Menu slot is hidden.
    expect(actionText("keypad-guidance-center")).toBe("Activate");
    expect(actionText("keypad-guidance-left")).toBe("Back");
    expect(screen.getByTestId("keypad-guidance-right")).toHaveAttribute("hidden");
  });

  it("exposes the Menu soft key when the focused item has a context menu", () => {
    render(
      <FocusNavigationProvider enabled>
        <button>Home</button>
        <button aria-haspopup="menu">Actions</button>
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });

    expect(bar()).toHaveAttribute("data-visible", "true");
    expect(breadcrumb()).toHaveTextContent("Actions");
    // hasContextMenu(current) → the right slot is revealed and labelled "Menu".
    expect(screen.getByTestId("keypad-guidance-right")).not.toHaveAttribute("hidden");
    expect(actionText("keypad-guidance-right")).toBe("Menu");
  });

  it("falls back to 'Navigation' when the visible ring item has no readable label", () => {
    // Two label-less (icon-only) buttons: the ring still moves and flips modality,
    // but the current item resolves to no accessible name and sits at the page root,
    // so the breadcrumb has no segments and the bar shows its generic fallback.
    render(
      <FocusNavigationProvider enabled>
        <button aria-hidden={false} />
        <button aria-hidden={false} />
      </FocusNavigationProvider>,
    );

    fireEvent.keyDown(document.body, { code: "ArrowDown" });

    expect(bar()).toHaveAttribute("data-visible", "true");
    expect(breadcrumb()).toHaveTextContent("Navigation");
  });
});
