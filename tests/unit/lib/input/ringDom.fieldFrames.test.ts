/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { FIELD_FRAME_ATTR, fieldOfFrame, frameOfField, stepFocusWithinOverlay } from "@/lib/input/ringDom";

const framedField = (name: string) => {
  const frame = document.createElement("div");
  frame.tabIndex = -1;
  frame.setAttribute(FIELD_FRAME_ATTR, "");
  frame.dataset.testid = `${name}-field`;
  const input = document.createElement("input");
  input.inputMode = "numeric";
  input.dataset.testid = name;
  frame.append(input);
  return { frame, input };
};

const dialogWith = (...children: HTMLElement[]) => {
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "dialog");
  dialog.append(...children);
  document.body.append(dialog);
  return dialog;
};

describe("field frames in an overlay", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("stops on the field's row, not its input, so selecting a number field does not open a keyboard", () => {
    const before = document.createElement("button");
    const http = framedField("http");
    const dialog = dialogWith(before, http.frame);
    before.focus();

    stepFocusWithinOverlay(dialog, before, true);

    expect(document.activeElement).toBe(http.frame);
  });

  it("moves on from inside an edited field to the next row", () => {
    const http = framedField("http");
    const ftp = framedField("ftp");
    const dialog = dialogWith(http.frame, ftp.frame);
    http.input.focus();

    stepFocusWithinOverlay(dialog, http.input, true);

    expect(document.activeElement).toBe(ftp.frame);
  });

  it("keeps a button inside a field row as a stop of its own", () => {
    const host = framedField("host");
    const useAddress = document.createElement("button");
    host.frame.append(useAddress);
    const dialog = dialogWith(host.frame);
    host.frame.focus();

    stepFocusWithinOverlay(dialog, host.frame, true);

    expect(document.activeElement).toBe(useAddress);
  });

  it("names the input a row edits, and the row an input belongs to", () => {
    const http = framedField("http");
    dialogWith(http.frame);

    expect(fieldOfFrame(http.frame)).toBe(http.input);
    expect(frameOfField(http.input)).toBe(http.frame);
    expect(frameOfField(http.frame)).toBeNull();
  });
});
