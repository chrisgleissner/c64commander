/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import {
  CURSOR_KEY_META,
  flattenLayoutKeys,
  getKeyboardLayout,
  type KeyDef,
  type KeyboardLayout,
} from "@/lib/remoteInput/keyboardLayout";
import type { KeyboardProfile } from "@/lib/remoteInput/keyboardProfile";

const PROFILES: KeyboardProfile[] = ["compact", "medium", "expanded"];
const DECK_PROFILES: KeyboardProfile[] = ["compact", "medium"];

/**
 * The direct high-value keys, minus the cursor keys, which are provided by the
 * CursorPad in the deck profiles rather than as flat KeyDefs (asserted at the
 * component level). All non-cursor high-value keys must be flat KeyDefs in
 * every deck profile (compact/medium).
 */
const REQUIRED_NON_CURSOR_TEST_IDS = [
  "remote-input-key-return",
  "remote-input-key-space",
  "remote-input-key-clr",
  "remote-input-key-home",
  "remote-input-key-ins",
  "remote-input-key-del",
  "remote-input-key-f1",
  "remote-input-key-f2",
  "remote-input-key-f3",
  "remote-input-key-f4",
  "remote-input-key-f5",
  "remote-input-key-f6",
  "remote-input-key-f7",
  "remote-input-key-f8",
  "remote-input-key-run-stop",
  "remote-input-key-restore",
  "remote-input-key-commodore",
  "remote-input-key-ctrl",
  "remote-input-key-shift",
  "remote-input-key-shift-lock",
];

// The expanded profile mirrors a real C64 keyboard's shape: HOME/CLR,
// DEL/INST and each F-key pair are ONE physical key (see keyboardLayout.ts's
// CLR_HOME_MERGED etc.), so its required-keys list uses the merged ids.
const REQUIRED_EXPANDED_TEST_IDS = [
  "remote-input-key-return",
  "remote-input-key-space",
  "remote-input-key-clr-home",
  "remote-input-key-inst-del",
  "remote-input-key-cursor-up-down",
  "remote-input-key-cursor-left-right",
  "remote-input-key-f1-f2",
  "remote-input-key-f3-f4",
  "remote-input-key-f5-f6",
  "remote-input-key-f7-f8",
  "remote-input-key-run-stop",
  "remote-input-key-restore",
  "remote-input-key-commodore",
  "remote-input-key-ctrl",
  "remote-input-key-shift",
  "remote-input-key-shift-lock",
];

const collectKeys = (layout: KeyboardLayout): KeyDef[] => flattenLayoutKeys(layout);

