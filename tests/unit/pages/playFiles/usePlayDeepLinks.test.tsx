/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { LATCHED_COMMAND_TTL_MS, transportCommandBus, type TransportCommand } from "@/lib/input/latchedCommandBus";
import {
  usePlayDeepLinks,
  useTransportCommands,
  type PlayDeepLinkHandlers,
} from "@/pages/playFiles/hooks/usePlayDeepLinks";

const noopHandlers = (): PlayDeepLinkHandlers => ({
  openRadioLauncher: vi.fn(),
  openRecentlyPlayed: vi.fn(),
  openFindATune: vi.fn(),
  openLikedTunes: vi.fn(),
  resumeSession: vi.fn(),
});

const DeepLinkProbe = ({ handlers }: { handlers: PlayDeepLinkHandlers }) => {
  usePlayDeepLinks(handlers);
  const location = useLocation();
  return <span data-testid="search">{location.search}</span>;
};

const renderAt = (path: string, handlers: PlayDeepLinkHandlers) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/play" element={<DeepLinkProbe handlers={handlers} />} />
      </Routes>
    </MemoryRouter>,
  );

describe("usePlayDeepLinks", () => {
  it.each([
    ["radio", "openRadioLauncher"],
    ["recent", "openRecentlyPlayed"],
    ["find", "openFindATune"],
    ["liked", "openLikedTunes"],
    ["resume", "resumeSession"],
  ] as const)("runs %s once", async (param, handlerName) => {
    const handlers = noopHandlers();
    renderAt(`/play?${param}=1`, handlers);
    await waitFor(() => expect(handlers[handlerName]).toHaveBeenCalledTimes(1));
  });

  it("strips the parameter, so a back-navigation does not reopen what was dismissed", async () => {
    const handlers = noopHandlers();
    renderAt("/play?radio=1", handlers);
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
  });

  it("keeps a parameter it does not own", async () => {
    const handlers = noopHandlers();
    renderAt("/play?radio=1&keep=me", handlers);
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe("?keep=me"));
  });

  it("does nothing at all with no parameters", async () => {
    const handlers = noopHandlers();
    renderAt("/play", handlers);
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe(""));
    expect(handlers.openRadioLauncher).not.toHaveBeenCalled();
  });

  it("ignores a parameter whose value is not 1", async () => {
    const handlers = noopHandlers();
    renderAt("/play?radio=0", handlers);
    await waitFor(() => expect(screen.getByTestId("search").textContent).toBe("?radio=0"));
    expect(handlers.openRadioLauncher).not.toHaveBeenCalled();
  });
});

const TransportProbe = ({ onCommand }: { onCommand: (command: TransportCommand) => void }) => {
  useTransportCommands(onCommand);
  return null;
};

describe("useTransportCommands", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    transportCommandBus.reset();
  });

  afterEach(() => {
    vi.useRealTimers();
    transportCommandBus.reset();
  });

  /*
   * The point of the latch. F1 is pressed on Home, the transport lives on Play, and the app then
   * navigates: a plain dispatch would be gone before Play subscribed.
   */
  it("delivers a command published while Play was NOT mounted", () => {
    transportCommandBus.publish("next");
    const onCommand = vi.fn();
    render(<TransportProbe onCommand={onCommand} />);
    expect(onCommand).toHaveBeenCalledWith("next");
  });

  it("delivers a command published while Play IS mounted, in place", () => {
    const onCommand = vi.fn();
    render(<TransportProbe onCommand={onCommand} />);
    transportCommandBus.publish("playPause");
    expect(onCommand).toHaveBeenCalledWith("playPause");
  });

  it("delivers a command exactly once, however it arrived", () => {
    const onCommand = vi.fn();
    render(<TransportProbe onCommand={onCommand} />);
    transportCommandBus.publish("playPause");
    expect(onCommand).toHaveBeenCalledTimes(1);
  });

  it("discards a command older than five seconds rather than firing it on an unrelated navigation", () => {
    transportCommandBus.publish("next");
    vi.advanceTimersByTime(LATCHED_COMMAND_TTL_MS + 1);
    const onCommand = vi.fn();
    render(<TransportProbe onCommand={onCommand} />);
    expect(onCommand).not.toHaveBeenCalled();
  });

  it("stops listening once Play unmounts", () => {
    const onCommand = vi.fn();
    const { unmount } = render(<TransportProbe onCommand={onCommand} />);
    unmount();
    transportCommandBus.publish("next");
    expect(onCommand).not.toHaveBeenCalled();
  });
});
