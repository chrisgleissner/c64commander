/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The section shows the C64 ROM row for on-device playback, which needs to know
// which device is connected. useC64Connection is react-query backed; this suite
// is about the SID Radio group, not connection state, so stub it rather than
// wrapping every case in a QueryClientProvider.
vi.mock("@/hooks/useC64Connection", () => ({
  useC64Connection: () => ({ deviceHost: "c64u.local" }),
}));

// The chapter body animates open. jsdom runs no animations, so the real components would keep
// the entry style (height 0, opacity 0) forever and every control inside would read as hidden.
// Same mock the other Settings suites use.
vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: any) => <div {...props}>{children}</div>,
    span: ({ children, ...props }: any) => <span {...props}>{children}</span>,
    section: ({ children, ...props }: any) => <section {...props}>{children}</section>,
  },
  AnimatePresence: ({ children }: any) => <>{children}</>,
}));

import { SidRadioSettingsSection } from "@/pages/settings/SidRadioSettingsSection";
import {
  loadLocalEngineEnabled,
  loadLocalSidModel,
  loadLocalSidModelFromDevice,
  loadSidRadioEnabled,
  saveLearnedDeviceSidModel,
  saveLocalSidModelFromDevice,
} from "@/lib/config/appSettings";
import { clearAllRankings, getRanking, setRanking } from "@/lib/sidRadio/rankingStore";

beforeEach(async () => {
  localStorage.clear();
  // SID Radio is one of Settings' collapsible chapters and its controls are not rendered while
  // it is closed. This suite is about those controls, not about the collapse (which has its own
  // coverage), so it starts from the state of a user who has opened the chapter.
  localStorage.setItem("c64u_settings_open_sections", JSON.stringify(["sid-radio"]));
  await clearAllRankings();
});

