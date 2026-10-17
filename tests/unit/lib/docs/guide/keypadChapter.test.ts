/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";

import { keypadChapter } from "@/lib/docs/guide/helpChapters";
import { OK_KEY_WORDS, resolveGuidanceLabels, type FocusKind, type GuidanceState } from "@/lib/input/guidance";
import { KEYPAD_KEY_LABELS } from "@/lib/variant/keyLabels";

const SECTION = "The two keys under the screen";

const keyBlocks = (variantId: string) =>
  keypadChapter({ variantId, flags: {} }).blocks.filter((block) => block.kind === "keys");

const stateFor = (currentKind: FocusKind): GuidanceState => ({
  enabled: true,
  modality: "key-navigation",
  hasCurrent: true,
  currentKind,
  breadcrumb: [],
  atRoot: true,
  fieldEngaged: false,
  layerOpen: false,
  hasMenu: false,
  fieldDeletes: false,
  gameModeShortcut: false,
});

describe("keypad chapter of the in-app guide", () => {
  it("explains the two keys under the screen on the keypad edition, with the key names the variant uses", () => {
    const section = keyBlocks("c64u-remote").find((block) => block.heading === SECTION);

    expect(section?.kind === "keys" ? section.items.map((item) => item.key) : []).toEqual([
      KEYPAD_KEY_LABELS.leftSoft,
      KEYPAD_KEY_LABELS.center,
      KEYPAD_KEY_LABELS.rightSoft,
    ]);
  });

  it("leaves the section out of the broad edition, whose keyboards print their own key names", () => {
    expect(keyBlocks("c64commander").some((block) => block.heading === SECTION)).toBe(false);
  });

  it("lists every word the OK key can read, and the OK key reads no word the section leaves out", () => {
    const section = keyBlocks("c64u-remote").find((block) => block.heading === SECTION);
    const okAction = section?.kind === "keys" ? section.items[1].action : "";
    OK_KEY_WORDS.forEach((word) => expect(okAction).toContain(word));

    const kinds: FocusKind[] = [
      "group",
      "button",
      "expand",
      "collapse",
      "link",
      "menu",
      "field",
      "select",
      "switch",
      "slider",
      "tab",
      "none",
    ];
    kinds.forEach((kind) => expect(OK_KEY_WORDS).toContain(resolveGuidanceLabels(stateFor(kind)).center));
  });
});
