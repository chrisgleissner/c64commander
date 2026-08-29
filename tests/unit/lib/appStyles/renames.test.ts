/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { APP_STYLES, APP_STYLE_RENAMES, DEFAULT_APP_STYLE_ID } from "@/generated/appStyles";
import { applyStyleRename } from "@/lib/appStyles/renames";

describe("applyStyleRename", () => {
  it.each(Object.entries(APP_STYLE_RENAMES))("maps the retired id %s to %s", (oldId, newId) => {
    expect(applyStyleRename(oldId)).toBe(newId);
  });

  it("maps every retired id onto a style that exists", () => {
    for (const newId of Object.values(APP_STYLE_RENAMES)) {
      expect(APP_STYLES.some((style) => style.id === newId)).toBe(true);
    }
  });

  it("passes a live id through unchanged", () => {
    expect(applyStyleRename(DEFAULT_APP_STYLE_ID)).toBe(DEFAULT_APP_STYLE_ID);
  });

  it("passes an unknown id through unchanged so the caller's own fallback runs", () => {
    expect(applyStyleRename("not-a-real-style")).toBe("not-a-real-style");
  });
});
