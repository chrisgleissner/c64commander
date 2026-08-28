/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { Page } from "@playwright/test";

/**
 * Measures whether the text on screen actually fits the space it has been given.
 *
 * `smallScreenErgonomics.spec.ts` measures the *cause* - how large the type is and how
 * large the controls are. It cannot see the *consequence*, which is that larger type in
 * an unchanged box runs out of the box. Both checks are needed: the ergonomics spec
 * stops the type being shrunk to make something fit, and this one stops the type being
 * enlarged without giving it room.
 *
 * Everything here is a measurement of the rendered page rather than an inspection of
 * CSS, so it reports what a user would see rather than what a stylesheet intends.
 */

export type LayoutDefectKind = "clipped" | "outside-viewport" | "overlap" | "mid-word-break";

export type LayoutDefect = {
  kind: LayoutDefectKind;
  /** Human-readable path to the offending element, testids first. */
  selector: string;
  /** The measurement that failed, with numbers. */
  detail: string;
  /** The text involved, truncated. */
  text: string;
};

export type LayoutAuditOptions = {
  /**
   * Selectors whose subtree is not measured. Used for surfaces that are legitimately
   * wider than the viewport and are scrolled or zoomed by the user (the emulator
   * screen mirror, for example), where "wider than 320px" is the feature.
   */
  ignore?: string[];
};

/**
 * Runs the four measurements in the page and returns every defect found.
 *
 * Only the live surface is measured: the swipe runway parks the adjacent pages in
 * `inert`, `aria-hidden` slots, and Radix marks the page behind an open dialog the same
 * way, so skipping `[inert]` and `[aria-hidden="true"]` subtrees measures exactly what
 * the user can currently see and reach.
 */
