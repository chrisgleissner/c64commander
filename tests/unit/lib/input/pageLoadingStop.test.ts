import { describe, expect, it } from "vitest";

import { holdsRingOnLoadingPage, PAGE_LOADING_STOP_ID } from "@/lib/input/pageLoadingStop";

describe("holdsRingOnLoadingPage", () => {
  it.each(["dpadUp", "dpadDown", "dpadLeft", "dpadRight"] as const)(
    "holds the ring on the loading placeholder for %s",
    (action) => {
      expect(holdsRingOnLoadingPage(PAGE_LOADING_STOP_ID, action)).toBe(true);
    },
  );

  it("lets Back and OK act on the loading placeholder", () => {
    expect(holdsRingOnLoadingPage(PAGE_LOADING_STOP_ID, "back")).toBe(false);
    expect(holdsRingOnLoadingPage(PAGE_LOADING_STOP_ID, "enter")).toBe(false);
  });

  it("does not hold the ring anywhere else or without a key action", () => {
    expect(holdsRingOnLoadingPage("tab-home", "dpadDown")).toBe(false);
    expect(holdsRingOnLoadingPage(null, "dpadDown")).toBe(false);
    expect(holdsRingOnLoadingPage(PAGE_LOADING_STOP_ID, null)).toBe(false);
  });
});
