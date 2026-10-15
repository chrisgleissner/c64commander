/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

const { startGameMode } = vi.hoisted(() => ({
  startGameMode: vi.fn(async () => ({ startedVideo: false, startedAudio: false })),
}));
vi.mock("@/lib/remoteInput/gameModeLaunch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/remoteInput/gameModeLaunch")>()),
  startGameMode,
}));
vi.mock("@/hooks/useFeatureFlags", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useFeatureFlagValue: () => true,
}));
const connectionRef = vi.hoisted(() => ({
  current: { state: "REAL_CONNECTED", deviceInfo: null as Record<string, string> | null },
}));
vi.mock("@/hooks/useConnectionState", () => ({ useConnectionState: () => connectionRef.current }));
vi.mock("@/hooks/useSavedDevices", () => ({ useSavedDevices: () => ({ devices: [{ id: "a" }] }) }));

import { KeypadQuickMenu } from "@/components/input/KeypadQuickMenu";
import { requestQuickMenuOpen } from "@/lib/input/keypadCommands";

const CurrentPath = () => <span data-testid="current-path">{useLocation().pathname}</span>;

const renderMenuAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <KeypadQuickMenu />
      <Routes>
        <Route path="*" element={<CurrentPath />} />
      </Routes>
    </MemoryRouter>,
  );

describe("KeypadQuickMenu Game Mode", () => {
  beforeEach(() => {
    connectionRef.current = { state: "REAL_CONNECTED", deviceInfo: null };
  });

  it("offers no Game Mode on a U2, matching the Home tile", async () => {
    connectionRef.current = {
      state: "REAL_CONNECTED",
      deviceInfo: { product: "Ultimate-II+L", firmware_version: "3.14", hostname: "u2" },
    };
    renderMenuAt("/");
    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu-machine-reset")).toBeInTheDocument());

    expect(screen.queryByTestId("keypad-quick-menu-game-mode")).toBeNull();
  });

  it("offers Game Mode on a C64U", async () => {
    connectionRef.current = {
      state: "REAL_CONNECTED",
      deviceInfo: { product: "C64 Ultimate", firmware_version: "1.1.0", core_version: "1.45", hostname: "c64u" },
    };
    renderMenuAt("/");
    requestQuickMenuOpen();

    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu-game-mode")).toBeInTheDocument());
  });

  it("goes to Home before starting Game Mode from a page that does not host the Remote Input sheet", async () => {
    renderMenuAt("/config");
    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu-game-mode")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("keypad-quick-menu-game-mode"));

    expect(startGameMode).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByTestId("current-path")).toHaveTextContent(/^\/$/));
  });

  it("stays on Play, which hosts the Remote Input sheet itself", async () => {
    renderMenuAt("/play");
    requestQuickMenuOpen();
    await waitFor(() => expect(screen.getByTestId("keypad-quick-menu-game-mode")).toBeInTheDocument());

    fireEvent.click(screen.getByTestId("keypad-quick-menu-game-mode"));

    await waitFor(() => expect(startGameMode).toHaveBeenCalled());
    expect(screen.getByTestId("current-path")).toHaveTextContent("/play");
  });
});
