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
  takeLaunchCommand: vi.fn(async (): Promise<{ command: TransportCommand | null }> => ({ command: null })),
  addLog: vi.fn(),
}));

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: mocks.isNativePlatform,
  getPlatform: mocks.getPlatform,
}));
vi.mock("@/lib/native/backgroundExecution", () => ({
  BackgroundExecution: { takeLaunchCommand: mocks.takeLaunchCommand },
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
    mocks.takeLaunchCommand.mockResolvedValue({ command: null });
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

  it("QW-LS-01: publishes a relayed previous press on the transport bus", async () => {
    const received: TransportCommand[] = [];
    const unsubscribe = transportCommandBus.subscribe((command) => received.push(command));
    const { cleanup, invoke } = await installAndCaptureListener(vi.fn(), () => "/play");

    invoke("previous");

    expect(received).toEqual(["previous"]);
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

  describe("resume request the activity was launched with (issue 504)", () => {
    it("publishes the launch command on the transport bus and navigates to Play", async () => {
      mocks.takeLaunchCommand.mockResolvedValueOnce({ command: "play" });
      const navigate = vi.fn();
      const { cleanup } = await installAndCaptureListener(navigate, () => "/");

      await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/play"));
      expect(transportCommandBus.takePending()).toBe("play");
      cleanup();
    });

    it("is acted on once when the app installs the handler again, as native hands the request over only once", async () => {
      mocks.takeLaunchCommand.mockResolvedValueOnce({ command: "play" }).mockResolvedValue({ command: null });
      const navigate = vi.fn();
      const first = await installAndCaptureListener(navigate, () => "/");
      await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
      expect(transportCommandBus.takePending()).toBe("play");

      const second = await installAndCaptureListener(navigate, () => "/");
      await vi.waitFor(() => expect(mocks.takeLaunchCommand).toHaveBeenCalledTimes(2));

      expect(navigate).toHaveBeenCalledTimes(1);
      expect(transportCommandBus.takePending()).toBeNull();
      first.cleanup();
      second.cleanup();
    });

    it("does nothing when the activity was not launched with a request", async () => {
      const navigate = vi.fn();
      const { cleanup } = await installAndCaptureListener(navigate, () => "/");

      await vi.waitFor(() => expect(mocks.takeLaunchCommand).toHaveBeenCalledTimes(1));
      expect(navigate).not.toHaveBeenCalled();
      expect(transportCommandBus.takePending()).toBeNull();
      cleanup();
    });

    it("acts on a request taken by an install that was cleaned up before it arrived", async () => {
      let deliver: (value: { command: TransportCommand | null }) => void = () => undefined;
      mocks.takeLaunchCommand.mockReturnValueOnce(new Promise((resolve) => (deliver = resolve)));
      const navigate = vi.fn();
      const { cleanup } = await installAndCaptureListener(navigate, () => "/");
      cleanup();

      deliver({ command: "play" });

      await vi.waitFor(() => expect(transportCommandBus.takePending()).toBe("play"));
    });

    it("logs and carries on when native cannot hand the request over", async () => {
      mocks.takeLaunchCommand.mockRejectedValueOnce(new Error("bridge gone"));
      const { cleanup } = await installAndCaptureListener(vi.fn(), () => "/");

      await vi.waitFor(() =>
        expect(mocks.addLog).toHaveBeenCalledWith(
          "warn",
          "Failed to read the launch resume request",
          expect.objectContaining({ error: "bridge gone" }),
        ),
      );
      cleanup();
    });
  });
});
