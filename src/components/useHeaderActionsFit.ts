/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useLayoutEffect, useRef, useState, type MutableRefObject } from "react";

export interface HeaderRowWidths {
  /** The width the header row has: the card's inner width. */
  available: number;
  /** The toggle's padding, icon and the gap before the title. */
  toggleChrome: number;
  /** The full title, as drawn in the heading's font, plus any badge beside it. */
  title: number;
  actions: number;
  chevron: number;
  /** Gaps and padding of the row that holds toggle, actions and chevron. */
  rowChrome: number;
}

/** Whether title, actions and chevron share one row with the full title drawn. */
export const headerFitsOneRow = (widths: HeaderRowWidths): boolean =>
  widths.toggleChrome + widths.title + widths.actions + widths.chevron + widths.rowChrome <= widths.available + 0.5;

let measureContext: CanvasRenderingContext2D | null = null;
const measureText = (text: string, element: Element): number => {
  measureContext ??= document.createElement("canvas").getContext("2d");
  if (!measureContext) return 0;
  const style = getComputedStyle(element);
  measureContext.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  return measureContext.measureText(text).width;
};

const px = (value: string) => Number.parseFloat(value) || 0;
const width = (element: Element | null | undefined) => element?.getBoundingClientRect().width ?? 0;

export interface HeaderActionsFitRefs {
  section: MutableRefObject<HTMLElement | null>;
  toggle: MutableRefObject<HTMLButtonElement | null>;
  /** Holds the actions, in whichever row they are drawn; its first child is measured. */
  actions: MutableRefObject<HTMLDivElement | null>;
}

/**
 * Measures whether a card header with actions fits on one row, from widths that do not depend on
 * which layout is drawn: the card's width, the full title's text width and the actions' own width.
 * A decision taken from the drawn title's width would feed back on itself, as `FittedText` once did.
 *
 * `null` until there is a layout to measure (closed tab, jsdom), so the caller keeps its default.
 */
export const useHeaderActionsFit = (enabled: boolean, title: string): [HeaderActionsFitRefs, boolean | null] => {
  const section = useRef<HTMLElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);
  const actions = useRef<HTMLDivElement | null>(null);
  const [fits, setFits] = useState<boolean | null>(null);

  useLayoutEffect(() => {
    if (!enabled || typeof ResizeObserver === "undefined") return undefined;
    const measure = () => {
      const sectionEl = section.current;
      const toggleEl = toggle.current;
      const actionsEl = actions.current?.firstElementChild;
      const heading = toggleEl?.querySelector("h2");
      if (!sectionEl || !toggleEl || !actionsEl || !heading || sectionEl.clientWidth <= 0) return;
      const toggleStyle = getComputedStyle(toggleEl);
      const iconSlot = toggleEl.firstElementChild?.firstElementChild;
      const titleLine = heading.parentElement;
      const badge = heading.nextElementSibling;
      const row = toggleEl.parentElement;
      // The single-row layout wraps toggle, actions and chevron in a `display: contents` box.
      const rowBox = row && getComputedStyle(row).display === "contents" ? row.parentElement : row;
      const rowStyle = rowBox ? getComputedStyle(rowBox) : null;
      const rowGap = rowStyle ? px(rowStyle.columnGap) : 0;
      const innerGap = toggleEl.firstElementChild ? px(getComputedStyle(toggleEl.firstElementChild).columnGap) : 0;
      const titleGap = titleLine ? px(getComputedStyle(titleLine).columnGap) : 0;
      setFits(
        headerFitsOneRow({
          available: sectionEl.clientWidth,
          toggleChrome: px(toggleStyle.paddingLeft) + px(toggleStyle.paddingRight) + width(iconSlot) + innerGap,
          title: Math.ceil(measureText(title, heading)) + (badge ? width(badge) + titleGap : 0),
          actions: width(actionsEl),
          chevron: width(row?.lastElementChild),
          rowChrome: 2 * rowGap + (rowStyle ? px(rowStyle.paddingLeft) + px(rowStyle.paddingRight) : 0),
        }),
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    for (const element of [section.current, toggle.current, actions.current?.firstElementChild]) {
      if (element) observer.observe(element);
    }
    return () => observer.disconnect();
    // `fits` re-attaches the observer: switching layout draws the actions in a new element.
  }, [enabled, title, fits]);

  return [{ section, toggle, actions }, enabled ? fits : null];
};
