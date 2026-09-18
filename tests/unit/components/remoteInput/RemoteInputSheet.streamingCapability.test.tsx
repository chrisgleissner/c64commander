/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { useState } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeviceInfo } from "@/lib/c64api";

/**
 * The device the sheet believes it is connected to. `core_version` is the runtime marker for an
 * integrated Ultimate 64-family computer, which is what `deriveDeviceCapabilities` reads; a
 * cartridge omits it, and that is the whole difference between these two cases.
 */
const connectedDevice = vi.hoisted(() => ({ info: null as DeviceInfo | null }));

const ULTIMATE_64: DeviceInfo = {
  product: "Ultimate 64 Elite",
  firmware_version: "3.15",
  core_version: "1.50",
} as DeviceInfo;

const CARTRIDGE: DeviceInfo = {
  product: "Ultimate II+L",
  firmware_version: "3.15",
} as DeviceInfo;

vi.mock("@/hooks/useConnectionState", () => ({
  useConnectionState: () => ({ deviceInfo: connectedDevice.info }),
}));

vi.mock("@/hooks/useRemoteInputCapabilityTier", () => ({
  useRemoteInputCapabilityTier: () => ({ tier: "full", loading: false, resolved: true }),
}));

vi.mock("@/hooks/useRemoteInputSession", () => ({
  useRemoteInputSession: () => {
    const [outputMode, setOutputMode] = useState<"joystick" | "type">("joystick");
    return {
      outputMode,
      setOutputMode,
      port: 2,
      setPort: vi.fn(),
      heldJoystickInputs: new Set<string>(),
      setHeldJoystickInputs: vi.fn(),
      heldKeyboardInputs: new Set<string>(),
      setHeldKeyboardInputs: vi.fn(),
      autofireEnabled: false,
      setAutofireEnabled: vi.fn(),
      autofireRateHz: 10,
      setAutofireRateHz: vi.fn(),
      connectionStatus: "idle",
      sendChar: vi.fn(),
      sendKeyboardInputs: vi.fn(),
      sendCursor: vi.fn(),
      sendSpecialKey: vi.fn(),
      releaseAll: vi.fn(),
      releaseAllEpoch: 0,
    };
  },
}));

import { RemoteInputSheet } from "@/components/remoteInput/RemoteInputSheet";

/*
 * An Ultimate II+L serves no `/v1/streams`. Remote Input offered Listen and Watch there anyway, and
 * Game Mode started both: each answered 404, which put "Could not tell the device to start
 * streaming audio." under the toggles in red and made the app report a healthy cartridge as
 * unhealthy with eight problems. Home had gated its own Live View card on the same capability for
 * some time; this sheet was the surface that had not.
 */
describe("RemoteInputSheet — the mirror controls follow the device's streaming capability", () => {
  beforeEach(() => {
    localStorage.clear();
    connectedDevice.info = null;
  });

  afterEach(cleanup);

  it("offers Listen and Watch on an integrated Ultimate 64-family computer", () => {
    connectedDevice.info = ULTIMATE_64;
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("remote-input-mirror-controls")).toBeInTheDocument();
    expect(screen.getByTestId("av-audio-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("av-video-toggle")).toBeInTheDocument();
  });

  it("offers neither on a cartridge, which serves no stream endpoints", () => {
    connectedDevice.info = CARTRIDGE;
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

    expect(screen.queryByTestId("remote-input-mirror-controls")).not.toBeInTheDocument();
    expect(screen.queryByTestId("av-audio-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("av-video-toggle")).not.toBeInTheDocument();
  });

  /*
   * The first probe has not answered yet on a cold start. Hiding the controls until it does would
   * make them appear a second or two into every session on a device that streams perfectly well.
   */
  it("offers them while the device is still unidentified", () => {
    connectedDevice.info = null;
    render(<RemoteInputSheet open onOpenChange={vi.fn()} />);

    expect(screen.getByTestId("remote-input-mirror-controls")).toBeInTheDocument();
  });
});
