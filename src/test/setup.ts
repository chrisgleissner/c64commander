import "@testing-library/jest-dom";

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// Radix UI (Select) relies on pointer capture APIs that are missing in JSDOM.
if (!Element.prototype.hasPointerCapture) {
  // eslint-disable-next-line no-extend-native
  Element.prototype.hasPointerCapture = () => false;
}
if (!Element.prototype.setPointerCapture) {
  // eslint-disable-next-line no-extend-native
  Element.prototype.setPointerCapture = () => {};
}
if (!Element.prototype.releasePointerCapture) {
  // eslint-disable-next-line no-extend-native
  Element.prototype.releasePointerCapture = () => {};
}

// Minimal PointerEvent polyfill for libraries expecting it.
if (typeof (window as any).PointerEvent === "undefined") {
  class PointerEvent extends MouseEvent {}
  (window as any).PointerEvent = PointerEvent;
}

// Used by Radix Select to bring the active item into view.
if (!Element.prototype.scrollIntoView) {
  // eslint-disable-next-line no-extend-native
  Element.prototype.scrollIntoView = () => {};
}
