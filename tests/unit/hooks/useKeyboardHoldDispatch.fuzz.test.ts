/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useKeyboardHoldDispatch } from "@/hooks/useKeyboardHoldDispatch";
import { EMPTY_HELD_KEYBOARD_INPUTS } from "@/lib/remoteInput/keyboardHeldSet";
import type { HeldKeyboardInputs } from "@/lib/remoteInput/keyboardHeldSet";
import type { KeyboardInputName } from "@/lib/c64api";

/**
 * Property-based coverage for `useKeyboardHoldDispatch`: this is the ONLY
 * layer that has to get "rapid same-key taps, rapid different-key taps, N
 * keys held while others are tapped" right, since it is what turns physical
 * gestures into the held-inputs set the session diffs into press/release
 * calls. Hand-picked examples (see useKeyboardHoldDispatch.test.ts) prove the
 * documented behaviours; this file throws hundreds of random-but-realistic
 * gesture sequences at it and checks invariants that must hold for ANY
 * sequence, not just the ones a human thought to write down.
 */

// Deterministic PRNG (mulberry32) so a failing seed is reproducible from the
// printed seed rather than a one-off flake.
const mulberry32 = (seed: number) => {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ORDINARY_KEYS: KeyboardInputName[] = ["a", "b", "c", "1", "space", "return", "f1"];
const MODIFIERS: KeyboardInputName[] = ["left_shift", "ctrl", "commodore"];

const createDriver = () => {
  const state = { held: EMPTY_HELD_KEYBOARD_INPUTS as HeldKeyboardInputs };
  const view = renderHook(
    ({ held }: { held: HeldKeyboardInputs }) =>
      useKeyboardHoldDispatch(held, (next) => {
        state.held = next;
      }),
    { initialProps: { held: state.held } },
  );
  const sync = () => view.rerender({ held: state.held });
  return {
    held: () => state.held,
    pressKey: (inputs: KeyboardInputName[]) => {
      act(() => view.result.current.pressKey(inputs));
      sync();
    },
    releaseKey: (inputs: KeyboardInputName[]) => {
      act(() => view.result.current.releaseKey(inputs));
      sync();
    },
    pressModifier: (modifier: KeyboardInputName) => {
      act(() => view.result.current.pressModifier(modifier));
      sync();
    },
    releaseModifier: (modifier: KeyboardInputName) => {
      act(() => view.result.current.releaseModifier(modifier));
      sync();
    },
    toggleShiftLock: () => {
      act(() => view.result.current.toggleShiftLock());
      sync();
    },
    shiftLocked: () => view.result.current.shiftLocked,
  };
};

type Step =
  | { kind: "pressKey"; key: KeyboardInputName }
  | { kind: "releaseKey"; key: KeyboardInputName }
  | { kind: "pressModifier"; modifier: KeyboardInputName }
  | { kind: "releaseModifier"; modifier: KeyboardInputName }
  | { kind: "toggleShiftLock" };

/**
 * Builds one random-but-realistic gesture sequence: only releases something
 * that is currently down, only presses something not already down (mirrors
 * real pointer/touch semantics — a finger can't press twice without lifting).
 * Every sequence ends with releasing everything still held, then one extra
 * ordinary key tap (press+release) to flush any pending one-shot latch, and
 * toggling shift lock off if it was left on — so the final held set has a
 * single well-defined expected value: empty.
 */
const buildRandomSequence = (rng: () => number, length: number): Step[] => {
  const steps: Step[] = [];
  const downKeys = new Set<KeyboardInputName>();
  const downModifiers = new Set<KeyboardInputName>();
  let shiftLocked = false;

  const pick = <T,>(items: readonly T[]): T => items[Math.floor(rng() * items.length)];

  for (let i = 0; i < length; i += 1) {
    const choice = rng();
    if (choice < 0.35) {
      const notDown = ORDINARY_KEYS.filter((k) => !downKeys.has(k));
      if (notDown.length === 0) continue;
      const key = pick(notDown);
      downKeys.add(key);
      steps.push({ kind: "pressKey", key });
    } else if (choice < 0.55 && downKeys.size > 0) {
      const key = pick([...downKeys]);
      downKeys.delete(key);
      steps.push({ kind: "releaseKey", key });
    } else if (choice < 0.75) {
      const notDown = MODIFIERS.filter((m) => !downModifiers.has(m));
      if (notDown.length === 0) continue;
      const modifier = pick(notDown);
      downModifiers.add(modifier);
      steps.push({ kind: "pressModifier", modifier });
    } else if (choice < 0.9 && downModifiers.size > 0) {
      const modifier = pick([...downModifiers]);
      downModifiers.delete(modifier);
      steps.push({ kind: "releaseModifier", modifier });
    } else {
      shiftLocked = !shiftLocked;
      steps.push({ kind: "toggleShiftLock" });
    }
  }

  // Release everything still "physically down".
  for (const key of downKeys) steps.push({ kind: "releaseKey", key: key as KeyboardInputName });
  for (const modifier of downModifiers) steps.push({ kind: "releaseModifier", modifier });
  if (shiftLocked) steps.push({ kind: "toggleShiftLock" });
  // Flush any one-shot modifier latch left pending by a bare tap.
  steps.push({ kind: "pressKey", key: "return" });
  steps.push({ kind: "releaseKey", key: "return" });

  return steps;
};

const FUZZ_ITERATIONS = 200;
const SEED = 20260705;

describe("useKeyboardHoldDispatch fuzz coverage", () => {
  it(`never throws and always returns to empty across ${FUZZ_ITERATIONS} random release-everything sequences`, () => {
    const rng = mulberry32(SEED);
    for (let iteration = 0; iteration < FUZZ_ITERATIONS; iteration += 1) {
      const length = 4 + Math.floor(rng() * 20);
      const sequence = buildRandomSequence(rng, length);
      const d = createDriver();

      expect(() => {
        for (const step of sequence) {
          switch (step.kind) {
            case "pressKey":
              d.pressKey([step.key]);
              break;
            case "releaseKey":
              d.releaseKey([step.key]);
              break;
            case "pressModifier":
              d.pressModifier(step.modifier);
              break;
            case "releaseModifier":
              d.releaseModifier(step.modifier);
              break;
            case "toggleShiftLock":
              d.toggleShiftLock();
              break;
          }
        }
      }, `iteration ${iteration}, sequence: ${JSON.stringify(sequence)}`).not.toThrow();

      expect(d.held(), `iteration ${iteration} did not end empty: ${JSON.stringify(sequence)}`).toEqual(new Set());
      expect(d.shiftLocked(), `iteration ${iteration} left shift lock engaged`).toBe(false);
    }
  });

  it("never reports a key as held that was never pressed during the sequence", () => {
    const rng = mulberry32(SEED + 1);
    for (let iteration = 0; iteration < FUZZ_ITERATIONS; iteration += 1) {
      const length = 4 + Math.floor(rng() * 20);
      const sequence = buildRandomSequence(rng, length);
      const everPressed = new Set<KeyboardInputName>();
      for (const step of sequence) {
        if (step.kind === "pressKey") everPressed.add(step.key);
        if (step.kind === "pressModifier") everPressed.add(step.modifier);
        // SHIFT LOCK independently asserts left_shift while engaged - not a
        // pressKey/pressModifier step, but a legitimate source of "held".
        if (step.kind === "toggleShiftLock") everPressed.add("left_shift");
      }
      const d = createDriver();

      for (const step of sequence) {
        switch (step.kind) {
          case "pressKey":
            d.pressKey([step.key]);
            break;
          case "releaseKey":
            d.releaseKey([step.key]);
            break;
          case "pressModifier":
            d.pressModifier(step.modifier);
            break;
          case "releaseModifier":
            d.releaseModifier(step.modifier);
            break;
          case "toggleShiftLock":
            d.toggleShiftLock();
            break;
        }
        for (const held of d.held()) {
          expect(everPressed.has(held), `phantom held key "${held}" in iteration ${iteration}`).toBe(true);
        }
      }
    }
  });

  it("keeps a held modifier asserted across an arbitrary number of other keys pressed and released while it is held", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    for (const key of ["a", "b", "c", "1", "space"] as const) {
      d.pressKey([key]);
      expect(d.held().has("left_shift"), `left_shift dropped while pressing ${key}`).toBe(true);
      expect(d.held().has(key)).toBe(true);
      d.releaseKey([key]);
      expect(d.held().has("left_shift"), `left_shift dropped after releasing ${key}`).toBe(true);
      expect(d.held().has(key)).toBe(false);
    }
    d.releaseModifier("left_shift");
    expect(d.held()).toEqual(new Set());
  });

  it("holds multiple modifiers simultaneously and combines them onto a subsequently pressed key", () => {
    const d = createDriver();
    d.pressModifier("left_shift");
    d.pressModifier("ctrl");
    d.pressModifier("commodore");
    d.pressKey(["a"]);
    expect(d.held()).toEqual(new Set(["left_shift", "ctrl", "commodore", "a"]));
    d.releaseKey(["a"]);
    expect(d.held()).toEqual(new Set(["left_shift", "ctrl", "commodore"]));
    d.releaseModifier("left_shift");
    d.releaseModifier("ctrl");
    d.releaseModifier("commodore");
    expect(d.held()).toEqual(new Set());
  });

  it("survives rapid repeated tapping of the same key without ever leaving it stuck", () => {
    const d = createDriver();
    for (let i = 0; i < 50; i += 1) {
      d.pressKey(["a"]);
      expect(d.held()).toEqual(new Set(["a"]));
      d.releaseKey(["a"]);
      expect(d.held()).toEqual(new Set());
    }
  });

  it("survives rapid tapping across many different keys without cross-contamination", () => {
    const d = createDriver();
    for (const key of ["a", "b", "c", "1", "space", "return", "f1"] as const) {
      d.pressKey([key]);
      expect(d.held()).toEqual(new Set([key]));
      d.releaseKey([key]);
      expect(d.held()).toEqual(new Set());
    }
  });
});
