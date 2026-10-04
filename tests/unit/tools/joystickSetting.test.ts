/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */
// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revealJoystickSetting } from "../../../tools/hil/joystick_setting.mjs";

describe("input HIL Settings preparation", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "performance"] });
    localStorage.clear();
    document.body.innerHTML = `<section data-section-scope="settings" data-section-id="play-and-disk" data-open="true">
      <button data-testid="settings-section-toggle-play-and-disk">Play and Disks</button></section>`;
    vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });
  const addTrigger = () => {
    const trigger = document.createElement("button");
    trigger.dataset.testid = "settings-game-mode-joystick";
    trigger.innerText = "Auto";
    document.querySelector("section")!.append(trigger);
  };

  it("reveals an open offscreen chapter without collapsing it when its body is still deferred", async () => {
    const toggle = document.querySelector("button")!;
    toggle.onclick = () => document.querySelector("section")!.setAttribute("data-open", "false");
    const click = vi.spyOn(toggle, "click");
    setTimeout(addTrigger, 100);
    const result = revealJoystickSetting();
    await vi.advanceTimersByTimeAsync(2050);
    expect(await result).toEqual({ was: null, label: "Auto" });
    expect(click).not.toHaveBeenCalled();
    expect(document.querySelector("section")).toHaveAttribute("data-open", "true");
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("opens a closed chapter through its toggle before selecting the joystick control", async () => {
    document.querySelector("section")!.setAttribute("data-open", "false");
    localStorage.setItem("c64u_game_mode_controls_visibility", "hidden");
    document.querySelector("button")!.onclick = () => {
      document.querySelector("section")!.setAttribute("data-open", "true");
      addTrigger();
    };
    expect(await revealJoystickSetting()).toEqual({ was: "hidden", label: "Auto" });
  });

  it("reports the missing chapter and times out with context if a revealed body never renders", async () => {
    const failure = expect(revealJoystickSetting()).rejects.toThrow("did not render after revealing");
    await vi.advanceTimersByTimeAsync(3050);
    await failure;
    document.body.replaceChildren();
    await expect(revealJoystickSetting()).rejects.toThrow("Play and Disks chapter is not reachable");
  });
});
