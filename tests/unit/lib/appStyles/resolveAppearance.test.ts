/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from "vitest";
import { APP_STYLES, DEFAULT_APP_STYLE_ID } from "@/generated/appStyles";
import { resolveAppearance, type Theme } from "@/lib/appStyles/resolveAppearance";

const THEMES: readonly Theme[] = ["light", "dark", "system"];
const SYSTEM_PREFS: readonly boolean[] = [true, false];

/**
 * The highest-value unit test in the feature (docs/plans/appearance-styles/plan.md, Phase 4):
 * resolveAppearance is a pure function over a small, fully enumerable input space, so its
 * behaviour can be pinned exactly rather than sampled. This exercises every declared style id
 * (7) x every theme setting (3) x every system preference (2) = 42 matrix cases, plus the
 * dark-only clamp and unknown-id fallback rules spec.md section 7.1 calls out explicitly.
 */
describe("resolveAppearance", () => {
  const matrixCases = APP_STYLES.flatMap((style) =>
    THEMES.flatMap((theme) => SYSTEM_PREFS.map((systemPrefersDark) => ({ style, theme, systemPrefersDark }))),
  );

  it("covers every style x theme x system-preference combination", () => {
    expect(matrixCases).toHaveLength(APP_STYLES.length * THEMES.length * SYSTEM_PREFS.length);
  });

  it.each(matrixCases.map(({ style, theme, systemPrefersDark }) => [style.id, theme, systemPrefersDark] as const))(
    "%s / theme=%s / systemPrefersDark=%s",
    (styleId, theme, systemPrefersDark) => {
      const style = APP_STYLES.find((candidate) => candidate.id === styleId);
      if (!style) throw new Error(`unknown style id in test matrix: ${styleId}`);
      const result = resolveAppearance({ storedStyleId: styleId, theme, systemPrefersDark });

      expect(result.styleId).toBe(styleId);
      expect(result.fellBackToDefault).toBe(false);

      const declaresLight = style.modes.includes("light");
      const declaresDark = style.modes.includes("dark");

      if (declaresLight && declaresDark) {
        expect(result.themeClamped).toBe(false);
        const expectedMode = theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
        expect(result.mode).toBe(expectedMode);
      } else {
        expect(result.themeClamped).toBe(true);
        expect(result.mode).toBe(declaresDark ? "dark" : "light");
      }
    },
  );

  describe("dark-only clamp (spec.md section 7.1, rule 2)", () => {
    const darkOnlyStyles = APP_STYLES.filter((style) => style.modes.length === 1 && style.modes[0] === "dark");

    it("has at least one dark-only style to exercise the clamp", () => {
      expect(darkOnlyStyles.length).toBeGreaterThan(0);
    });

    it.each(darkOnlyStyles.map((style) => style.id))(
      "%s stays dark under the light theme setting, ignoring theme entirely",
      (styleId) => {
        const result = resolveAppearance({ storedStyleId: styleId, theme: "light", systemPrefersDark: false });
        expect(result.mode).toBe("dark");
        expect(result.themeClamped).toBe(true);
      },
    );

    it.each(darkOnlyStyles.map((style) => style.id))(
      "%s stays dark under the system theme setting even when the OS prefers light",
      (styleId) => {
        const result = resolveAppearance({ storedStyleId: styleId, theme: "system", systemPrefersDark: false });
        expect(result.mode).toBe("dark");
        expect(result.themeClamped).toBe(true);
      },
    );
  });

  describe("unknown-id fallback (spec.md section 7.1, rule 3)", () => {
    it("falls back to the compiled default for an id that matches no declared style", () => {
      const result = resolveAppearance({
        storedStyleId: "not-a-real-style-id",
        theme: "light",
        systemPrefersDark: false,
      });
      expect(result.styleId).toBe(DEFAULT_APP_STYLE_ID);
      expect(result.fellBackToDefault).toBe(true);
    });

    it("resolves the default style's own mode/theme behaviour on fallback", () => {
      const result = resolveAppearance({
        storedStyleId: "not-a-real-style-id",
        theme: "dark",
        systemPrefersDark: false,
      });
      expect(result.mode).toBe("dark");
    });

    it("treats a null stored id as first-run, not as a fallback-worthy error", () => {
      const result = resolveAppearance({ storedStyleId: null, theme: "light", systemPrefersDark: false });
      expect(result.styleId).toBe(DEFAULT_APP_STYLE_ID);
      expect(result.fellBackToDefault).toBe(false);
    });
  });
});
