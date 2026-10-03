/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
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
