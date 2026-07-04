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

/**
 * The direct high-value keys, minus the cursor keys, which are provided by the
 * CursorPad in the deck profiles rather than as flat KeyDefs (asserted at the
 * component level). All non-cursor high-value keys must be flat KeyDefs in
 * every profile.
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

const collectKeys = (layout: KeyboardLayout): KeyDef[] => flattenLayoutKeys(layout);

describe("getKeyboardLayout", () => {
  it.each(PROFILES)("exposes every non-cursor high-value key directly in the %s profile", (profile) => {
    const testIds = new Set(collectKeys(getKeyboardLayout(profile)).map((key) => key.testId));
    for (const required of REQUIRED_NON_CURSOR_TEST_IDS) {
      expect(testIds.has(required), `${profile} missing ${required}`).toBe(true);
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
    const cursorLeft = keys.find((k) => k.testId === CURSOR_KEY_META.left.testId);
    const cursorUp = keys.find((k) => k.testId === CURSOR_KEY_META.up.testId);

    // Distinct keys…
    expect(arrowLeft?.testId).not.toBe(cursorLeft?.testId);
    expect(arrowUp?.testId).not.toBe(cursorUp?.testId);
    // …distinct actions (character key press vs cursor movement)…
    expect(arrowLeft?.action).toEqual({ kind: "key", inputs: ["arrow_left"] });
    expect(cursorLeft?.action).toEqual({ kind: "cursor", direction: "left" });
    // …and unambiguous accessible labels.
    expect(arrowLeft?.ariaLabel).toMatch(/left-arrow character key/i);
    expect(cursorLeft?.ariaLabel).toMatch(/cursor left/i);
    // The C64 character-arrow keys use the authentic printed glyphs (never "ARW"),
    // while the cursor keys render as icons (no "CUR" text).
    expect(arrowLeft?.label).toBe("←");
    expect(arrowUp?.label).toBe("↑");
    expect(arrowLeft?.label).not.toMatch(/ARW/i);
    (["up", "down", "left", "right"] as const).forEach((direction) => {
      // A renderable lucide icon component (never a "CUR…" text label).
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
    const fKeyIds = ["f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"].map((f) => `remote-input-key-${f}`);
    const inRows = new Set(layout.rows.flat().map((k) => k.testId));
    // No function key is tacked onto the ragged end of a main row…
    fKeyIds.forEach((id) => expect(inRows.has(id), `${id} leaked into main rows`).toBe(false));
    // …they live in the dedicated, ordered function-key box instead.
    expect(layout.functionKeys.map((k) => k.testId)).toEqual(fKeyIds);
  });

  it("dispatches the atomic shifted operations through the shared special-key path", () => {
    const keys = collectKeys(getKeyboardLayout("expanded"));
    const byId = (id: string) => keys.find((k) => k.testId === id)?.action;
    expect(byId("remote-input-key-clr")).toEqual({ kind: "special", key: "clr" });
    expect(byId("remote-input-key-ins")).toEqual({ kind: "special", key: "ins" });
    expect(byId("remote-input-key-f2")).toEqual({ kind: "special", key: "f2" });
    expect(byId("remote-input-key-f4")).toEqual({ kind: "special", key: "f4" });
    expect(byId("remote-input-key-f6")).toEqual({ kind: "special", key: "f6" });
    expect(byId("remote-input-key-f8")).toEqual({ kind: "special", key: "f8" });
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
