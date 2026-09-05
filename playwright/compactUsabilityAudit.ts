/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Locator, Page } from "@playwright/test";

/**
 * Measuring whether a surface is usable on the smallest screen the app supports.
 *
 * The existing small-screen specs prove that nothing is clipped and that text fits. That is a
 * lower bar than the one this file sets. A dialog can pass those checks and still spend four
 * fifths of a 320x427 panel on its own chrome, leaving one row of the list the user opened it
 * for. It can also pass them while being unreachable: the target hardware leads with a physical
 * keypad and ships with the touchscreen switched off, so a control the focus ring never selects
 * cannot be operated at all.
 *
 * Every number here is measured from the rendered page, not read off a stylesheet.
 */

export type CompactDefectKind =
  | "horizontal-overflow"
  | "clipped-content"
  | "starved-body"
  | "overlapping-controls"
  | "text-below-floor"
  | "small-target";

export type CompactDefect = {
  kind: CompactDefectKind;
  what: string;
  detail: string;
};

export type CompactSurfaceMeasurement = {
  surface: { height: number; top: number };
  viewport: { width: number; height: number };
  body: { what: string; visible: number; content: number; share: number } | null;
  defects: CompactDefect[];
};

/** The app's own readability floor for the compact profile, in CSS px. */
export const TEXT_FLOOR_PX = 14;

/**
 * WCAG 2.2 AA "Target Size (Minimum)". Deliberately not the 44 px touch figure: the primary
 * input on this hardware is a keypad, so a small control is a nuisance rather than a blocker,
 * and holding the whole app to 44 px would force layouts that fit less on screen for no gain.
 */
export const TARGET_FLOOR_PX = 24;

/**
 * How much of a surface must be left for the thing the user opened it for.
 *
 * A browser or list surface exists to show rows; below this share it shows chrome with a row
 * peeking out. A form is allowed less, because its fields are the content.
 */
export const BODY_SHARE_FLOOR = {
  list: 0.45,
  form: 0.3,
  /** A confirmation is all chrome by nature, so the share is not meaningful. */
  confirmation: 0,
} as const;

export type SurfaceKind = keyof typeof BODY_SHARE_FLOOR;

type MeasureArgs = { rootSelector: string; bodyShareFloor: number; textFloor: number; targetFloor: number };