describe("SidRadioSettingsSection", () => {
  it("renders the SID Radio group", () => {
    render(<SidRadioSettingsSection developerMode />);
    expect(screen.getByTestId("settings-sid-radio")).toBeInTheDocument();
    expect(screen.getByTestId("settings-sid-radio-enabled")).toBeInTheDocument();
    expect(screen.getByTestId("settings-clear-rankings")).toBeInTheDocument();
  });

  it("master flag is on by default (GA); toggling it off hides the ranking toggle", async () => {
    render(<SidRadioSettingsSection developerMode />);
    // GA default: master on, so the ranking sub-toggle is visible.
    expect(loadSidRadioEnabled()).toBe(true);
    expect(screen.getByTestId("settings-sid-ranking-enabled")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-sid-radio-enabled"));
    await waitFor(() => expect(loadSidRadioEnabled()).toBe(false));
    expect(screen.queryByTestId("settings-sid-ranking-enabled")).toBeNull();
  });

  it("toggling the on-device engine row persists the gate (Track B; on by default)", async () => {
    render(<SidRadioSettingsSection developerMode />);
    expect(loadLocalEngineEnabled()).toBe(true); // GA default
    fireEvent.click(screen.getByTestId("settings-local-engine-enabled"));
    await waitFor(() => expect(loadLocalEngineEnabled()).toBe(false));
  });

  it("shows the two-version status line (§6.4)", () => {
    render(<SidRadioSettingsSection developerMode />);
    const status = screen.getByTestId("settings-sid-radio-status");
    expect(status).toHaveTextContent("Similarity corpus");
    expect(status).toHaveTextContent("sidcorr-tiny-1");
    expect(status).toHaveTextContent("Installed HVSC");
  });

  it("Clear my rankings wipes every ranking", async () => {
    await setRanking("0123456789abcdef0123456789abcdef", "like");
    render(<SidRadioSettingsSection developerMode />);
    fireEvent.click(screen.getByTestId("settings-clear-rankings"));
    await waitFor(() => expect(getRanking("0123456789abcdef0123456789abcdef")).toBeNull());
    expect(screen.getByTestId("settings-clear-rankings")).toHaveTextContent("Cleared");
  });
});

describe("SidRadioSettingsSection — C64 ROMs", () => {
  it("offers to read the ROMs and says they are needed", () => {
    render(<SidRadioSettingsSection developerMode />);
    expect(screen.getByTestId("settings-local-engine-roms")).toBeInTheDocument();
    expect(screen.getByTestId("settings-roms-fetch")).toHaveTextContent("Read from C64");
    expect(screen.getByTestId("settings-roms-status")).toHaveTextContent("No ROMs stored");
  });

  it("states the authorisation obligation at the point of action", () => {
    // This wording is a product requirement, not decoration: reading ROM images
    // from a machine the user is not entitled to use is not sanctioned by this
    // feature, and the user has to be told so where they act.
    render(<SidRadioSettingsSection developerMode />);
    const row = screen.getByTestId("settings-local-engine-roms");
    expect(row).toHaveTextContent(/only connect .* to devices you own or have been given permission to use/i);
    expect(row).toHaveTextContent(/never shared, uploaded or included in diagnostics/i);
  });

  it("hides the ROM row when the on-device engine is switched off", async () => {
    render(<SidRadioSettingsSection developerMode />);
    fireEvent.click(screen.getByTestId("settings-local-engine-enabled"));
    await waitFor(() => expect(screen.queryByTestId("settings-local-engine-roms")).toBeNull());
  });
});

/**
 * Crossfading needs two tunes sounding at the same moment. The C64 has one SID
 * and renders live, so on that engine a crossfade is not unimplemented — it
 * cannot exist. The control says so instead of accepting a value that would
 * silently do nothing.
 */
describe("SidRadioSettingsSection crossfade availability", () => {
  const renderWith = async (engine: "c64" | "local") => {
    localStorage.setItem("c64u_local_engine_enabled", "1");
    localStorage.setItem("c64u_playback_engine", engine);
    const { SidRadioSettingsSection } = await import("@/pages/settings/SidRadioSettingsSection");
    const { render } = await import("@testing-library/react");
    return render(<SidRadioSettingsSection developerMode />);
  };

  it("disables every crossfade option while playback is routed to the C64", async () => {
    const { getByTestId, getByText } = await renderWith("c64");
    for (const ms of [0, 600, 1500, 3000]) {
      expect(getByTestId(`settings-crossfade-${ms}`)).toBeDisabled();
    }
    expect(getByText(/one sound chip/i)).toBeInTheDocument();
  });

  it("enables them when playback is on this device", async () => {
    const { getByTestId } = await renderWith("local");
    for (const ms of [0, 600, 1500, 3000]) {
      expect(getByTestId(`settings-crossfade-${ms}`)).not.toBeDisabled();
    }
  });

  it("offers the shortest-tune setting without developer mode", () => {
    // SID Radio reached GA, so what a station will even offer has to be reachable by the people using
    // it. Only the engine internals below it stay behind the developer flag.
    render(<SidRadioSettingsSection />);

    expect(screen.getByTestId("settings-sid-radio-min-seconds-input")).toBeVisible();
    expect(screen.getByTestId("settings-sid-radio-min-seconds-input")).toHaveValue("15");
  });

  it("keeps the engine internals out of the way unless developer mode is on", () => {
    render(<SidRadioSettingsSection />);

    expect(screen.queryByTestId("settings-local-engine-enabled")).toBeNull();
    expect(screen.queryByTestId("settings-sid-radio-status")).toBeNull();
    // Undoing your own rankings is not a developer concern.
    expect(screen.getByTestId("settings-clear-rankings")).toBeVisible();
  });
});

/**
 * Which chip a tune that names none is played on. The two controls are a switch that takes the
 * answer from the connected Ultimate and a manual choice for when there is no answer to take.
 */
describe("SidRadioSettingsSection SID chip", () => {
  it("offers both controls without developer mode, because on-device playback is GA", () => {
    render(<SidRadioSettingsSection />);
    expect(screen.getByTestId("settings-sid-chip")).toBeVisible();
    expect(screen.getByTestId("settings-sid-chip-from-device")).toBeVisible();
    expect(screen.getByTestId("settings-sid-chip-6581")).toBeVisible();
    expect(screen.getByTestId("settings-sid-chip-8580")).toBeVisible();
  });

  it("says plainly that a tune naming its own chip is unaffected", () => {
    // Without this the control reads as "play everything on 6581", and a listener who set it that
    // way would reasonably think the app was ignoring them.
    render(<SidRadioSettingsSection />);
    const block = screen.getByTestId("settings-sid-chip");
    expect(block).toHaveTextContent(/name their chip and always play on it/i);
  });

  it("takes the chip from the connected machine by default and says which one is in use", async () => {
    saveLearnedDeviceSidModel("6581");
    render(<SidRadioSettingsSection />);
    expect(screen.getByTestId("settings-sid-chip-from-device")).toBeChecked();
    expect(screen.getByTestId("settings-sid-chip-effective")).toHaveTextContent(/play on the 6581/i);
    expect(screen.getByTestId("settings-sid-chip")).toHaveTextContent(/Last read: 6581/);
  });

  it("falls back to the manual choice once the machine is no longer consulted", async () => {
    saveLearnedDeviceSidModel("6581");
    render(<SidRadioSettingsSection />);
    fireEvent.click(screen.getByTestId("settings-sid-chip-from-device"));
    await waitFor(() => expect(loadLocalSidModelFromDevice()).toBe(false));
    expect(screen.getByTestId("settings-sid-chip-effective")).toHaveTextContent(/play on the 8580/i);
  });

  it("persists the manual choice and reflects it once inference is off", async () => {
    saveLocalSidModelFromDevice(false);
    render(<SidRadioSettingsSection />);
    fireEvent.click(screen.getByTestId("settings-sid-chip-6581"));
    await waitFor(() => expect(loadLocalSidModel()).toBe("6581"));
    expect(screen.getByTestId("settings-sid-chip-effective")).toHaveTextContent(/play on the 6581/i);
  });

  it("says nothing has been read yet when no machine has answered", () => {
    render(<SidRadioSettingsSection />);
    expect(screen.getByTestId("settings-sid-chip")).toHaveTextContent(/Nothing read yet/i);
  });

  it("hides the whole block when on-device playback is switched off", async () => {
    render(<SidRadioSettingsSection developerMode />);
    fireEvent.click(screen.getByTestId("settings-local-engine-enabled"));
    await waitFor(() => expect(screen.queryByTestId("settings-sid-chip")).toBeNull());
  });
});
