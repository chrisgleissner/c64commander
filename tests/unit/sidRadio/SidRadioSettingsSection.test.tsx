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

import { SidRadioSettingsSection } from "@/pages/settings/SidRadioSettingsSection";
import { loadLocalEngineEnabled, loadSidRadioEnabled } from "@/lib/config/appSettings";
import { clearAllRankings, getRanking, setRanking } from "@/lib/sidRadio/rankingStore";

beforeEach(async () => {
  localStorage.clear();
  await clearAllRankings();
});

describe("SidRadioSettingsSection", () => {
  it("renders the SID Radio group", () => {
    render(<SidRadioSettingsSection />);
    expect(screen.getByTestId("settings-sid-radio")).toBeInTheDocument();
    expect(screen.getByTestId("settings-sid-radio-enabled")).toBeInTheDocument();
    expect(screen.getByTestId("settings-clear-rankings")).toBeInTheDocument();
  });

  it("master flag is on by default (GA); toggling it off hides the ranking toggle", async () => {
    render(<SidRadioSettingsSection />);
    // GA default: master on, so the ranking sub-toggle is visible.
    expect(loadSidRadioEnabled()).toBe(true);
    expect(screen.getByTestId("settings-sid-ranking-enabled")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-sid-radio-enabled"));
    await waitFor(() => expect(loadSidRadioEnabled()).toBe(false));
    expect(screen.queryByTestId("settings-sid-ranking-enabled")).toBeNull();
  });

  it("toggling the on-device engine row persists the gate (Track B; on by default)", async () => {
    render(<SidRadioSettingsSection />);
    expect(loadLocalEngineEnabled()).toBe(true); // GA default
    fireEvent.click(screen.getByTestId("settings-local-engine-enabled"));
    await waitFor(() => expect(loadLocalEngineEnabled()).toBe(false));
  });

  it("shows the two-version status line (§6.4)", () => {
    render(<SidRadioSettingsSection />);
    const status = screen.getByTestId("settings-sid-radio-status");
    expect(status).toHaveTextContent("Similarity corpus");
    expect(status).toHaveTextContent("sidcorr-tiny-1");
    expect(status).toHaveTextContent("Installed HVSC");
  });

  it("Clear my rankings wipes every ranking", async () => {
    await setRanking("0123456789abcdef0123456789abcdef", "like");
    render(<SidRadioSettingsSection />);
    fireEvent.click(screen.getByTestId("settings-clear-rankings"));
    await waitFor(() => expect(getRanking("0123456789abcdef0123456789abcdef")).toBeNull());
    expect(screen.getByTestId("settings-clear-rankings")).toHaveTextContent("Cleared");
  });
});

describe("SidRadioSettingsSection — C64 ROMs", () => {
  it("offers to read the ROMs and says they are needed", () => {
    render(<SidRadioSettingsSection />);
    expect(screen.getByTestId("settings-local-engine-roms")).toBeInTheDocument();
    expect(screen.getByTestId("settings-roms-fetch")).toHaveTextContent("Read from C64");
    expect(screen.getByTestId("settings-roms-status")).toHaveTextContent("No ROMs stored");
  });

  it("states the authorisation obligation at the point of action", () => {
    // This wording is a product requirement, not decoration: reading ROM images
    // from a machine the user is not entitled to use is not sanctioned by this
    // feature, and the user has to be told so where they act.
    render(<SidRadioSettingsSection />);
    const row = screen.getByTestId("settings-local-engine-roms");
    expect(row).toHaveTextContent(/only connect .* to devices you own or have been given permission to use/i);
    expect(row).toHaveTextContent(/never shared, uploaded or included in diagnostics/i);
  });

  it("hides the ROM row when the on-device engine is switched off", async () => {
    render(<SidRadioSettingsSection />);
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
    return render(<SidRadioSettingsSection />);
  };

  it("disables every crossfade option while playback is routed to the C64", async () => {
    const { getByTestId, getByText } = await renderWith("c64");
    for (const ms of [0, 600, 1500, 3000]) {
      expect(getByTestId(`settings-crossfade-${ms}`)).toBeDisabled();
    }
    expect(getByText(/single sound chip/i)).toBeInTheDocument();
  });

  it("enables them when playback is on this device", async () => {
    const { getByTestId } = await renderWith("local");
    for (const ms of [0, 600, 1500, 3000]) {
      expect(getByTestId(`settings-crossfade-${ms}`)).not.toBeDisabled();
    }
  });
});
