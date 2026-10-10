/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RequirementContext } from "@/lib/search/requirements";

const stored = vi.hoisted(() => ({
  session: null as { currentItemId?: string; currentItemLabel?: string } | null,
  recent: [] as unknown[],
  hvscInstalled: false,
  contexts: new Map<boolean, RequirementContext>(),
}));

vi.mock("@/lib/playback/playbackSessionStore", () => ({
  readStoredPlaybackSession: () => stored.session,
}));
vi.mock("@/lib/sidRadio/recentlyPlayed", () => ({
  loadRecentlyPlayed: () => stored.recent,
}));
vi.mock("@/lib/hvsc/hvscStateStore", () => ({
  isHvscInstalled: () => stored.hvscInstalled,
}));
// Like the real hook, the context is memoised on live app state and takes its session reading when built,
// so it does not notice a session stored while the page was hidden.
vi.mock("@/hooks/useSearchResults", () => ({
  useRequirementContext: (hvscReady: boolean): RequirementContext => {
    const cached = stored.contexts.get(hvscReady);
    if (cached) return cached;
    const ctx: RequirementContext = {
      deviceConnected: true,
      capabilities: {} as RequirementContext["capabilities"],
      telnetAvailable: true,
      flagValue: () => true,
      variantId: "c64commander",
      hvscReady,
      hasRestorableSession: Boolean(stored.session?.currentItemId),
    };
    stored.contexts.set(hvscReady, ctx);
    return ctx;
  },
}));

import { ScreenActivityProvider } from "@/hooks/useScreenActivity";
import { useListenActions, type ListenAction } from "@/pages/home/components/useListenActions";

const renderTiles = (active: boolean) => {
  const result: { current: ListenAction[] } = { current: [] };
  const Tiles = () => {
    result.current = useListenActions();
    return null;
  };
  const slot = (slotActive: boolean) => (
    <MemoryRouter>
      <ScreenActivityProvider active={slotActive}>
        <Tiles />
      </ScreenActivityProvider>
    </MemoryRouter>
  );
  const view = render(slot(active));
  const tile = (entryId: string) => result.current.find((action) => action.id === `promoted.${entryId}`);
  return { tile, show: (next: boolean) => view.rerender(slot(next)) };
};

describe("useListenActions", () => {
  beforeEach(() => {
    stored.session = null;
    stored.recent = [];
    stored.hvscInstalled = false;
    stored.contexts.clear();
  });

  it("reads the last tune and the recent list again when Home is shown after another tab", () => {
    const { tile, show } = renderTiles(true);
    expect(tile("action.resume-session")?.disabled).toBe(true);
    expect(tile("action.recently-played")?.disabled).toBe(true);

    show(false);
    stored.session = { currentItemId: "item-1", currentItemLabel: "Chess.sid" };
    stored.recent = [{}, {}, {}];
    show(true);

    expect(tile("action.resume-session")?.disabled).toBe(false);
    expect(tile("action.resume-session")?.description).toBe("Chess");
    expect(tile("action.recently-played")?.disabled).toBe(false);
    expect(tile("action.recently-played")?.description).toBe("3");
  });

  it("does not re-read while Home is hidden", () => {
    const { tile, show } = renderTiles(true);

    show(false);
    stored.session = { currentItemId: "item-1", currentItemLabel: "Chess.sid" };
    stored.recent = [{}];
    show(false);

    expect(tile("action.resume-session")?.disabled).toBe(true);
    expect(tile("action.recently-played")?.disabled).toBe(true);
  });

  it("reads the stored state when mounted, even as a preview behind the page on screen", () => {
    stored.session = { currentItemId: "item-1", currentItemLabel: "Chess.sid" };
    stored.recent = [{}, {}];
    const { tile } = renderTiles(false);

    expect(tile("action.resume-session")?.description).toBe("Chess");
    expect(tile("action.recently-played")?.description).toBe("2");
  });
});
