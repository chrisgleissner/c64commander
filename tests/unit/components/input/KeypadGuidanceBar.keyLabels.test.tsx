/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FocusNavigationProvider } from "@/hooks/useFocusNavigation";
import { resolveGuidanceLabels, resolveSoftKeyMenuOverlayLabels, resolveSoftKeyMenuPanelLabels } from "@/lib/input";
import { setKeyLabelsOverride } from "@/lib/variant/keyLabels";

afterEach(() => setKeyLabelsOverride(null));

const state = {
  enabled: true,
  modality: "key-navigation",
  hasCurrent: true,
  currentKind: "button",
  breadcrumb: [],
  atRoot: true,
  fieldEngaged: false,
  layerOpen: false,
  hasMenu: true,
  fieldDeletes: false,
  gameModeShortcut: false,
} as const;

const renderedCaps = () => {
  const { getByTestId } = render(
    <FocusNavigationProvider enabled>
      <button>Home</button>
    </FocusNavigationProvider>,
  );
  const cap = (id: string) => getByTestId(id).querySelector(".keypad-guidance-cap")?.textContent;
  return [cap("keypad-guidance-left"), cap("keypad-guidance-center"), cap("keypad-guidance-right")];
};

describe("guidance bar key labels", () => {
  it("prints the configured words for back, close, menu and delete", () => {
    setKeyLabelsOverride({ backWord: "Return", closeWord: "Dismiss", menuWord: "Options", deleteWord: "Erase" });
    expect(resolveGuidanceLabels(state)).toMatchObject({ left: "Return", right: "Options" });
    expect(resolveGuidanceLabels({ ...state, layerOpen: true }).left).toBe("Dismiss");
    expect(resolveGuidanceLabels({ ...state, fieldDeletes: true }).right).toBe("Erase");
    expect(resolveSoftKeyMenuOverlayLabels(true, null, "softRight")).toMatchObject({
      left: "Dismiss",
      right: "Options",
    });
    expect(resolveSoftKeyMenuOverlayLabels(true, null, "back")).toMatchObject({ left: "Options", right: "Erase" });
    expect(resolveSoftKeyMenuPanelLabels(true, null).left).toBe("Dismiss");
  });

  it("keeps today's words by default", () => {
    expect(resolveGuidanceLabels(state)).toMatchObject({ left: "Back", right: "Menu" });
  });

  it("draws the configured key caps", () => {
    setKeyLabelsOverride({ leftCap: "L", centerCap: "C", rightCap: "R" });
    expect(renderedCaps()).toEqual(["L", "C", "R"]);
  });

  it("draws Back, OK and Menu caps by default", () => {
    expect(renderedCaps()).toEqual(["Back", "OK", "Menu"]);
  });
});
