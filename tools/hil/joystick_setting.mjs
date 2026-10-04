/* C64 Commander — GPL-3.0-or-later, Copyright (C) 2026 Christian Gleissner. */

// Serialized into the WebView by the input harness; all interaction stays on the visible control.
export async function revealJoystickSetting() {
  const query = (id) => document.querySelector(`[data-testid="${id}"]`);
  const section = document.querySelector('[data-section-scope="settings"][data-section-id="play-and-disk"]');
  if (!section) throw new Error("The Play and Disks chapter is not reachable in Settings");
  section.scrollIntoView({ block: "start" });
  if (section.dataset.open !== "true") query("settings-section-toggle-play-and-disk")?.click();
  const started = performance.now();
  while (performance.now() - started < 3000) {
    const trigger = query("settings-game-mode-joystick");
    if (trigger) {
      trigger.scrollIntoView({ block: "center" });
      return { was: localStorage.getItem("c64u_game_mode_controls_visibility"), label: trigger.innerText };
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error("The on-screen joystick control did not render after revealing its Settings chapter");
}
