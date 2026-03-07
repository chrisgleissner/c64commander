export type SliderPopupState = "Hidden" | "VisibleActive" | "VisibleIdle" | "Closing";

export type SliderPopupEvent =
  | "interaction-start"
  | "interaction-update"
  | "interaction-end"
  | "idle-timeout"
  | "force-hide";

export const SLIDER_POPUP_MIN_VISIBLE_MS = 500;
export const SLIDER_POPUP_IDLE_CLOSE_MS = 800;

export const reduceSliderPopupState = (state: SliderPopupState, event: SliderPopupEvent): SliderPopupState => {
  if (event === "force-hide") return "Hidden";

  if (state === "Hidden") {
    if (event === "interaction-start" || event === "interaction-update") return "VisibleActive";
    return state;
  }

  if (state === "VisibleActive") {
    if (event === "interaction-start" || event === "interaction-update") return "VisibleActive";
    if (event === "interaction-end") return "VisibleIdle";
    if (event === "idle-timeout") return "Closing";
    return state;
  }

  if (state === "VisibleIdle") {
    if (event === "interaction-start" || event === "interaction-update") return "VisibleActive";
    if (event === "interaction-end") return "VisibleIdle";
    if (event === "idle-timeout") return "Closing";
    return state;
  }

  if (state === "Closing") {
    if (event === "interaction-start" || event === "interaction-update") return "VisibleActive";
    if (event === "interaction-end") return "VisibleIdle";
    if (event === "idle-timeout") return "Closing";
    return state;
  }

  return state;
};

export const resolveSliderPopupCloseDelayMs = (
  openedAtMs: number,
  lastInteractionAtMs: number,
  nowMs: number,
  minVisibleMs: number = SLIDER_POPUP_MIN_VISIBLE_MS,
  idleCloseMs: number = SLIDER_POPUP_IDLE_CLOSE_MS,
) => {
  const minVisibleTarget = openedAtMs + minVisibleMs;
  const idleTarget = lastInteractionAtMs + idleCloseMs;
  const target = Math.max(minVisibleTarget, idleTarget);
  return Math.max(0, target - nowMs);
};