const MEASURE = ({ rootSelector, bodyShareFloor, textFloor, targetFloor }: MeasureArgs) => {
  const round = (value: number) => Math.round(value);
  const root = document.querySelector<HTMLElement>(rootSelector);
  if (!root) throw new Error(`compact audit: no element matches ${rootSelector}`);

  const describe = (element: Element): string => {
    const el = element as HTMLElement;
    const label =
      el.getAttribute("data-testid") ||
      el.getAttribute("aria-label") ||
      el.id ||
      (el.textContent ?? "").trim().slice(0, 40) ||
      el.className?.toString().slice(0, 60);
    return `${el.tagName.toLowerCase()}${label ? ` "${label.replace(/\s+/g, " ")}"` : ""}`;
  };

  /*
   * The part of an element the user can actually see, after every ancestor that clips has had its
   * say. Without this, anything parked off screen on purpose reads as horizontal overflow: the tab
   * strip keeps the other pages mounted and translated aside, and a progress bar is a full-width
   * element slid left inside an `overflow-hidden` track.
   */
  const clipRect = (element: Element) => {
    let left = -Infinity;
    let right = Infinity;
    let top = -Infinity;
    let bottom = Infinity;
    let parent = element.parentElement;
    while (parent) {
      const style = getComputedStyle(parent);
      const rect = parent.getBoundingClientRect();
      if (style.overflowX !== "visible") {
        left = Math.max(left, rect.left);
        right = Math.min(right, rect.right);
      }
      if (style.overflowY !== "visible") {
        top = Math.max(top, rect.top);
        bottom = Math.min(bottom, rect.bottom);
      }
      parent = parent.parentElement;
    }
    return { left, right, top, bottom };
  };

  /** What the user can see of an element right now: its box, clipped by everything above it. */
  const visibleRect = (element: Element) => {
    const rect = element.getBoundingClientRect();
    const clip = clipRect(element);
    return {
      left: Math.max(rect.left, clip.left, 0),
      right: Math.min(rect.right, clip.right, window.innerWidth),
      top: Math.max(rect.top, clip.top, 0),
      bottom: Math.min(rect.bottom, clip.bottom, window.innerHeight),
    };
  };

  /** Nothing inside an `aria-hidden` or `inert` subtree is presented to the user. */
  const isPresented = (element: Element) => !element.closest('[aria-hidden="true"]') && !element.closest("[inert]");

  /*
   * `sr-only` renders a real 1x1 box with its content clipped away, on purpose. Measuring those
   * reports every screen-reader label as clipped content and every one of them as a tap target
   * too small to hit, which buries the defects that are real.
   */
  const isScreenReaderOnly = (element: Element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 1 || rect.height <= 1) return true;
    return getComputedStyle(element).clipPath === "inset(50%)";
  };

  const isVisible = (element: Element) => {
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    if (isScreenReaderOnly(element)) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const all = Array.from(root.querySelectorAll<HTMLElement>("*")).filter(
    (element) => isPresented(element) && isVisible(element),
  );
  const defects: { kind: string; what: string; detail: string }[] = [];
  const viewport = { width: window.innerWidth, height: window.innerHeight };

  // Anything past the right edge is unreachable: the page itself must never scroll sideways.
  for (const element of all) {
    const rect = element.getBoundingClientRect();
    const clip = clipRect(element);
    const visibleLeft = Math.max(rect.left, clip.left);
    const visibleRight = Math.min(rect.right, clip.right);
    if (visibleRight <= visibleLeft) continue;
    if (visibleRight > viewport.width + 1 || visibleLeft < -1) {
      defects.push({
        kind: "horizontal-overflow",
        what: describe(element),
        detail: `visible span ${round(visibleLeft)}..${round(visibleRight)} in a ${viewport.width}px viewport`,
      });
    }
  }

  /*
   * Content taller than its box, in a box that cannot scroll, is content nobody can read. An
   * ellipsis is the exception: a clamped line tells the user there is more and where to get it,
   * so it is a deliberate summary rather than something silently cut off.
   */
  for (const element of all) {
    const style = getComputedStyle(element);
    const overflowY = style.overflowY;
    const hidden = overflowY === "hidden" || overflowY === "clip";
    if (!hidden) continue;
    if (style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none") continue;
    if (element.scrollHeight <= element.clientHeight + 4) continue;
    defects.push({
      kind: "clipped-content",
      what: describe(element),
      detail: `${element.scrollHeight}px of content in a ${element.clientHeight}px box with overflow-y: ${overflowY}`,
    });
  }

  // The body is the tallest scrollable region in the surface, which on a page is the surface.
  const scrollable = [root, ...all].filter((element) => /auto|scroll/.test(getComputedStyle(element).overflowY));
  const bodyElement = scrollable.sort((a, b) => b.clientHeight - a.clientHeight)[0] ?? null;
  const surfaceRect = root.getBoundingClientRect();
  const body = bodyElement
    ? {
        what: describe(bodyElement),
        visible: round(bodyElement.clientHeight),
        content: round(bodyElement.scrollHeight),
        share: surfaceRect.height > 0 ? bodyElement.clientHeight / surfaceRect.height : 0,
      }
    : null;

  if (bodyShareFloor > 0) {
    if (!body) {
      defects.push({
        kind: "starved-body",
        what: describe(root),
        detail: "no scrollable body: the surface is chrome only, so a list longer than it cannot be read",
      });
    } else if (body.share < bodyShareFloor) {
      defects.push({
        kind: "starved-body",
        what: body.what,
        detail: `${body.visible}px of ${round(surfaceRect.height)}px (${Math.round(body.share * 100)}%), below the ${Math.round(bodyShareFloor * 100)}% floor`,
      });
    }
  }

  /*
   * Two controls sharing pixels means a press lands on the wrong one. Measured on what is on
   * screen, not on the layout box: a row scrolled halfway behind a sticky footer has a box that
   * reaches under it, and that is ordinary scrolling rather than a defect.
   */
  const controls = all.filter((element) =>
    element.matches("button, a[href], [role=button], [role=tab], [role=switch], [role=checkbox], input, select"),
  );
  const visible = new Map(controls.map((element) => [element, visibleRect(element)]));
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i];
      const b = controls[j];
      if (a.contains(b) || b.contains(a)) continue;
      const ra = visible.get(a)!;
      const rb = visible.get(b)!;
      if (ra.right <= ra.left || ra.bottom <= ra.top) continue;
      if (rb.right <= rb.left || rb.bottom <= rb.top) continue;
      const overlapX = Math.min(ra.right, rb.right) - Math.max(ra.left, rb.left);
      const overlapY = Math.min(ra.bottom, rb.bottom) - Math.max(ra.top, rb.top);
      if (overlapX > 2 && overlapY > 2) {
        defects.push({
          kind: "overlapping-controls",
          what: `${describe(a)} over ${describe(b)}`,
          detail: `${round(overlapX)}x${round(overlapY)}px of shared area on screen`,
        });
      }
    }
  }

  // Text below the floor is not readable at arm's length on a 3.25 inch panel.
  for (const element of all) {
    if (element.children.length > 0) continue;
    const text = (element.textContent ?? "").trim();
    if (!text) continue;
    const size = Number.parseFloat(getComputedStyle(element).fontSize);
    if (Number.isFinite(size) && size < textFloor) {
      defects.push({
        kind: "text-below-floor",
        what: describe(element),
        detail: `${size}px, below the ${textFloor}px floor`,
      });
    }
  }

  /*
   * WCAG 2.2 AA target size, including its spacing exception: a control under the floor is fine
   * when nothing else sits close enough for a press to be ambiguous. Applying the floor without
   * the exception would flag every checkbox in the app, all of which sit alone in a 44px row whose
   * label is itself part of the target.
   */
  const activationRect = (element: Element) => {
    const label = element.closest("label");
    const own = element.getBoundingClientRect();
    if (!label) return own;
    const outer = label.getBoundingClientRect();
    return { width: Math.max(own.width, outer.width), height: Math.max(own.height, outer.height), rect: outer };
  };

  const centres = controls.map((element) => {
    const rect = element.getBoundingClientRect();
    return { element, x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });

  for (const element of controls) {
    const area = activationRect(element);
    if (area.height >= targetFloor && area.width >= targetFloor) continue;

    const own = element.getBoundingClientRect();
    const cx = own.left + own.width / 2;
    const cy = own.top + own.height / 2;
    const crowded = centres.some((other) => {
      if (other.element === element) return false;
      if (other.element.contains(element) || element.contains(other.element)) return false;
      return Math.hypot(other.x - cx, other.y - cy) < targetFloor;
    });
    if (!crowded) continue;

    defects.push({
      kind: "small-target",
      what: describe(element),
      detail: `${round(own.width)}x${round(own.height)}px with another target within ${targetFloor}px, below the ${targetFloor}px floor`,
    });
  }

  return {
    surface: { height: round(surfaceRect.height), top: round(surfaceRect.top) },
    viewport,
    body,
    defects,
  };
};

