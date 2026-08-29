/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { APP_STYLES } from "@/generated/appStyles";
import preRenameTokens from "../../../fixtures/appStyleTokens.pre-rename.json";

/**
 * The renames in the discoverability spec section 10 change three style ids and three display
 * names and must change nothing else. "Byte-identical to the previous build" cannot be asserted
 * after regeneration, so the fixture holds every compiled token value from before the rename,
 * keyed by the new id, and this compares the live table against it.
 */
describe("appearance renames change no colour", () => {
  const compiled = Object.fromEntries(
    APP_STYLES.map((style) => [
      style.id,
      {
        modes: [...style.modes],
        ...(style.light ? { light: style.light } : {}),
        ...(style.dark ? { dark: style.dark } : {}),
      },
    ]),
  );

  it("covers exactly the styles that exist", () => {
    expect(Object.keys(compiled).sort()).toEqual(Object.keys(preRenameTokens).sort());
  });

  it.each(Object.keys(preRenameTokens))("has the pre-rename tokens for %s", (styleId) => {
    expect(compiled[styleId]).toEqual(preRenameTokens[styleId as keyof typeof preRenameTokens]);
  });
});
