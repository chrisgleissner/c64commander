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

  it("does not name the machine on the listen-target buttons", () => {
    // Amended deliberately. These three buttons now read Local / Remote / Both, a progression rather
    // than a device list: the header already says which machine is connected, so naming it here spent
    // the row's width on something already on screen — and "Remote" matches Remote Input. Which
    // machine is which is still told apart by name everywhere the choice is actually between machines.
    savedDevice.current = { name: "u64" };

    render(<PlaybackEngineToggle />);

    expect(screen.getByTestId("playback-engine-c64")).toHaveTextContent("Remote");
    expect(screen.getByTestId("playback-engine-c64")).not.toHaveTextContent("u64");
  });

  it("uses the same wording whether or not a device name is known", () => {
    render(<PlaybackEngineToggle />);

    expect(screen.getByTestId("playback-engine-c64")).toHaveTextContent("Remote");
    expect(screen.getByTestId("playback-engine-c64")).not.toHaveTextContent(SOURCE_LABELS.c64u);
  });

  it("calls this device Local, as the source picker and disks list do", () => {
    render(<PlaybackEngineToggle />);

    expect(screen.getByTestId("playback-engine-local")).toHaveTextContent(LOCAL_DEVICE_LABEL);
    expect(LOCAL_DEVICE_LABEL).toBe(SOURCE_LABELS.local);
  });

  it("draws no icon at all on the listen-target row", () => {
    // Amended deliberately, and narrowed rather than deleted. The row is now an equal-width grid so
    // it holds one line at 320 CSS px, and a third of that row cannot fit an icon beside its label —
    // "Remote" overflowed its column by 9.4px (docs/plans/segmented-control/PROPOSAL.md §3a). What
    // the original guard existed for still stands: no lucide stand-in may appear here for a device
    // that already has canonical artwork, so the row must carry no icon of either kind.
    render(<PlaybackEngineToggle />);

    const row = screen.getByTestId("playback-engine-toggle");
    expect(within(row).queryByTestId("file-origin-icon")).toBeNull();
    expect(row.querySelector("svg")).toBeNull();
    expect(row.querySelector("img")).toBeNull();
  });

  it("resolves the connected label the same way wherever it is asked", () => {
    expect(connectedDeviceLabel("  c64u  ")).toBe("c64u");
    expect(connectedDeviceLabel("")).toBe(SOURCE_LABELS.c64u);
    expect(connectedDeviceLabel(null)).toBe(SOURCE_LABELS.c64u);
    expect(connectedDeviceLabel()).toBe(SOURCE_LABELS.c64u);
  });
});
