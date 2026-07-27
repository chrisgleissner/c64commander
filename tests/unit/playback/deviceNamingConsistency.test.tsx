/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";

import { PlaybackEngineToggle } from "@/pages/playFiles/components/PlaybackEngineToggle";
import { LOCAL_DEVICE_LABEL, SOURCE_LABELS, connectedDeviceLabel } from "@/lib/sourceNavigation/sourceTerms";

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlag: (id: string) => ({ value: id === "live_view_enabled" || id === "audio_mirror_enabled" }),
}));

const mirror = {
  audioLive: false,
  session: { startAudio: vi.fn().mockResolvedValue(undefined), stopAudio: vi.fn().mockResolvedValue(undefined) },
};
vi.mock("@/hooks/useAvMirror", () => ({ useAvMirror: () => mirror }));

const savedDevice = vi.hoisted(() => ({ current: null as { name?: string } | null }));
vi.mock("@/lib/savedDevices/store", () => ({
  getSelectedSavedDevice: () => savedDevice.current,
}));

/**
 * One name and one icon per device, everywhere.
 *
 * The same machine used to appear as "C64" on the Play page, "C64 Ultimate" on
 * playlist rows and "C64U" in the disks list, drawn once as a lucide chip glyph
 * and once as the breadbin from the source picker. This device was "Local" in
 * one place and "This device" in another.
 */
describe("device naming and iconography", () => {
  beforeEach(() => {
    localStorage.clear();
    savedDevice.current = null;
  });
  afterEach(() => cleanup());

  it("names the connected machine after itself when it has a name", () => {
    // Two saved machines are told apart by their names, not by a generic word —
    // and "C64U" is wrong outright for a U64 Elite.
    savedDevice.current = { name: "u64" };

    render(<PlaybackEngineToggle />);

    expect(screen.getByTestId("playback-engine-c64")).toHaveTextContent("u64");
  });

  it("falls back to C64U when no device name is known", () => {
    render(<PlaybackEngineToggle />);

    expect(screen.getByTestId("playback-engine-c64")).toHaveTextContent(SOURCE_LABELS.c64u);
  });

  it("calls this device Local, as the source picker and disks list do", () => {
    render(<PlaybackEngineToggle />);

    expect(screen.getByTestId("playback-engine-local")).toHaveTextContent(LOCAL_DEVICE_LABEL);
    expect(LOCAL_DEVICE_LABEL).toBe(SOURCE_LABELS.local);
  });

  it("draws both devices with the shared source icons", () => {
    render(<PlaybackEngineToggle />);

    // FileOriginIcon renders the canonical artwork; a lucide glyph here would be
    // a second icon for a device that already has one.
    const c64Icon = within(screen.getByTestId("playback-engine-c64")).getByTestId("file-origin-icon");
    const localIcon = within(screen.getByTestId("playback-engine-local")).getByTestId("file-origin-icon");
    expect(c64Icon.querySelector("img")?.getAttribute("src")).toContain("c64u-icon.svg");
    expect(localIcon.querySelector("img")?.getAttribute("src")).toContain("device-icon.svg");
  });

  it("resolves the connected label the same way wherever it is asked", () => {
    expect(connectedDeviceLabel("  c64u  ")).toBe("c64u");
    expect(connectedDeviceLabel("")).toBe(SOURCE_LABELS.c64u);
    expect(connectedDeviceLabel(null)).toBe(SOURCE_LABELS.c64u);
    expect(connectedDeviceLabel()).toBe(SOURCE_LABELS.c64u);
  });
});