/**
 * Measures one open surface. `rootSelector` must match the surface's own element, not the page:
 * the checks are scoped to it so a defect in the page behind an open dialog is not reported here.
 */
export const auditCompactSurface = async (
  page: Page,
  rootSelector: string,
  kind: SurfaceKind,
): Promise<CompactSurfaceMeasurement> =>
  (await page.evaluate(MEASURE, {
    rootSelector,
    bodyShareFloor: BODY_SHARE_FLOOR[kind],
    textFloor: TEXT_FLOOR_PX,
    targetFloor: TARGET_FLOOR_PX,
  })) as unknown as CompactSurfaceMeasurement;

export const formatDefects = (name: string, measurement: CompactSurfaceMeasurement): string => {
  const lines = measurement.defects.map((defect) => `  [${defect.kind}] ${defect.what} — ${defect.detail}`);
  const body = measurement.body
    ? `body ${measurement.body.visible}px of ${measurement.surface.height}px (${Math.round(measurement.body.share * 100)}%)`
    : "no scrollable body";
  return `${name}: ${measurement.defects.length} defect(s), ${body}\n${lines.join("\n")}`;
};

/**
 * Every control inside the surface that the keypad focus ring can select, and every one it
 * cannot. A control the ring never reaches is inoperable on hardware whose touchscreen is off.
 */
export const walkRingWithin = async (
  page: Page,
  surface: Locator,
  maxSteps = 200,
): Promise<{ reached: string[]; unreached: string[] }> => {
  const identify = (selectorScope: string) =>
    page.evaluate((scope) => {
      const root = document.querySelector<HTMLElement>(scope);
      if (!root) return [];
      return Array.from(
        root.querySelectorAll<HTMLElement>("button, a[href], [role=button], [role=tab], input, select, textarea"),
      )
        .filter((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        })
        .map(
          (element) =>
            element.getAttribute("data-testid") ??
            element.getAttribute("aria-label") ??
            (element.textContent ?? "").trim().slice(0, 40),
        )
        .filter((label) => label.length > 0);
    }, selectorScope);

  const scope = await surface.evaluate((element) => {
    const testId = element.getAttribute("data-testid");
    if (testId) return `[data-testid="${testId}"]`;
    element.setAttribute("data-compact-audit-scope", "true");
    return "[data-compact-audit-scope='true']";
  });

  const expected = new Set(await identify(scope));
  const reached = new Set<string>();

  for (let step = 0; step < maxSteps && reached.size < expected.size; step += 1) {
    const label = await page.evaluate(() => {
      const selected = document.querySelector('[data-key-selected="true"]');
      if (!selected) return null;
      return (
        selected.getAttribute("data-testid") ??
        selected.getAttribute("aria-label") ??
        (selected.textContent ?? "").trim().slice(0, 40)
      );
    });
    if (label && expected.has(label)) reached.add(label);
    await page.keyboard.press("ArrowDown");
  }

  return {
    reached: [...reached],
    unreached: [...expected].filter((label) => !reached.has(label)),
  };
};