export const auditSmallScreenLayout = async (page: Page, options: LayoutAuditOptions = {}): Promise<LayoutDefect[]> =>
  page.evaluate((opts: LayoutAuditOptions) => {
    const TOL = 1.5;
    const ignoreSelectors = opts.ignore ?? [];
    const defects: Array<{ kind: string; selector: string; detail: string; text: string }> = [];

    const describe = (element: Element): string => {
      const steps: string[] = [];
      let node: Element | null = element;
      let hops = 0;
      while (node && node !== document.body && hops < 6) {
        const testId = node.getAttribute("data-testid");
        const tag = node.tagName.toLowerCase();
        if (testId) {
          steps.unshift(`${tag}[data-testid=${testId}]`);
          if (steps.length > 1) break;
        } else if (node === element) {
          const role = node.getAttribute("role");
          const cls =
            typeof node.className === "string" && node.className.trim()
              ? `.${node.className.trim().split(/\s+/).slice(0, 2).join(".")}`
              : "";
          steps.unshift(`${tag}${role ? `[role=${role}]` : ""}${cls}`);
        }
        node = node.parentElement;
        hops += 1;
      }
      return steps.join(" ") || element.tagName.toLowerCase();
    };

    const isIgnored = (element: Element) =>
      ignoreSelectors.some((selector) => {
        try {
          return element.closest(selector) !== null;
        } catch {
          return false;
        }
      });

    const isRendered = (element: Element): boolean => {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") return false;
      if (Number.parseFloat(style.opacity) < 0.1) return false;
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    /**
     * The visually-hidden pattern: a 1px box with its content clipped away, kept in the tree
     * only so a screen reader still reads it. Radix's own announcers (the toast live region,
     * for one) apply it with inline styles rather than this app's `.sr-only` class, and their
     * text is always "clipped" by construction, so measuring them reports a defect that no
     * user can see.
     */
    const isVisuallyHidden = (element: Element): boolean => {
      let node: Element | null = element;
      for (let hops = 0; node && hops < 6; hops += 1) {
        const style = window.getComputedStyle(node);
        const clipped = style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(50%)";
        if (clipped && style.position === "absolute") return true;
        node = node.parentElement;
      }
      return false;
    };

    /** True for anything the user cannot currently see or reach. */
    const isHiddenSurface = (element: Element): boolean => {
      if (element.closest("[inert]")) return true;
      if (element.closest('[aria-hidden="true"]')) return true;
      if (element.closest("[hidden]")) return true;
      // Screen-reader-only text is deliberately clipped to a 1px box.
      if (element.closest(".sr-only")) return true;
      if (isVisuallyHidden(element)) return true;
      return isIgnored(element);
    };

    const ownText = (element: Element): string =>
      Array.from(element.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

    type TextLeaf = { element: HTMLElement; text: string; rect: DOMRect };

    const leaves: TextLeaf[] = [];
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const text = ownText(element);
      if (!text) continue;
      if (isHiddenSurface(element)) continue;
      if (!isRendered(element)) continue;
      leaves.push({ element, text, rect: element.getBoundingClientRect() });
    }

    const record = (kind: string, element: Element, detail: string, text: string) => {
      defects.push({ kind, selector: describe(element), detail, text: text.slice(0, 60) });
    };

    /**
     * The rectangles a run of text is actually painted into.
     *
     * Range rectangles describe where the glyphs would be, not where they are drawn:
     * text that an ancestor clips away still reports its full geometry. Intersecting
     * with every clipping box on the way up gives what the user can see, which is what
     * "does this overlap that" and "is this off the screen" have to be answered from.
     */
    const paintedRects = (element: HTMLElement): DOMRect[] => {
      const measure = document.createRange();
      measure.selectNodeContents(element);
      let rects = Array.from(measure.getClientRects()).filter((r) => r.width > 0 && r.height > 2);

      let node: HTMLElement | null = element;
      while (node && node !== document.documentElement && rects.length > 0) {
        const style = window.getComputedStyle(node);
        const clipsX = style.overflowX !== "visible";
        const clipsY = style.overflowY !== "visible";
        if (clipsX || clipsY) {
          const box = node.getBoundingClientRect();
          rects = rects
            .map((rect) => {
              const left = clipsX ? Math.max(rect.left, box.left) : rect.left;
              const right = clipsX ? Math.min(rect.right, box.right) : rect.right;
              const top = clipsY ? Math.max(rect.top, box.top) : rect.top;
              const bottom = clipsY ? Math.min(rect.bottom, box.bottom) : rect.bottom;
              return new DOMRect(left, top, right - left, bottom - top);
            })
            .filter((rect) => rect.width > 0 && rect.height > 2);
        }
        node = node.parentElement;
      }
      return rects;
    };

    // ---------------------------------------------------------------------------
    // 1. Text that does not fit the box drawn for it.
    //
    // `scrollWidth > clientWidth` on an element that cannot scroll means the text is
    // either clipped away or spilling out. Elements that scroll, and elements that
    // truncate with an ellipsis, are doing that on purpose and are not reported.
    // ---------------------------------------------------------------------------
    for (const { element, text } of leaves) {
      const style = window.getComputedStyle(element);
      const scrollableX = style.overflowX === "auto" || style.overflowX === "scroll";
      const scrollableY = style.overflowY === "auto" || style.overflowY === "scroll";
      // `text-overflow: ellipsis` and `-webkit-line-clamp` both cut text off on purpose
      // and show that they have done so, which is a design decision rather than a
      // layout defect.
      const truncates =
        style.textOverflow === "ellipsis" ||
        (style.webkitLineClamp !== "none" && style.webkitLineClamp !== "" && style.webkitLineClamp !== undefined);

      if (!scrollableX && !truncates && element.scrollWidth - element.clientWidth > TOL) {
        record(
          "clipped",
          element,
          `text needs ${element.scrollWidth}px of width but the box is ${element.clientWidth}px`,
          text,
        );
      }
      // Vertical clipping only matters where the box actually cuts the text off.
      const clipsY = style.overflowY === "hidden" || style.overflowY === "clip";
      if (!scrollableY && !truncates && clipsY && element.scrollHeight - element.clientHeight > TOL) {
        record(
          "clipped",
          element,
          `text needs ${element.scrollHeight}px of height but the box is ${element.clientHeight}px and clips`,
          text,
        );
      }
    }

    // ---------------------------------------------------------------------------
    // 2. Text drawn outside the viewport, or outside the box that clips it.
    //
    // The viewport check catches the plain case. The clipping-ancestor check catches
    // the case a document-level measurement cannot see: a `position: fixed` bar sized
    // to the viewport does not extend `document.scrollWidth`, so its contents can run
    // off the right-hand edge with every document-level number still reading zero.
    // ---------------------------------------------------------------------------
    const clippingAncestor = (element: HTMLElement): HTMLElement | null => {
      let node = element.parentElement;
      while (node && node !== document.body) {
        const style = window.getComputedStyle(node);
        if (style.overflowX === "hidden" || style.overflowX === "clip") return node;
        node = node.parentElement;
      }
      return null;
    };

    /**
     * A container that scrolls horizontally puts its content past the viewport on purpose, and
     * the reader reaches it by scrolling. The tab bar is the case that matters here: at the
     * largest Text size its six labels are wider than 320px by design, and
     * `smallScreenLayoutIntegrity.spec.ts` asserts separately that they stay reachable.
     */
    const scrollsHorizontally = (element: HTMLElement): boolean => {
      let node: HTMLElement | null = element.parentElement;
      while (node && node !== document.body) {
        const overflowX = window.getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll") return true;
        node = node.parentElement;
      }
      return false;
    };

    for (const { element, text, rect } of leaves) {
      // Painted rectangles, so text an ancestor has already cut off is not reported a
      // second time here as being off the screen.
      const painted = paintedRects(element);
      const paintedRight = painted.length > 0 ? Math.max(...painted.map((r) => r.right)) : rect.right;
      const paintedLeft = painted.length > 0 ? Math.min(...painted.map((r) => r.left)) : rect.left;

      if (paintedRight > window.innerWidth + TOL && !scrollsHorizontally(element)) {
        record(
          "outside-viewport",
          element,
          `right edge at ${Math.round(paintedRight)}px is past the ${window.innerWidth}px viewport`,
          text,
        );
        continue;
      }
      // Same exemption as the right edge above: content inside a horizontal scroller is reachable
      // by scrolling, so it is not off the screen in the sense this check is about. The tab bar
      // scrolls the current page's tab into view, which pushes the first tabs past the left edge.
      if (paintedLeft < -TOL && !scrollsHorizontally(element)) {
        record("outside-viewport", element, `left edge at ${Math.round(paintedLeft)}px is left of the viewport`, text);
        continue;
      }
      const clipper = clippingAncestor(element);
      if (!clipper) continue;
      const clipRect = clipper.getBoundingClientRect();
      const clipStyle = window.getComputedStyle(clipper);
      const contentRight = clipRect.right - Number.parseFloat(clipStyle.borderRightWidth || "0");
      const contentLeft = clipRect.left + Number.parseFloat(clipStyle.borderLeftWidth || "0");
      // Scrolled containers move their content on purpose.
      if (clipper.scrollLeft !== 0) continue;
      if (rect.right > contentRight + TOL) {
        record(
          "outside-viewport",
          element,
          `right edge at ${Math.round(rect.right)}px is past ${describe(clipper)}, which clips at ${Math.round(contentRight)}px`,
          text,
        );
      } else if (rect.left < contentLeft - TOL) {
        record(
          "outside-viewport",
          element,
          `left edge at ${Math.round(rect.left)}px is left of ${describe(clipper)}, which clips at ${Math.round(contentLeft)}px`,
          text,
        );
      }
    }

    // ---------------------------------------------------------------------------
    // 3. Two pieces of text drawn on top of each other.
    //
    // Measured on the text runs rather than the element boxes, so padding and margins
    // that merely touch do not count. Each run is kept as its individual line
    // rectangles rather than as one box around them all: two `<strong>`s on different
    // lines of the same paragraph have union boxes that overlap while no glyph does,
    // and comparing the union boxes reports every such paragraph as a defect.
    //
    // A pair is only reported when both elements are in normal flow all the way up to
    // their common ancestor. A dialog over a page, a dropdown over a list and a toast
    // over a button are all deliberate layering, and every one of those goes through a
    // positioned or transformed element.
    // ---------------------------------------------------------------------------
    const unionRect = (rects: DOMRect[]): DOMRect => {
      const left = Math.min(...rects.map((r) => r.left));
      const right = Math.max(...rects.map((r) => r.right));
      const top = Math.min(...rects.map((r) => r.top));
      const bottom = Math.max(...rects.map((r) => r.bottom));
      return new DOMRect(left, top, right - left, bottom - top);
    };

    /** True when `element` is taken out of normal flow before reaching `stop`. */
    const isLayeredBelow = (element: HTMLElement, stop: Element): boolean => {
      let node: HTMLElement | null = element;
      while (node && node !== stop) {
        const style = window.getComputedStyle(node);
        if (style.position !== "static") return true;
        if (style.transform !== "none") return true;
        if (style.float !== "none") return true;
        node = node.parentElement;
      }
      return false;
    };

    const overlapCandidates = leaves
      .map((leaf) => ({ ...leaf, lines: paintedRects(leaf.element) }))
      .filter((leaf) => leaf.lines.length > 0)
      .map((leaf) => ({ ...leaf, box: unionRect(leaf.lines) }))
      .filter(({ element }) => window.getComputedStyle(element).pointerEvents !== "none")
      .sort((a, b) => a.box.top - b.box.top);

    for (let i = 0; i < overlapCandidates.length; i += 1) {
      const a = overlapCandidates[i];
      for (let j = i + 1; j < overlapCandidates.length; j += 1) {
        const b = overlapCandidates[j];
        if (b.box.top >= a.box.bottom - TOL) break; // sorted by top: nothing after this can overlap `a`
        if (a.element.contains(b.element) || b.element.contains(a.element)) continue;
        if (Math.min(a.box.right, b.box.right) - Math.max(a.box.left, b.box.left) <= TOL) continue;

        let worst: { width: number; height: number } | null = null;
        for (const lineA of a.lines) {
          for (const lineB of b.lines) {
            const width = Math.min(lineA.right, lineB.right) - Math.max(lineA.left, lineB.left);
            const height = Math.min(lineA.bottom, lineB.bottom) - Math.max(lineA.top, lineB.top);
            if (width <= TOL || height <= TOL) continue;
            if (!worst || width * height > worst.width * worst.height) worst = { width, height };
          }
        }
        if (!worst) continue;

        let ancestor: Element | null = a.element.parentElement;
        while (ancestor && !ancestor.contains(b.element)) ancestor = ancestor.parentElement;
        if (!ancestor) continue;
        if (isLayeredBelow(a.element, ancestor) || isLayeredBelow(b.element, ancestor)) continue;

        record(
          "overlap",
          a.element,
          `overlaps ${describe(b.element)} ("${b.text.slice(0, 30)}") by ${Math.round(worst.width)}x${Math.round(
            worst.height,
          )}px`,
          a.text,
        );
      }
    }

    // ---------------------------------------------------------------------------
    // 4. Words split across two lines in the middle of the word.
    //
    // Measured with Range rects rather than read out of the computed styles. Reading
    // `overflow-wrap` tells you a break is *permitted*, which is true of most of this
    // app and says nothing about whether one happened; measuring says whether one did.
    //
    // A break is reported when either of these holds:
    //   - the word would have fitted on a line of its own, so moving it down intact was
    //     available and splitting it was a choice; or
    //   - it is an ordinary short word (letters only, up to twelve of them), which
    //     should never be split whatever the width - "Size" set as "S/iz/e" down three
    //     lines means the column is too narrow, not that the word is too long.
    //
    // Two breaks are never reported, because both are correct typesetting: a break
    // after a hyphen or a slash, which is an ordinary break opportunity; and a break in
    // a long token such as a URL or a file path that is wider than the line it is on,
    // where there is nowhere else for it to go and breaking it beats letting it
    // overflow.
    // ---------------------------------------------------------------------------
    const HYPHEN_LIKE = new Set(["-", "‐", "‑", "‒", "–", "—", "/", "\\", "­"]);
    const range = document.createRange();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seenBreaks = new Set<string>();

    while (walker.nextNode()) {
      const node = walker.currentNode as Text;
      const parent = node.parentElement;
      if (!parent) continue;
      const value = node.nodeValue ?? "";
      if (!value.trim()) continue;
      if (isHiddenSurface(parent)) continue;
      if (!isRendered(parent)) continue;
      const tag = parent.tagName.toLowerCase();
      if (tag === "script" || tag === "style" || tag === "title") continue;

      // The width a line of this text has to play with. An inline element reports a
      // `clientWidth` of 0, so the measurement has to come from the nearest ancestor
      // that actually establishes the line box.
      let lineHost: HTMLElement = parent;
      while (
        lineHost !== document.body &&
        (window.getComputedStyle(lineHost).display === "inline" || lineHost.clientWidth === 0) &&
        lineHost.parentElement
      ) {
        lineHost = lineHost.parentElement;
      }
      const hostStyle = window.getComputedStyle(lineHost);
      const lineWidth =
        lineHost.clientWidth -
        Number.parseFloat(hostStyle.paddingLeft || "0") -
        Number.parseFloat(hostStyle.paddingRight || "0");

      for (const match of Array.from(value.matchAll(/\S+/g))) {
        const word = match[0];
        if (word.length < 2) continue;
        const start = match.index ?? 0;
        range.setStart(node, start);
        range.setEnd(node, start + word.length);
        const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0);
        if (rects.length < 2) continue;
        const tops = new Set(rects.map((r) => Math.round(r.top)));
        if (tops.size < 2) continue;

        // The unbroken width of the word is the total width of its pieces.
        const wordWidth = rects.reduce((sum, r) => sum + r.width, 0);
        if (lineWidth <= 0) continue;
        const fitsOnItsOwnLine = wordWidth <= lineWidth - 1;
        /*
         * Only an AVOIDABLE break is a defect.
         *
         * A word wider than the line it is on has three possible outcomes: break it, cut it off, or
         * let it run outside its box. This rule used to report the break for ordinary words, on the
         * grounds that a word that short should have been given room. That was written while those
         * strings were cut off instead, which the `clipped` check does not see when the cut is a
         * `truncate`. Now that they wrap, the rule was asking for the one outcome that is worse:
         * "SID addressing" renders its second word at 226 CSS px on a 320 px screen at the largest
         * text size, against a 126 px line, and no amount of room short of a smaller type size
         * makes it fit. A break is what a reader can still read.
         *
         * A word that WOULD fit on its own line is still reported: that break is the layout's
         * fault, not the word's — `break-all` on a path did exactly this, splitting "/USB0/" across
         * two lines inside a 240 px column.
         */
        if (!fitsOnItsOwnLine) continue;

        // Find the character the line broke before, so a break after a hyphen can be
        // told apart from a break in the middle of a run of letters.
        let breakIndex = -1;
        let previousTop: number | null = null;
        for (let index = 0; index < word.length; index += 1) {
          range.setStart(node, start + index);
          range.setEnd(node, start + index + 1);
          const charRects = Array.from(range.getClientRects()).filter((r) => r.width > 0 || r.height > 0);
          if (charRects.length === 0) continue;
          const top = Math.round(charRects[0].top);
          if (previousTop !== null && top !== previousTop) {
            breakIndex = index;
            break;
          }
          previousTop = top;
        }
        if (breakIndex <= 0) continue;
        if (HYPHEN_LIKE.has(word[breakIndex - 1])) continue;

        const key = `${describe(parent)}|${word}`;
        if (seenBreaks.has(key)) continue;
        seenBreaks.add(key);

        record(
          "mid-word-break",
          parent,
          `"${word}" is split after "${word.slice(0, breakIndex)}" although it is ${Math.round(
            wordWidth,
          )}px wide and the line is ${Math.round(lineWidth)}px`,
          value.trim(),
        );
      }
    }
    range.detach();

    return defects as Array<{ kind: LayoutDefectKind; selector: string; detail: string; text: string }>;
  }, options);

export const formatDefects = (where: string, defects: LayoutDefect[]): string =>
  `${defects.length} layout defect(s) on ${where}:\n` +
  defects
    .map((defect) => `  [${defect.kind}] ${defect.selector}\n      ${defect.detail}\n      text: "${defect.text}"`)
    .join("\n");