describe("getKeyboardLayout", () => {
  it.each(DECK_PROFILES)("exposes every non-cursor high-value key directly in the %s profile", (profile) => {
    const testIds = new Set(collectKeys(getKeyboardLayout(profile)).map((key) => key.testId));
    for (const required of REQUIRED_NON_CURSOR_TEST_IDS) {
      expect(testIds.has(required), `${profile} missing ${required}`).toBe(true);
    }
  });

  it("exposes every high-value key (merged pairs included) directly in the expanded profile", () => {
    const testIds = new Set(collectKeys(getKeyboardLayout("expanded")).map((key) => key.testId));
    for (const required of REQUIRED_EXPANDED_TEST_IDS) {
      expect(testIds.has(required), `expanded missing ${required}`).toBe(true);
    }
  });

  it("uses a deck layout for compact/medium and physical rows for expanded", () => {
    expect(getKeyboardLayout("compact").kind).toBe("deck");
    expect(getKeyboardLayout("medium").kind).toBe("deck");
    expect(getKeyboardLayout("expanded").kind).toBe("rows");
  });

  it("keeps the C64 character-arrow keys distinct from the cursor movement keys", () => {
    const keys = collectKeys(getKeyboardLayout("expanded"));
    const arrowLeft = keys.find((k) => k.testId === "remote-input-key-arrow_left");
    const arrowUp = keys.find((k) => k.testId === "remote-input-key-arrow_up");
    // The expanded profile's cursor keys are merged (one physical key per
    // axis, exactly like HOME/CLR - see CURSOR_LEFT_RIGHT_MERGED), so "cursor
    // left" is reached via the left/right key's shifted half, not a standalone
    // flat key - assert against the merged key's UNSHIFTED (main) direction.
    const cursorLeftRight = keys.find((k) => k.testId === "remote-input-key-cursor-left-right");

    // Distinct keys…
    expect(arrowLeft?.testId).not.toBe(cursorLeftRight?.testId);
    // …distinct actions (character key press vs cursor movement)…
    expect(arrowLeft?.action).toEqual({ kind: "key", inputs: ["arrow_left"] });
    expect(cursorLeftRight?.action).toEqual({ kind: "cursor", direction: "right" });
    // …and unambiguous accessible labels.
    expect(arrowLeft?.ariaLabel).toMatch(/left-arrow character key/i);
    expect(cursorLeftRight?.ariaLabel).toMatch(/cursor right/i);
    // The C64 character-arrow keys use the authentic printed glyphs (never "ARW"),
    // while the merged cursor key renders plain arrow glyphs too, but as a
    // main/secondary pair rather than a single icon.
    expect(arrowLeft?.label).toBe("←");
    expect(arrowUp?.label).toBe("↑");
    expect(arrowLeft?.label).not.toMatch(/ARW/i);
    expect(cursorLeftRight?.label).toBe("→");
    expect(cursorLeftRight?.secondary).toBe("←");
    // The CursorPad (compact/medium decks) still renders real icons for each direction.
    (["up", "down", "left", "right"] as const).forEach((direction) => {
      expect(CURSOR_KEY_META[direction].icon, `cursor ${direction} icon`).toBeTruthy();
      expect(CURSOR_KEY_META[direction]).not.toHaveProperty("label");
    });
  });

  it("adds a persistent SHIFT LOCK key (distinct from the one-shot SHIFT) in every profile", () => {
    for (const profile of PROFILES) {
      const keys = collectKeys(getKeyboardLayout(profile));
      const shiftLock = keys.find((k) => k.testId === "remote-input-key-shift-lock");
      expect(shiftLock, `${profile} shift lock`).toBeDefined();
      expect(shiftLock?.action).toEqual({ kind: "shift_lock" });
      // It is not tier-gated (works wherever the one-shot SHIFT does).
      expect(shiftLock?.requiresFullTier).toBeFalsy();
      expect(shiftLock?.ariaLabel).toMatch(/shift lock/i);
    }
  });

  it("renders the expanded function keys as a dedicated bounded box, not inside the main rows", () => {
    const layout = getKeyboardLayout("expanded");
    if (layout.kind !== "rows") throw new Error("expanded layout must be row-based");
    // Each merged pair (F1/F2, F3/F4, F5/F6, F7/F8) is ONE physical key here,
    // matching the real C64's function-key cluster.
    const fKeyIds = ["f1-f2", "f3-f4", "f5-f6", "f7-f8"].map((f) => `remote-input-key-${f}`);
    const inRows = new Set(layout.rows.flat().map((k) => k.testId));
    // No function key is tacked onto the ragged end of a main row…
    fKeyIds.forEach((id) => expect(inRows.has(id), `${id} leaked into main rows`).toBe(false));
    // …they live in the dedicated, ordered function-key box instead.
    expect(layout.functionKeys.map((k) => k.testId)).toEqual(fKeyIds);
  });

  // The true physical C64 rows by KeyDef id, minus the keys extracted to the
  // deck's edit/system/immediate/cursor groups (which are EXEMPT from the grid
  // invariant). Every deck grid row must be a contiguous slice of exactly one.
  const C64_ROWS: readonly string[][] = [
    ["arrow_left", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0", "plus", "minus", "pound"],
    ["q", "w", "e", "r", "t", "y", "u", "i", "o", "p", "at", "star", "arrow_up"],
    ["a", "s", "d", "f", "g", "h", "j", "k", "l", "colon", "semicolon", "equals"],
    ["z", "x", "c", "v", "b", "n", "m", "comma", "period", "slash"],
  ];
  const isContiguousSliceOfOneRow = (ids: string[]) =>
    C64_ROWS.some((row) => {
      for (let start = 0; start + ids.length <= row.length; start += 1) {
        if (ids.every((id, offset) => row[start + offset] === id)) return true;
      }
      return false;
    });

  it.each(["compact", "medium"] as const)(
    "renders every %s grid row as a contiguous slice of exactly one C64 row (HARD16-007)",
    (profile) => {
      const layout = getKeyboardLayout(profile);
      if (layout.kind !== "deck") throw new Error(`${profile} layout must be deck-based`);
      layout.grid.forEach((row, index) => {
        const ids = row.map((key) => key.id);
        expect(
          isContiguousSliceOfOneRow(ids),
          `${profile} grid row ${index} [${ids.join(", ")}] is not a contiguous slice of one C64 row`,
        ).toBe(true);
      });
      // Function keys stay a dedicated block — never interleaved into the grid.
      const fKeyIds = new Set(["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"]);
      const gridIds = layout.grid.flat().map((key) => key.id);
      expect(gridIds.some((id) => fKeyIds.has(id))).toBe(false);
    },
  );

  it("resolves each merged expanded key's MAIN action to the unshifted special key - the shifted half is reached by holding Shift while tapping, not a separate KeyDef", () => {
    const keys = collectKeys(getKeyboardLayout("expanded"));
    const byId = (id: string) => keys.find((k) => k.testId === id);
    // Main actions are the unshifted half…
    expect(byId("remote-input-key-clr-home")?.action).toEqual({ kind: "special", key: "home" });
    expect(byId("remote-input-key-inst-del")?.action).toEqual({ kind: "special", key: "del" });
    expect(byId("remote-input-key-f1-f2")?.action).toEqual({ kind: "special", key: "f1" });
    expect(byId("remote-input-key-f3-f4")?.action).toEqual({ kind: "special", key: "f3" });
    expect(byId("remote-input-key-f5-f6")?.action).toEqual({ kind: "special", key: "f5" });
    expect(byId("remote-input-key-f7-f8")?.action).toEqual({ kind: "special", key: "f7" });
    // …and the `secondary` legend documents the shifted half for the user
    // (TypeKeyboard.test.tsx proves holding Shift while tapping reaches it).
    expect(byId("remote-input-key-clr-home")?.secondary).toBe("CLR");
    expect(byId("remote-input-key-inst-del")?.secondary).toBe("INST");
    expect(byId("remote-input-key-f1-f2")?.secondary).toContain("2");
  });

  it("carries authentic C64 shifted secondary legends on the number and punctuation keys", () => {
    const keys = collectKeys(getKeyboardLayout("medium"));
    const legend = (testId: string) => keys.find((k) => k.testId === testId)?.secondary;
    expect(legend("remote-input-key-1")).toBe("!");
    expect(legend("remote-input-key-2")).toBe('"');
    expect(legend("remote-input-key-3")).toBe("#");
    expect(legend("remote-input-key-4")).toBe("$");
    expect(legend("remote-input-key-5")).toBe("%");
    expect(legend("remote-input-key-6")).toBe("&");
    expect(legend("remote-input-key-7")).toBe("'");
    expect(legend("remote-input-key-8")).toBe("(");
    expect(legend("remote-input-key-9")).toBe(")");
    expect(legend("remote-input-key-colon")).toBe("[");
    expect(legend("remote-input-key-semicolon")).toBe("]");
    expect(legend("remote-input-key-comma")).toBe("<");
    expect(legend("remote-input-key-period")).toBe(">");
    expect(legend("remote-input-key-slash")).toBe("?");
  });

  it.each(["compact", "medium"] as const)("pins a SHIFT | SPACE | RETURN bottom row below the %s grid", (profile) => {
    const layout = getKeyboardLayout(profile);
    if (layout.kind !== "deck") throw new Error(`${profile} layout must be deck-based`);
    expect(layout.bottomRow.map((k) => k.testId)).toEqual([
      "remote-input-key-shift-bottom",
      "remote-input-key-space-bottom",
      "remote-input-key-return-bottom",
    ]);
    // SPACE/RETURN repeat their top counterparts (distinct ids), SHIFT its colour.
    expect(layout.bottomRow[1].action).toEqual({ kind: "char", char: " " });
    expect(layout.bottomRow[2].action).toEqual({ kind: "char", char: "\n" });
    expect(layout.bottomRow[0].tone).toBe("shift");
    expect(layout.immediate.some((k) => k.testId === "remote-input-key-space")).toBe(true);
    expect(layout.immediate.some((k) => k.testId === "remote-input-key-return")).toBe(true);
  });

  it("colours the ordinary typing keys (0-9, A-Z) with the character tone and SHIFT with the shift tone", () => {
    const keys = collectKeys(getKeyboardLayout("medium"));
    const toneOf = (testId: string) => keys.find((k) => k.testId === testId)?.tone;
    expect(toneOf("remote-input-key-a")).toBe("character");
    expect(toneOf("remote-input-key-1")).toBe("character");
    expect(toneOf("remote-input-key-shift")).toBe("shift");
    expect(toneOf("remote-input-key-shift-lock")).toBe("shift");
    // Symbols and system modifiers keep their own tones (not "character").
    expect(toneOf("remote-input-key-plus")).not.toBe("character");
    expect(toneOf("remote-input-key-ctrl")).toBe("modifier");
  });

  it("tints the odd (unshifted) function keys f1/f3/f5/f7 apart from the shifted f2/f4/f6/f8", () => {
    const keys = collectKeys(getKeyboardLayout("medium"));
    const toneOf = (testId: string) => keys.find((k) => k.testId === testId)?.tone;
    for (const n of [1, 3, 5, 7]) expect(toneOf(`remote-input-key-f${n}`)).toBe("function-primary");
    for (const n of [2, 4, 6, 8]) expect(toneOf(`remote-input-key-f${n}`)).toBe("function");
  });

  it("prints the function keys lower-case with a space, exactly as on the C64 keycaps (f 1 … f 8)", () => {
    const keys = collectKeys(getKeyboardLayout("medium"));
    const labelOf = (testId: string) => keys.find((k) => k.testId === testId)?.label;
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) expect(labelOf(`remote-input-key-f${n}`)).toBe(`f${"\u00a0\u00a0"}${n}`);
  });

  it("spells RESTORE in full, keeping REST. only for the dense expanded layout (HARD16-008)", () => {
    const restore = collectKeys(getKeyboardLayout("expanded")).find((k) => k.testId === "remote-input-key-restore");
    expect(restore?.label).toBe("RESTORE");
    expect(restore?.compactLabel).toBe("REST.");
    expect(restore?.ariaLabel).toBe("Restore");
  });

  it("flags only the no-fallback keys as requiring the full tier", () => {
    const keys = collectKeys(getKeyboardLayout("expanded"));
    const requiresFull = new Set(keys.filter((k) => k.requiresFullTier).map((k) => k.testId));
    expect(requiresFull).toEqual(
      new Set([
        "remote-input-key-run-stop",
        "remote-input-key-restore",
        "remote-input-key-commodore",
        "remote-input-key-ctrl",
      ]),
    );
  });

  it("gives every key a non-empty accessible label", () => {
    for (const profile of PROFILES) {
      for (const key of collectKeys(getKeyboardLayout(profile))) {
        expect(key.ariaLabel.trim().length, `${profile} ${key.testId}`).toBeGreaterThan(0);
      }
    }
  });
});
