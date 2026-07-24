/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { SidRadioSettingsSection } from "@/pages/settings/SidRadioSettingsSection";
import { loadSidRadioEnabled, loadSidRankingEnabled } from "@/lib/config/appSettings";
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

  it("toggling the master flag persists it and reveals the ranking toggle", async () => {
    render(<SidRadioSettingsSection />);
    expect(screen.queryByTestId("settings-sid-ranking-enabled")).toBeNull();
    fireEvent.click(screen.getByTestId("settings-sid-radio-enabled"));
    await waitFor(() => expect(loadSidRadioEnabled()).toBe(true));
    expect(screen.getByTestId("settings-sid-ranking-enabled")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("settings-sid-ranking-enabled"));
    await waitFor(() => expect(loadSidRankingEnabled()).toBe(true));
  });

  it("Clear my rankings wipes every ranking", async () => {
    await setRanking("0123456789abcdef0123456789abcdef", "like");
    render(<SidRadioSettingsSection />);
    fireEvent.click(screen.getByTestId("settings-clear-rankings"));
    await waitFor(() => expect(getRanking("0123456789abcdef0123456789abcdef")).toBeNull());
    expect(screen.getByTestId("settings-clear-rankings")).toHaveTextContent("Cleared");
  });
});
