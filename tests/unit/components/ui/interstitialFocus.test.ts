import { describe, expect, it, vi } from "vitest";

import { composeInterstitialOpenAutoFocus } from "@/components/ui/interstitialFocus";

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
