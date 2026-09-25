/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";

import { resolveInputProfile } from "@/lib/input/profiles";
import { composeT9Key, endT9Composition, isT9Field } from "@/lib/input/t9FieldComposer";

const keypad = resolveInputProfile("keypad");

const field = (attributes: Record<string, string> = {}): HTMLInputElement => {
  const input = document.createElement("input");
  Object.entries(attributes).forEach(([name, value]) => input.setAttribute(name, value));
  document.body.appendChild(input);
  input.focus();
  return input;
};

/** Dispatches one key at the field and composes it the way the document listener does. */
const press = (target: HTMLInputElement, init: KeyboardEventInit, now: number): boolean => {
  let consumed = false;
  const listener = (event: KeyboardEvent) => {
    consumed = composeT9Key(event, keypad, now);
  };
  document.addEventListener("keydown", listener);
  target.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  document.removeEventListener("keydown", listener);
  return consumed;
};

const digit = (d: number): KeyboardEventInit => ({ key: String(d), code: `Digit${d}` });
const SOFT_RIGHT: KeyboardEventInit = { key: "SoftRight", code: "SoftRight" };

/** Types a multi-tap sequence: each group is one letter, with a pause after it that commits it. */
const typeWords = (target: HTMLInputElement, groups: number[][]) => {
  let now = 1000;
  groups.forEach((group) => {
    group.forEach((d) => {
      now += 10;
      press(target, digit(d), now);
    });
    now += 5000;
  });
};

afterEach(() => {
  document.body.innerHTML = "";
});

describe("composeT9Key", () => {
  it("types letters on the number keys into a plain text field", () => {
    const input = field();

    typeWords(input, [[7, 7, 7, 7], [4, 4, 4], [3]]);

    expect(input.value).toBe("sid");
  });

  it("fires an input event so a React-controlled field sees the edit", () => {
    const input = field();
    const seen: string[] = [];
    input.addEventListener("input", () => seen.push(input.value));

    press(input, digit(2), 1000);

    expect(seen).toEqual(["a"]);
  });

  it("types digits directly and separators on star in a field marked for host names", () => {
    const input = field({ "data-t9-mode": "hostname" });
    let now = 1000;
    [digit(1), digit(0), { key: "*", code: "NumpadMultiply" }, digit(5)].forEach((init) => {
      now += 10;
      press(input, init, now);
    });

    expect(input.value).toBe("10.5");
  });

  it("deletes the last character with the right soft key", () => {
    const input = field();
    typeWords(input, [[2], [3]]);

    expect(press(input, SOFT_RIGHT, 20_000)).toBe(true);
    expect(input.value).toBe("a");
  });

  it("leaves the right soft key alone in an empty field", () => {
    const input = field();

    expect(press(input, SOFT_RIGHT, 1000)).toBe(false);
  });

  it("keeps cycling a letter in a field that upper-cases what is typed", () => {
    const input = field({ "data-t9-mode": "hostname" });
    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase();
    });
    let now = 1000;
    [{ key: "#", code: "Pound" }, digit(2), digit(2)].forEach((init) => {
      now += 10;
      press(input, init, now);
    });

    expect(input.value).toBe("B");
  });

  it("keeps a letter another input method re-cased while one is being cycled", () => {
    const input = field();
    press(input, digit(2), 1000);
    input.value = "A";

    press(input, digit(2), 1010);

    expect(input.value).toBe("b");
    input.value = "B";
    press(input, digit(2), 5000);
    expect(input.value).toBe("Ba");
  });

  it("starts a new letter after the field was left and entered again", () => {
    const input = field();
    press(input, digit(2), 1000);

    endT9Composition(input);
    press(input, digit(2), 1010);

    expect(input.value).toBe("aa");
  });

  it("adopts text another input method put in the field", () => {
    const input = field();
    press(input, digit(2), 1000);
    input.value = "c64u";

    press(input, digit(0), 10_000);

    expect(input.value).toBe("c64u ");
  });

  it("composes into a textarea the same way", () => {
    const area = document.createElement("textarea");
    document.body.appendChild(area);
    area.focus();
    let consumed = false;
    const listener = (event: KeyboardEvent) => {
      consumed = composeT9Key(event, keypad, 1000);
    };
    document.addEventListener("keydown", listener);
    area.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...digit(2) }));
    document.removeEventListener("keydown", listener);

    expect(consumed).toBe(true);
    expect(area.value).toBe("a");
  });

  it("leaves keys that are not T9 keys to the field", () => {
    const input = field();

    expect(press(input, { key: "Shift", code: "ShiftLeft" }, 1000)).toBe(false);
    expect(press(input, { key: "ArrowDown", code: "ArrowDown" }, 1010)).toBe(false);
    expect(input.value).toBe("");
  });

  it("ignores leaving an element that is not a T9 field, or a field nothing was typed into", () => {
    const button = document.createElement("button");
    const input = field();

    expect(() => endT9Composition(button)).not.toThrow();
    expect(() => endT9Composition(input)).not.toThrow();
    press(input, digit(2), 1000);
    expect(input.value).toBe("a");
  });

  it("does not compose a key a field already handled itself", () => {
    const input = field();
    input.addEventListener("keydown", (event) => event.preventDefault());

    expect(press(input, digit(2), 1000)).toBe(false);
    expect(input.value).toBe("");
  });
});

describe("isT9Field", () => {
  it("accepts text, search and password fields and textareas", () => {
    expect(isT9Field(field())).toBe(true);
    expect(isT9Field(field({ type: "search" }))).toBe(true);
    expect(isT9Field(field({ type: "password" }))).toBe(true);
    expect(isT9Field(document.createElement("textarea"))).toBe(true);
  });

  it("leaves numeric, read-only, disabled and opted-out fields to take digits literally", () => {
    expect(isT9Field(field({ type: "number" }))).toBe(false);
    expect(isT9Field(field({ inputmode: "numeric" }))).toBe(false);
    expect(isT9Field(field({ readonly: "" }))).toBe(false);
    expect(isT9Field(field({ disabled: "" }))).toBe(false);
    expect(isT9Field(field({ "data-t9": "off" }))).toBe(false);
    expect(isT9Field(document.createElement("button"))).toBe(false);
  });
});
