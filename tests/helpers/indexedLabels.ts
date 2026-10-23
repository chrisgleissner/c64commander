/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/**
 * jsdom computes `element.labels` by walking the whole document for every labelable element, so one
 * `getByRole` or `getByLabelText` call on a page with many labels costs seconds under coverage. Testing Library
 * reads `labels` for every candidate element. This replacement finds the same labels with one attribute lookup
 * per element: labels whose `for` names the element, plus the wrapping label when it has no `for` and the element
 * is its first labelable descendant (HTML Standard, "labeled control").
 */

const LABELABLE_SELECTOR = "button, input:not([type=hidden]), meter, output, progress, select, textarea";

const LABELABLE_PROTOTYPES = [
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLMeterElement",
  "HTMLOutputElement",
  "HTMLProgressElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
] as const;

const quoteAttributeValue = (value: string) => `"${value.replace(/["\\]/g, "\\$&")}"`;

export const findLabelsOf = (element: Element): HTMLLabelElement[] => {
  const labels: HTMLLabelElement[] = [];
  const { id } = element;
  if (id) {
    const document = element.ownerDocument;
    document.querySelectorAll<HTMLLabelElement>(`label[for=${quoteAttributeValue(id)}]`).forEach((label) => {
      if (document.getElementById(id) === element) labels.push(label);
    });
  }
  const wrapping = element.closest<HTMLLabelElement>("label");
  if (wrapping && !wrapping.hasAttribute("for") && wrapping.querySelector(LABELABLE_SELECTOR) === element) {
    labels.push(wrapping);
  }
  return labels.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
};

export const installIndexedLabels = (): (() => void) => {
  const restores = LABELABLE_PROTOTYPES.map((name) => {
    const prototype = (window as unknown as Record<string, { prototype: object }>)[name].prototype;
    const original = Object.getOwnPropertyDescriptor(prototype, "labels");
    if (!original) {
      throw new Error(`jsdom ${name}.prototype has no labels property to replace`);
    }
    Object.defineProperty(prototype, "labels", {
      configurable: true,
      get(this: Element) {
        return findLabelsOf(this);
      },
    });
    return () => Object.defineProperty(prototype, "labels", original);
  });
  return () => restores.forEach((restore) => restore());
};
