import { describe, expect, it, vi } from "vitest";

import { OPEN_FOCUS_ATTR, composeInterstitialOpenAutoFocus } from "@/components/ui/interstitialFocus";

const createEvent = () => {
  const event = {
    currentTarget: null as EventTarget | null,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true;
    },
  };

  return event as Event & { currentTarget: EventTarget | null };
};

describe("composeInterstitialOpenAutoFocus", () => {
  it("prevents default autofocus and focuses the interstitial surface", () => {
    const focus = vi.fn();
    const surface = document.createElement("div");
    surface.focus = focus;
    const event = createEvent();
    event.currentTarget = surface;

    composeInterstitialOpenAutoFocus()(event);

    expect(event.defaultPrevented).toBe(true);
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("focuses the control the dialog marks to open on instead of the surface", () => {
    const surface = document.createElement("div");
    const surfaceFocus = vi.fn();
    surface.focus = surfaceFocus;
    const cancel = document.createElement("button");
    cancel.setAttribute(OPEN_FOCUS_ATTR, "");
    const cancelFocus = vi.fn();
    cancel.focus = cancelFocus;
    surface.append(document.createElement("button"), cancel);
    const event = createEvent();
    event.currentTarget = surface;

    composeInterstitialOpenAutoFocus()(event);

    expect(event.defaultPrevented).toBe(true);
    expect(cancelFocus).toHaveBeenCalledWith({ preventScroll: true });
    expect(surfaceFocus).not.toHaveBeenCalled();
  });

  it("stops when an upstream handler already prevented autofocus", () => {
    const focus = vi.fn();
    const surface = document.createElement("div");
    surface.focus = focus;
    const event = createEvent();
    event.currentTarget = surface;
    const upstream = vi.fn((receivedEvent: typeof event) => {
      receivedEvent.preventDefault();
    });

    composeInterstitialOpenAutoFocus(upstream)(event);

    expect(upstream).toHaveBeenCalledWith(event);
    expect(focus).not.toHaveBeenCalled();
  });

  it("tolerates non-element current targets after preventing autofocus", () => {
    const event = createEvent();
    const upstream = vi.fn();

    composeInterstitialOpenAutoFocus(upstream)(event);

    expect(upstream).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(true);
  });
});
