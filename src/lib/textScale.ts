/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * How large the app's text is drawn.
 *
 * There are two independent scales and they compose:
 *
 * 1. **The operating system's font size.** Android applies this to the WebView through
 *    `WebSettings.textZoom`, which the activity sets from `Configuration.fontScale`.
 *    It needs nothing from this module - the platform scales every rendered size for
 *    us. It exists because a user who has already made text bigger everywhere on their
 *    device has told us what they want, and an app that ignores that is the one app
 *    they have to fight.
 * 2. **The app's own setting**, below. Some users only want larger text here, and on a
 *    device where the system setting is awkward to reach it is the only control they
 *    have. It is applied by scaling the root font size, which moves every `rem`-based
 *    size in the stylesheet, including the compact display profile's type steps.
 *
 * Because the two are applied by different mechanisms - the platform zooms the whole
 * WebView, this changes the root size inside it - they multiply, and a user who has set
 * both gets both. That is the intent: neither silently overrides the other.
 */

/**
 * The root font size the stylesheet is designed around, and the CSS variable that
 * carries it. `html { font-size: var(--display-profile-root-font-size) }` already
 * exists, so the setting is applied by overriding that variable rather than by writing
 * `style.fontSize` on the element: that keeps one owner of the root size instead of two
 * that could disagree.
 */
export const BASE_ROOT_FONT_SIZE_PX = 16;
export const ROOT_FONT_SIZE_VARIABLE = "--display-profile-root-font-size";

export const TEXT_SCALE_OPTIONS = [
  { id: "default", label: "Default", scale: 1 },
  { id: "large", label: "Large", scale: 1.15 },
  { id: "larger", label: "Larger", scale: 1.3 },
  { id: "largest", label: "Largest", scale: 1.5 },
] as const;

export type TextScaleId = (typeof TEXT_SCALE_OPTIONS)[number]["id"];

export const DEFAULT_TEXT_SCALE_ID: TextScaleId = "default";

export const isTextScaleId = (value: unknown): value is TextScaleId =>
  typeof value === "string" && TEXT_SCALE_OPTIONS.some((option) => option.id === value);

/**
 * The multiplier for a stored id, falling back to 1 for anything unrecognised so a
 * corrupt or future-dated preference cannot leave the app with unreadable text.
 */
export const resolveTextScale = (id: string | null | undefined): number =>
  TEXT_SCALE_OPTIONS.find((option) => option.id === id)?.scale ?? 1;

/**
 * The root font size, in CSS pixels, for a given setting.
 *
 * Clamped rather than trusted: a value below the base would make text smaller than the
 * design intends, which is the one thing this feature must never do, and an unbounded
 * upper value would break every layout at once.
 */
export const resolveRootFontSizePx = (id: string | null | undefined): number => {
  const scale = resolveTextScale(id);
  const clamped = Math.min(1.5, Math.max(1, scale));
  return Math.round(BASE_ROOT_FONT_SIZE_PX * clamped * 100) / 100;
};

/**
 * Applies the setting to the document. Safe to call before the DOM exists (during SSR
 * or a unit test), where it does nothing.
 */
export const applyTextScaleToDocument = (id: string | null | undefined): void => {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.style.setProperty(ROOT_FONT_SIZE_VARIABLE, `${resolveRootFontSizePx(id)}px`);
  root.dataset.textScale = isTextScaleId(id) ? id : DEFAULT_TEXT_SCALE_ID;
};
