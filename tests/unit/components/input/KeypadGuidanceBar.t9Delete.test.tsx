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

const rightAction = () =>
  screen.getByTestId("keypad-guidance-right").querySelector(".keypad-guidance-action")?.textContent ?? "";

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

describe("KeypadGuidanceBar right soft key in a T9 field", () => {
  beforeEach(() => {
    t9.editionDefault = true;
  });
  afterEach(() => resetInputModality());

  it("names Delete while the focused field holds text, and hides it once the field is empty", () => {
    const field = renderWithField();
    act(() => field.focus());
    typeInto(field, "si");

    expect(screen.getByTestId("keypad-guidance-right")).not.toHaveAttribute("hidden");
    expect(rightAction()).toBe("Delete");

    typeInto(field, "");

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
