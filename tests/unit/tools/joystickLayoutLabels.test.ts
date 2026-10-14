/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */
import { describe, expect, it } from "vitest";
import { parseJoystickLayoutLabels, readJoystickLayoutLabels } from "../../../tools/hil/joystick_layout_labels.mjs";
import { JOYSTICK_LAYOUT_LABEL } from "@/lib/remoteInput/joystickKeyBindings";

describe("joystick layout labels the rotation HIL selects", () => {
  it("are the labels the Settings control shows", async () => {
    expect(await readJoystickLayoutLabels()).toEqual(JOYSTICK_LAYOUT_LABEL);
  });

  it("refuses a source without the label map", () => {
    expect(() => parseJoystickLayoutLabels("export const OTHER = {};")).toThrow(/JOYSTICK_LAYOUT_LABEL is not/);
  });

  it("refuses a label map it cannot read", () => {
    expect(() => parseJoystickLayoutLabels("export const JOYSTICK_LAYOUT_LABEL = { [key]: label };")).toThrow(
      /no entries/,
    );
  });
});
