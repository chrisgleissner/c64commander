/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toastMock } = vi.hoisted(() => ({ toastMock: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ toast: toastMock }));

import { createRemoteFunctionHandlers, REMOTE_FUNCTION_ACTION_LABELS } from "@/lib/input/functionKeyShortcuts";
import { transportCommandBus, type TransportCommand } from "@/lib/input/latchedCommandBus";
import { subscribeQuickMenuOpen } from "@/lib/input/keypadCommands";
import { subscribeSearchOpen } from "@/lib/search/overlayState";
import { REMOTE_FUNCTION_ACTIONS } from "@/lib/config/appSettings";

describe("C64U Remote function-key handlers", () => {
  const launchGameMode = vi.fn();
  let path = "/";
  const build = (remoteInputEnabled = true) =>
    createRemoteFunctionHandlers({ remoteInputEnabled, launchGameMode, currentPath: () => path });

  beforeEach(() => {
    path = "/";
    toastMock.mockClear();
    launchGameMode.mockClear();
    transportCommandBus.reset();
  });
  afterEach(() => transportCommandBus.reset());

  it("delivers Play/Pause and Next tune to a mounted Play page without latching them for later", () => {
    const seen: TransportCommand[] = [];
    const release = transportCommandBus.subscribe((command) => {
      transportCommandBus.takePending();
      seen.push(command);
    });
    const handlers = build();

    handlers.playPause();
    handlers.nextTune();
    release();

    expect(seen).toEqual(["playPause", "next"]);
    expect(transportCommandBus.takePending()).toBeNull();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("stays put and explains, rather than latching a press, when the Play page is not mounted", () => {
    build().playPause();

    expect(transportCommandBus.takePending()).toBeNull();
    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Play/Pause is not available",
        description: "Playback is controlled from the Play page. Open Play, then press the key again.",
      }),
    );
  });

  it("latches on the Play route while its transport is still getting ready", () => {
    path = "/play";
    build().nextTune();

    expect(transportCommandBus.takePending()).toBe("next");
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("explains that Game Mode needs Remote Input instead of doing nothing", () => {
    build(false).gameMode();

    expect(launchGameMode).not.toHaveBeenCalled();
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: "Game Mode is not available" }));
  });

  it("launches Game Mode when Remote Input is on", () => {
    build(true).gameMode();

    expect(launchGameMode).toHaveBeenCalledOnce();
    expect(toastMock).not.toHaveBeenCalled();
  });

  it("opens search from the key and the Quick menu from the keypad", () => {
    const searchSources: string[] = [];
    const menuSources: string[] = [];
    const stopSearch = subscribeSearchOpen((request) => searchSources.push(request.source));
    const stopMenu = subscribeQuickMenuOpen((source) => menuSources.push(source));
    const handlers = build();

    handlers.search();
    handlers.quickMenu();
    stopSearch();
    stopMenu();

    expect(searchSources).toEqual(["key"]);
    expect(menuSources).toEqual(["keypad"]);
  });

  it("labels every offered action", () => {
    expect(REMOTE_FUNCTION_ACTIONS.map((action) => REMOTE_FUNCTION_ACTION_LABELS[action])).toEqual([
      "Unassigned",
      "Search",
      "Quick menu",
      "Game Mode",
      "Play/Pause",
      "Next tune",
    ]);
  });
});
