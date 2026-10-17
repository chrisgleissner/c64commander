/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { T9FieldListener } from "@/components/input/T9FieldListener";
import { BUILT_IN_KEYPAD_SESSION_KEY, resetHardwareKeypadUseForTests } from "@/lib/input/hardwareKeypadInputMethod";

const t9 = vi.hoisted(() => ({ keypadFlag: true, editionDefault: true }));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: { keypad_input_enabled: t9.keypadFlag } }),
}));
vi.mock("@/lib/input/t9Defaults", () => ({ isDefaultT9InputEnabled: () => t9.editionDefault }));
const platform = vi.hoisted(() => ({ native: false }));
vi.mock("@/lib/native/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/platform")>()),
  isNativePlatform: () => platform.native,
}));

const SearchField = () => {
  const [value, setValue] = useState("");
  return <input aria-label="Search" value={value} onChange={(event) => setValue(event.target.value)} />;
};

const typeDigit = (d: number) =>
  fireEvent.keyDown(screen.getByLabelText("Search"), { key: String(d), code: `Digit${d}` });

describe("T9FieldListener", () => {
  beforeEach(() => {
    t9.keypadFlag = true;
    t9.editionDefault = true;
    resetHardwareKeypadUseForTests();
    platform.native = false;
    sessionStorage.clear();
  });

  it("on a native build, needs the shell to report a built-in keypad before it keeps the input method out", () => {
    platform.native = true;
    render(
      <>
        <T9FieldListener />
        <button>Before</button>
        <SearchField />
      </>,
    );
    const field = screen.getByLabelText("Search");
    const before = screen.getByRole("button", { name: "Before" });

    // A Bluetooth gamepad's arrow key: external, so the shell reports nothing.
    fireEvent.keyDown(before, { key: "ArrowDown", keyCode: 40 });
    fireEvent.focusIn(field);
    expect(field).not.toHaveAttribute("inputmode");

    sessionStorage.setItem(BUILT_IN_KEYPAD_SESSION_KEY, "1");
    fireEvent.keyDown(before, { key: "ArrowDown", keyCode: 40 });
    fireEvent.focusIn(field);
    expect(field).toHaveAttribute("inputmode", "none");
  });

  it("withholds the input method before a programmatic focus() of a field, whoever calls it", () => {
    render(
      <>
        <T9FieldListener />
        <button>Before</button>
        <SearchField />
      </>,
    );
    const field = screen.getByLabelText("Search");
    fireEvent.keyDown(screen.getByRole("button", { name: "Before" }), { key: "ArrowDown", keyCode: 40 });
    let modeWhenFocused: string | null = "unset";
    field.addEventListener("focus", () => {
      modeWhenFocused = field.getAttribute("inputmode");
    });

    field.focus();

    expect(modeWhenFocused).toBe("none");
  });

  it("asks a text field for no platform input method once a hardware keypad has navigated", () => {
    render(
      <>
        <T9FieldListener />
        <button>Before</button>
        <SearchField />
      </>,
    );
    const field = screen.getByLabelText("Search");

    fireEvent.focusIn(field);
    expect(field).not.toHaveAttribute("inputmode");

    // An arrow key that arrives outside any field comes from a hardware D-pad.
    fireEvent.keyDown(screen.getByRole("button", { name: "Before" }), { key: "ArrowDown", keyCode: 40 });
    fireEvent.focusIn(field);
    expect(field).toHaveAttribute("inputmode", "none");
  });

  it("also overrides a text-like inputmode the field set itself", () => {
    render(
      <>
        <T9FieldListener />
        <button>Before</button>
        <input aria-label="File name" inputMode="text" />
      </>,
    );
    const field = screen.getByLabelText("File name");

    fireEvent.keyDown(screen.getByRole("button", { name: "Before" }), { key: "ArrowDown", keyCode: 40 });
    fireEvent.focusIn(field);
    expect(field).toHaveAttribute("inputmode", "none");
  });

  it("keeps the system keyboard out of a number field once a hardware keypad has navigated, and its digits stay digits", () => {
    const PortField = () => {
      const [value, setValue] = useState("");
      return (
        <input aria-label="HTTP port" inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} />
      );
    };
    render(
      <>
        <T9FieldListener />
        <button>Before</button>
        <PortField />
      </>,
    );
    const field = screen.getByLabelText("HTTP port");

    fireEvent.keyDown(screen.getByRole("button", { name: "Before" }), { key: "ArrowDown", keyCode: 40 });
    fireEvent.focusIn(field);
    fireEvent.keyDown(field, { key: "2", code: "Digit2" });

    expect(field).toHaveAttribute("inputmode", "none");
    expect(field).not.toHaveValue("a");
  });

  it("leaves a number field's keyboard alone on a touch phone that never used a keypad", () => {
    render(
      <>
        <T9FieldListener />
        <input aria-label="HTTP port" inputMode="numeric" />
      </>,
    );
    const field = screen.getByLabelText("HTTP port");

    fireEvent.focusIn(field);

    expect(field).toHaveAttribute("inputmode", "numeric");
  });

  it("leaves the input method alone for arrow keys typed inside a field", () => {
    render(
      <>
        <T9FieldListener />
        <SearchField />
      </>,
    );
    const field = screen.getByLabelText("Search");

    fireEvent.keyDown(field, { key: "ArrowLeft", keyCode: 37 });
    fireEvent.focusIn(field);
    expect(field).not.toHaveAttribute("inputmode");
  });

  it("types letters into a React-controlled field that has no composer of its own", () => {
    render(
      <>
        <T9FieldListener />
        <SearchField />
      </>,
    );

    typeDigit(7);

    expect(screen.getByLabelText("Search")).toHaveValue("p");
  });

  it("starts a new letter when the field is entered again", () => {
    render(
      <>
        <T9FieldListener />
        <SearchField />
      </>,
    );
    const field = screen.getByLabelText("Search");
    typeDigit(2);

    fireEvent.focusOut(field);
    typeDigit(2);

    expect(field).toHaveValue("aa");
  });

  it("lets a number key outside a text field keep its own meaning", () => {
    render(
      <>
        <T9FieldListener />
        <button type="button">Play</button>
      </>,
    );

    expect(fireEvent.keyDown(screen.getByText("Play"), { key: "7", code: "Digit7" })).toBe(true);
  });

  it("stays out of the way in an edition that does not type T9 by default", () => {
    t9.editionDefault = false;
    render(
      <>
        <T9FieldListener />
        <SearchField />
      </>,
    );

    expect(typeDigit(7)).toBe(true);
    expect(screen.getByLabelText("Search")).toHaveValue("");
  });

  it("stays out of the way while keypad input is switched off", () => {
    t9.keypadFlag = false;
    render(
      <>
        <T9FieldListener />
        <SearchField />
      </>,
    );

    expect(typeDigit(7)).toBe(true);
  });
});
