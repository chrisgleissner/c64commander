/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { resetInputModality } from "@/lib/input";

const t9 = vi.hoisted(() => ({ editionDefault: true }));

vi.mock("@/lib/input/t9Defaults", () => ({ isDefaultT9InputEnabled: () => t9.editionDefault }));
vi.mock("@/hooks/useFeatureFlags", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useFeatureFlags")>()),
  useFeatureFlagValue: (id: string) => id === "keypad_input_enabled",
}));

const actionOf = (slotTestId: string) =>
  screen.getByTestId(slotTestId).querySelector(".keypad-guidance-action")?.textContent ?? "";

const renderWithField = () => {
  render(
    <FocusNavigationProvider enabled>
      <button>Home</button>
      <input aria-label="Filter" defaultValue="" />
    </FocusNavigationProvider>,
  );
  fireEvent.keyDown(document.body, { code: "ArrowDown" });
  return screen.getByLabelText("Filter");
};

const typeInto = (field: HTMLElement, value: string) => {
  (field as HTMLInputElement).value = value;
  fireEvent.input(field);
};

describe("KeypadGuidanceBar while a text field has focus", () => {
  beforeEach(() => {
    t9.editionDefault = true;
  });
  afterEach(() => resetInputModality());

  it("names Delete while the focused field holds text, and hides it once the field is empty", () => {
    const field = renderWithField();
    act(() => field.focus());
    typeInto(field, "si");

    expect(screen.getByTestId("keypad-guidance-right")).not.toHaveAttribute("hidden");
    expect(actionOf("keypad-guidance-right")).toBe("Delete");

    typeInto(field, "");

    expect(screen.getByTestId("keypad-guidance-right")).toHaveAttribute("hidden");
  });

  it("names Back and OK as Done while a page field has focus, since both leave it", () => {
    const field = renderWithField();
    act(() => field.focus());

    expect(actionOf("keypad-guidance-left")).toBe("Done");
    expect(actionOf("keypad-guidance-center")).toBe("Done");
  });

  it("drops Delete once a field that sets its value without an input event is emptied", () => {
    const field = renderWithField();
    act(() => field.focus());
    typeInto(field, "s");
    (field as HTMLInputElement).value = "";

    fireEvent.keyDown(field, { key: "SoftRight", code: "SoftRight" });

    expect(screen.getByTestId("keypad-guidance-right")).toHaveAttribute("hidden");
  });

  it("does not offer Delete in an edition that types digits literally", () => {
    t9.editionDefault = false;
    const field = renderWithField();
    act(() => field.focus());
    typeInto(field, "si");

    expect(screen.getByTestId("keypad-guidance-right")).toHaveAttribute("hidden");
  });
});
