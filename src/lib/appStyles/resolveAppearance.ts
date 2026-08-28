/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { APP_STYLES, DEFAULT_APP_STYLE_ID, type AppStyle, type AppStyleMode } from "@/generated/appStyles";

export type Theme = "light" | "dark" | "system";

export interface ResolvedAppearance {
  readonly styleId: string;
  readonly mode: AppStyleMode;
  /**
   * The resolved style declares only one mode, so `mode` above ignores `theme` and the Settings
   * Theme row must be shown disabled, with an explanation (spec.md section 7.1, rule 2).
   */
  readonly themeClamped: boolean;
  /**
   * The requested style id did not match any style currently compiled in (a downgrade, or a
   * style retired from the YAML), so this resolved to the compiled default instead. The caller
   * is responsible for clearing the stored value — resolveAppearance is pure and performs no
   * storage I/O itself (spec.md section 7.1, rule 3).
   */
  readonly fellBackToDefault: boolean;
}

const findStyle = (id: string | null): AppStyle | undefined =>
  id === null ? undefined : APP_STYLES.find((style) => style.id === id);

const DEFAULT_STYLE = APP_STYLES.find((style) => style.id === DEFAULT_APP_STYLE_ID);
if (!DEFAULT_STYLE) {
  throw new Error(`DEFAULT_APP_STYLE_ID ${JSON.stringify(DEFAULT_APP_STYLE_ID)} is not among the generated styles`);
}

/**
 * Resolves the persisted style id + theme setting + OS colour-scheme preference into the concrete
 * (styleId, mode) pair the app should render, per spec.md section 7.1.
 *
 * `storedStyleId` must already be a concrete style id: `resolveMatchMyDeviceStyleId` turns the
 * "Match my device" sentinel into one before this function ever sees it.
 */
export const resolveAppearance = ({
  storedStyleId,
  theme,
  systemPrefersDark,
}: {
  storedStyleId: string | null;
  theme: Theme;
  systemPrefersDark: boolean;
}): ResolvedAppearance => {
  const requested = findStyle(storedStyleId);
  const fellBackToDefault = storedStyleId !== null && !requested;
  const style = requested ?? DEFAULT_STYLE;

  const declaresLight = style.modes.includes("light");
  const declaresDark = style.modes.includes("dark");

  if (declaresLight && declaresDark) {
    const mode: AppStyleMode = theme === "system" ? (systemPrefersDark ? "dark" : "light") : theme;
    return { styleId: style.id, mode, themeClamped: false, fellBackToDefault };
  }

  return { styleId: style.id, mode: declaresDark ? "dark" : "light", themeClamped: true, fellBackToDefault };
};
