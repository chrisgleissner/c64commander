/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SearchKeyListener } from "@/components/search/SearchKeyListener";
import { TAB_ROUTES } from "@/lib/navigation/tabRoutes";
import { subscribeSearchOpen, type SearchOpenRequest } from "@/lib/search/overlayState";
import { beginKeyCapture } from "@/lib/input/keyCaptureState";

const pressSeven = (target: EventTarget = window) =>
  fireEvent.keyDown(target as Element | Document | Window, { code: "Digit7", key: "7", keyCode: 55 });

describe("SearchKeyListener", () => {
  let opened: SearchOpenRequest[] = [];
  let release: () => void = () => undefined;

  beforeEach(() => {
    opened = [];
    release = subscribeSearchOpen((request) => opened.push(request));
  });

  afterEach(() => {
    release();
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  /*
   * The listener is NOT the keypad shortcut handler. That one lives inside FocusNavigationProvider,
   * which App mounts with enabled={flags.keypad_input_enabled}, so the search key would vanish for
   * anyone who turned keypad navigation off. This test renders the listener alone — no provider at
   * all, which is the strongest form of "keypad_input_enabled is false".
   */
  it("opens search on 7 with no focus-navigation provider mounted at all", () => {
    render(<SearchKeyListener />);
    pressSeven();
    expect(opened).toEqual([{ source: "key" }]);
  });

  it("is inert inside a text field, so 7 still reaches T9", () => {
    render(<SearchKeyListener />);
    const input = document.createElement("input");
    input.type = "text";
    document.body.appendChild(input);
    input.focus();
    pressSeven(input);
    expect(opened).toEqual([]);
  });

  it("is inert inside a textarea and a contenteditable", () => {
    render(<SearchKeyListener />);
    const textarea = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    document.body.append(textarea, editable);
    pressSeven(textarea);
    pressSeven(editable);
    expect(opened).toEqual([]);
  });

  it("is inert while an overlay owns the keyboard", () => {
    render(<SearchKeyListener />);
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);
    pressSeven();
    expect(opened).toEqual([]);
  });

  it("ignores a key that is not the search key", () => {
    render(<SearchKeyListener />);
    fireEvent.keyDown(window, { code: "Digit6", key: "6", keyCode: 54 });
    fireEvent.keyDown(window, { code: "KeyS", key: "s" });
    expect(opened).toEqual([]);
  });

  it("stops listening once unmounted", () => {
    const { unmount } = render(<SearchKeyListener />);
    unmount();
    pressSeven();
    expect(opened).toEqual([]);
  });

  /*
   * 7 is free only while there are six tabs. A seventh would make digit7 a page jump and silently
   * steal the search key, so this fails the build instead.
   */
  it("has fewer than seven tabs, which is what leaves 7 free", () => {
    expect(TAB_ROUTES.length).toBeLessThan(7);
  });
});

/*
 * Game Mode's joystick binder waits for a key so it can record which one. It is an inline settings
 * block rather than a Radix overlay, so the open-overlay exclusion does not see it, and both it and
 * this listener are on the capture phase of window with this one registered first — so
 * `event.defaultPrevented` is always false here. Pressing 7 while capturing a slot bound the slot
 * AND dropped the search overlay over Settings.
 */
describe("while a key binding is being captured", () => {
  it("leaves the key to whatever is capturing it", () => {
    const opens: unknown[] = [];
    const stop = subscribeSearchOpen((request) => opens.push(request));
    render(<SearchKeyListener />);

    const endCapture = beginKeyCapture();
    try {
      fireEvent.keyDown(window, { key: "7", code: "Digit7" });
      expect(opens).toEqual([]);
    } finally {
      endCapture();
    }

    fireEvent.keyDown(window, { key: "7", code: "Digit7" });
    expect(opens).toHaveLength(1);
    stop();
  });
});
