/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseVariantSource } from "../../../../scripts/generate-variant.mjs";
import { backKeyName, menuKeyName } from "@/lib/docs/guide/keyNames";
import { GENERIC_KEY_LABELS, KEYPAD_KEY_LABELS, getKeyLabels, setKeyLabelsOverride } from "@/lib/variant/keyLabels";

afterEach(() => setKeyLabelsOverride(null));

describe("getKeyLabels", () => {
  it("returns the selected variant's generated labels, which are the generic set for the default variant", () => {
    expect(getKeyLabels()).toEqual(GENERIC_KEY_LABELS);
    expect(getKeyLabels("c64commander")).toEqual(GENERIC_KEY_LABELS);
  });

  it("returns the keypad edition's built-in names when that edition is not the selected variant", () => {
    expect(getKeyLabels("c64u-remote")).toEqual(KEYPAD_KEY_LABELS);
    expect(KEYPAD_KEY_LABELS.leftSoft).toBe("Left Soft Key");
    expect(KEYPAD_KEY_LABELS.rightSoft).toBe("Right Soft Key");
  });

  it("applies an override on top of the variant's labels and restores them when cleared", () => {
    setKeyLabelsOverride({ leftSoft: "Lower Left" });
    expect(getKeyLabels().leftSoft).toBe("Lower Left");
    expect(getKeyLabels("c64u-remote").leftSoft).toBe("Lower Left");
    expect(getKeyLabels().rightSoft).toBe("Menu key");
    setKeyLabelsOverride(null);
    expect(getKeyLabels().leftSoft).toBe("Back key");
  });

  it("feeds the guide's key names", () => {
    expect(backKeyName("c64u-remote")).toBe("Left Soft Key");
    expect(menuKeyName("c64commander")).toBe("Menu key");
    setKeyLabelsOverride({ leftSoft: "Lower Left", rightSoft: "Lower Right" });
    expect(backKeyName("c64u-remote")).toBe("Lower Left");
    expect(menuKeyName("c64u-remote")).toBe("Lower Right");
  });

  it("matches what variants.yaml generates for each edition, so the built-in sets cannot drift", () => {
    const source = readFileSync(path.resolve(__dirname, "../../../../variants/variants.yaml"), "utf8");
    const config = parseVariantSource(source) as any;
    expect(config.variants.c64commander.runtime.keyLabels).toEqual(GENERIC_KEY_LABELS);
    expect(config.variants["c64u-remote"].runtime.keyLabels).toEqual(KEYPAD_KEY_LABELS);
  });
});
