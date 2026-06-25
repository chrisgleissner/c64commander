/*
 * C64 Commander - C64 Scope
 * Copyright (C) 2026 Christian Gleissner
 * SPDX-License-Identifier: GPL-3.0-or-later
 *
 * Pure UI-hierarchy utilities shared across all CTA gate runners.
 * No I/O, no device interaction — safe to import from any context.
 */

export interface Bounds {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function parseBounds(raw: string): Bounds | null {
  const m = raw.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
  if (!m) return null;
  return { x1: +m[1]!, y1: +m[2]!, x2: +m[3]!, y2: +m[4]! };
}

export function isVisible(b: Bounds): boolean {
  return b.x2 > b.x1 && b.y2 > b.y1;
}

export function centerX(b: Bounds): number {
  return Math.round((b.x1 + b.x2) / 2);
}

export function centerY(b: Bounds): number {
  return Math.round((b.y1 + b.y2) / 2);
}

// UIAutomator XML is a single line; split by "<node " to get per-node attribute strings.
export function nodeFragments(xml: string): string[] {
  return xml.split("<node ").map((frag) => {
    const end = frag.indexOf(">");
    return end >= 0 ? frag.slice(0, end) : frag;
  });
}

export function findVisibleBoundsByText(xml: string, text: string): Bounds | null {
  const encodedText = text.replace(/&/g, "&amp;");
  for (const frag of nodeFragments(xml)) {
    if (frag.includes(`text="${text}"`) || frag.includes(`text="${encodedText}"`)) {
      const m = frag.match(/bounds="(\[[^\]]*\]\[[^\]]*\])"/);
      if (m) {
        const b = parseBounds(m[1]!);
        if (b && isVisible(b)) return b;
      }
    }
  }
  return null;
}

// Returns the LAST (highest y1) visible match — used when multiple elements share the same
// text (e.g. Screen Orientation "Auto" vs Theme/Display-Profile "Auto" earlier on the page).
export function findLastVisibleBoundsByText(xml: string, text: string): Bounds | null {
  const encodedText = text.replace(/&/g, "&amp;");
  let last: Bounds | null = null;
  for (const frag of nodeFragments(xml)) {
    if (frag.includes(`text="${text}"`) || frag.includes(`text="${encodedText}"`)) {
      const m = frag.match(/bounds="(\[[^\]]*\]\[[^\]]*\])"/);
      if (m) {
        const b = parseBounds(m[1]!);
        if (b && isVisible(b) && (!last || b.y1 > last.y1)) last = b;
      }
    }
  }
  return last;
}

export function findVisibleBoundsByResourceId(xml: string, resourceId: string): Bounds | null {
  for (const frag of nodeFragments(xml)) {
    if (frag.includes(`resource-id="${resourceId}"`)) {
      const m = frag.match(/bounds="(\[[^\]]*\]\[[^\]]*\])"/);
      if (m) {
        const b = parseBounds(m[1]!);
        if (b && isVisible(b)) return b;
      }
    }
  }
  return null;
}

export function findVisibleBoundsByContentDesc(xml: string, contentDesc: string): Bounds | null {
  for (const frag of nodeFragments(xml)) {
    if (frag.includes(`content-desc="${contentDesc}"`)) {
      const m = frag.match(/bounds="(\[[^\]]*\]\[[^\]]*\])"/);
      if (m) {
        const b = parseBounds(m[1]!);
        if (b && isVisible(b)) return b;
      }
    }
  }
  return null;
}

export function findTextContaining(xml: string, substring: string): string | null {
  for (const frag of nodeFragments(xml)) {
    const m = frag.match(/text="([^"]*)"/);
    if (m && m[1]!.includes(substring)) return m[1]!;
  }
  return null;
}

export function findContentDescContaining(xml: string, substring: string): string | null {
  for (const frag of nodeFragments(xml)) {
    const m = frag.match(/content-desc="([^"]*)"/);
    if (m && m[1]!.includes(substring)) return m[1]!;
  }
  return null;
}

export function findTextByResourceId(xml: string, resourceId: string): string | null {
  for (const frag of nodeFragments(xml)) {
    if (frag.includes(`resource-id="${resourceId}"`)) {
      const m = frag.match(/text="([^"]*)"/);
      if (m) return m[1]!;
    }
  }
  return null;
}

// Returns screen {width, height} from the root node bounds in a hierarchy XML.
export function getScreenSize(xml: string): { width: number; height: number } {
  const m = xml.match(/bounds="\[0,0\]\[(\d+),(\d+)\]"/);
  if (!m) {
    throw new Error("Unable to determine screen size from UI hierarchy root bounds.");
  }
  return { width: +m[1]!, height: +m[2]! };
}
