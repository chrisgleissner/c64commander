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

const t9 = vi.hoisted(() => ({ keypadFlag: true, editionDefault: true }));

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: { keypad_input_enabled: t9.keypadFlag } }),
}));
vi.mock("@/lib/input/t9Defaults", () => ({ isDefaultT9InputEnabled: () => t9.editionDefault }));

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
