/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNativePlatform: vi.fn(() => true),
  getPlatform: vi.fn(() => "android"),
  onBackgroundTransportCommand: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: mocks.isNativePlatform,
  getPlatform: mocks.getPlatform,
}));
vi.mock("@/lib/native/backgroundExecution", () => ({
  onBackgroundTransportCommand: mocks.onBackgroundTransportCommand,
}));
vi.mock("@/lib/logging", () => ({ addLog: mocks.addLog }));

import { installNativeMediaButtons } from "@/lib/input/nativeMediaButtons";
import { transportCommandBus, type TransportCommand } from "@/lib/input/latchedCommandBus";

const remove = vi.fn(async () => undefined);

/** Hand back the listener the installer registered, so the test drives the production wiring. */
const installAndCaptureListener = async (navigate: (path: string) => void, currentPath: () => string) => {
  let listener: ((command: TransportCommand) => void) | null = null;
  mocks.onBackgroundTransportCommand.mockImplementation(async (fn: (command: TransportCommand) => void) => {
    listener = fn;
    return { remove };
  });
  const cleanup = installNativeMediaButtons({ navigate, currentPath });
  await vi.waitFor(() => expect(listener).not.toBeNull());
  return { cleanup, invoke: (command: TransportCommand) => listener?.(command) };
};

describe("native media buttons", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transportCommandBus.reset();
    mocks.isNativePlatform.mockReturnValue(true);
    mocks.getPlatform.mockReturnValue("android");
  });

  it("does not subscribe off native Android", () => {
    mocks.getPlatform.mockReturnValue("ios");
    installNativeMediaButtons({ navigate: vi.fn(), currentPath: () => "/play" });
    expect(mocks.onBackgroundTransportCommand).not.toHaveBeenCalled();
  });

  it("publishes each relayed press on the transport bus a mounted Play page listens to", async () => {
    const received: TransportCommand[] = [];
    const unsubscribe = transportCommandBus.subscribe((command) => received.push(command));
    const { cleanup, invoke } = await installAndCaptureListener(vi.fn(), () => "/play");

    invoke("playPause");
    invoke("stop");
    invoke("play");

    expect(received).toEqual(["playPause", "stop", "play"]);
    unsubscribe();
    cleanup();
  });

  it("navigates to the transport when the press arrives on another page, and latches the command", async () => {
    const navigate = vi.fn();
    const { cleanup, invoke } = await installAndCaptureListener(navigate, () => "/settings");

    invoke("playPause");

    expect(navigate).toHaveBeenCalledWith("/play");
    expect(transportCommandBus.takePending()).toBe("playPause");
    cleanup();
  });

  it("removes the listener on cleanup", async () => {
    const { cleanup } = await installAndCaptureListener(vi.fn(), () => "/play");
    cleanup();
    await vi.waitFor(() => expect(remove).toHaveBeenCalled());
  });
});
