import { describe, expect, it } from "vitest";
import {
  reduceSliderPopupState,
  resolveSliderPopupCloseDelayMs,
  SLIDER_POPUP_IDLE_CLOSE_MS,
  SLIDER_POPUP_MIN_VISIBLE_MS,
  type SliderPopupState,
} from "@/lib/ui/sliderPopupStateMachine";

describe("sliderPopupStateMachine", () => {
  it("transitions through active, idle, closing, hidden", () => {
    let state: SliderPopupState = "Hidden";
    state = reduceSliderPopupState(state, "interaction-start");
    expect(state).toBe("VisibleActive");
    state = reduceSliderPopupState(state, "interaction-end");
    expect(state).toBe("VisibleIdle");
    state = reduceSliderPopupState(state, "idle-timeout");
    expect(state).toBe("Closing");
    state = reduceSliderPopupState(state, "force-hide");
    expect(state).toBe("Hidden");
  });

  it("re-activates VisibleActive when interaction-start or interaction-update received in VisibleActive", () => {
    expect(reduceSliderPopupState("VisibleActive", "interaction-update")).toBe("VisibleActive");
  });

  it("computes close delay bounded by both idle and minimum visible windows", () => {
    const openedAt = 1_000;
    const lastInteractionAt = 1_200;
    const now = 1_250;
    const delay = resolveSliderPopupCloseDelayMs(openedAt, lastInteractionAt, now);
    expect(delay).toBe(
      Math.max(openedAt + SLIDER_POPUP_MIN_VISIBLE_MS - now, lastInteractionAt + SLIDER_POPUP_IDLE_CLOSE_MS - now),
    );
  });

  it("VisibleActive transitions to Closing on idle-timeout (BRDA:26)", () => {
    expect(reduceSliderPopupState("VisibleActive", "idle-timeout")).toBe("Closing");
  });

  it("VisibleIdle re-activates on interaction-start short-circuit (BRDA:33)", () => {
    expect(reduceSliderPopupState("VisibleIdle", "interaction-start")).toBe("VisibleActive");
  });

  it("VisibleIdle stays in VisibleIdle on interaction-end (BRDA:34)", () => {
    expect(reduceSliderPopupState("VisibleIdle", "interaction-end")).toBe("VisibleIdle");
  });

  it("VisibleIdle returns unchanged state for unrecognized event (BRDA:36)", () => {
    expect(reduceSliderPopupState("VisibleIdle", "unknown-event" as any)).toBe("VisibleIdle");
  });

  it("covers all Closing state transitions", () => {
    expect(reduceSliderPopupState("Closing", "interaction-start")).toBe("VisibleActive");
    expect(reduceSliderPopupState("Closing", "interaction-update")).toBe("VisibleActive");
    expect(reduceSliderPopupState("Closing", "interaction-end")).toBe("VisibleIdle");
    expect(reduceSliderPopupState("Closing", "idle-timeout")).toBe("Closing");
    expect(reduceSliderPopupState("Closing", "unknown-event" as any)).toBe("Closing");
  });

  it("keeps Hidden state for non-interaction events", () => {
    expect(reduceSliderPopupState("Hidden", "interaction-end")).toBe("Hidden");
    expect(reduceSliderPopupState("Hidden", "idle-timeout")).toBe("Hidden");
  });

  it("VisibleActive + idle-timeout transitions to Closing (line 24 TRUE branch)", () => {
    // b17 L24: the TRUE arm of `if (event === "idle-timeout") return "Closing"` in VisibleActive
    expect(reduceSliderPopupState("VisibleActive", "idle-timeout")).toBe("Closing");
  });

  it("unknown state returns itself unchanged (line 42 fallthrough, b37)", () => {
    // Reaches the final `return state` after none of the state branches match
    expect(reduceSliderPopupState("Bogus" as Parameters<typeof reduceSliderPopupState>[0], "idle-timeout")).toBe(
      "Bogus",
    );
  });

  it("returns zero close delay when target is already in the past", () => {
    const delay = resolveSliderPopupCloseDelayMs(1_000, 1_100, 10_000);
    expect(delay).toBe(0);
  });

  it("honors custom close delay thresholds", () => {
    const delay = resolveSliderPopupCloseDelayMs(100, 120, 200, 300, 500);
    expect(delay).toBe(420);
  });

  it("stays in VisibleIdle when interaction-end fires while already idle", () => {
    expect(reduceSliderPopupState("VisibleIdle", "interaction-end")).toBe("VisibleIdle");
  });

  it("stays in VisibleActive when an unrecognized event fires in VisibleActive", () => {
    expect(reduceSliderPopupState("VisibleActive", "unknown-event" as never)).toBe("VisibleActive");
  });
});
