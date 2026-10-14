/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { act, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { MutableRefObject } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PLAYBACK_SESSION_KEY, SHARED_PLAYLIST_STORAGE_KEY } from "@/pages/playFiles/playFilesUtils";
import { BACKGROUND_ADVANCE_LOG_MESSAGES } from "@/pages/playFiles/backgroundAdvanceOutcome";

type Guard = { trackInstanceId: number; dueAtMs: number; autoFired: boolean; userCancelled: boolean };
type AutoSkipListener = (event: { dueAtMs: number }) => void;

const harness = vi.hoisted(() => ({
  listener: null as ((event: { dueAtMs: number }) => void) | null,
  guardRef: null as { current: unknown } | null,
  onAutoNext: (_guardRef: { current: unknown }) => {},
  autoNextCalls: [] as Array<number | undefined>,
  setDueAtMs: vi.fn(async (_options: { dueAtMs: number | null }) => {}),
  addLog: vi.fn(),
}));

vi.mock("@/lib/native/platform", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/native/platform")>()),
  isNativePlatform: () => true,
  getPlatform: () => "android",
}));

vi.mock("@/lib/native/backgroundExecution", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/native/backgroundExecution")>();
  const resolved = async () => {};
  return {
    ...actual,
    BackgroundExecution: {
      start: resolved,
      stop: resolved,
      setPlaybackState: resolved,
      setNowPlaying: resolved,
      setDueAtMs: harness.setDueAtMs,
      checkPermissions: async () => ({ notifications: "granted" }),
      requestPermissions: async () => ({ notifications: "granted" }),
      addListener: async () => ({ remove: resolved }),
    },
    onBackgroundAutoSkipDue: async (listener: AutoSkipListener) => {
      harness.listener = listener;
      return { remove: resolved };
    },
    onBackgroundTransportCommand: async () => ({ remove: resolved }),
  };
});

vi.mock("@/lib/logging", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logging")>();
  return {
    ...actual,
    addLog: (...args: Parameters<typeof actual.addLog>) => {
      harness.addLog(...args);
      return actual.addLog(...args);
    },
  };
});

vi.mock("@/hooks/useFeatureFlags", () => ({
  useFeatureFlags: () => ({ flags: {}, resolved: {}, isLoaded: true }),
  useFeatureFlag: () => ({ value: false, isLoaded: true }),
  useFeatureFlagValue: () => false,
}));

vi.mock("@/components/itemSelection/ItemSelectionDialog", () => ({
  ItemSelectionDialog: () => null,
}));

vi.mock("@/pages/playFiles/hooks/usePlaybackController", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/pages/playFiles/hooks/usePlaybackController")>();
  return {
    ...actual,
    usePlaybackController: (props: Parameters<typeof actual.usePlaybackController>[0]) => {
      harness.guardRef = props.autoAdvanceGuardRef as { current: unknown };
      return {
        ...actual.usePlaybackController(props),
        handleNext: async (_reason?: string, expectedTrackInstanceId?: number) => {
          harness.autoNextCalls.push(expectedTrackInstanceId);
          harness.onAutoNext(harness.guardRef!);
        },
      };
    },
  };
});

import PlayFilesPage from "@/pages/PlayFilesPage";

const tunes = [
  { path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid", name: "Commando.sid", durationMs: 236_000 },
  { path: "/MUSICIANS/H/Hubbard_Rob/Monty_on_the_Run.sid", name: "Monty_on_the_Run.sid", durationMs: 350_000 },
];

const seedPlayingSession = (autoAdvanceDueAtMs: number) => {
  localStorage.setItem(
    SHARED_PLAYLIST_STORAGE_KEY,
    JSON.stringify({
      items: tunes.map((tune) => ({ ...tune, source: "hvsc", sourceId: "hvsc-library", addedAt: "2026-01-01" })),
      currentIndex: 0,
    }),
  );
  sessionStorage.setItem(
    PLAYBACK_SESSION_KEY,
    JSON.stringify({
      playlistKey: SHARED_PLAYLIST_STORAGE_KEY,
      currentItemId: `hvsc:hvsc-library:${tunes[0].path}`,
      currentIndex: 0,
      isPlaying: true,
      isPaused: false,
      elapsedMs: 10_000,
      playedMs: 10_000,
      durationMs: tunes[0].durationMs,
      autoAdvanceDueAtMs,
      updatedAt: new Date().toISOString(),
    }),
  );
};

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/play"]}>
        <PlayFilesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const currentGuard = () => (harness.guardRef as MutableRefObject<Guard | null> | null)?.current ?? null;

const renderWithArmedGuard = async () => {
  seedPlayingSession(Date.now() + 200_000);
  renderPage();
  await waitFor(() => expect(harness.listener).not.toBeNull());
  await waitFor(() => expect(currentGuard()?.dueAtMs).toBeGreaterThan(Date.now()));
  const guard = currentGuard()!;
  return { dueAtMs: guard.dueAtMs, trackInstanceId: guard.trackInstanceId };
};

const fireDue = async (dueAtMs: number) => {
  harness.setDueAtMs.mockClear();
  harness.addLog.mockClear();
  await act(async () => {
    harness.listener!({ dueAtMs });
  });
};

const logCallFor = (message: string) => harness.addLog.mock.calls.find((call) => call[1] === message);

describe("PlayFilesPage background auto-skip outcome after the advance", () => {
  beforeEach(() => {
    harness.listener = null;
    harness.guardRef = null;
    harness.autoNextCalls = [];
    harness.onAutoNext = () => {};
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it("clears the native due time and warns when the advance left the same track armed", async () => {
    const { dueAtMs, trackInstanceId } = await renderWithArmedGuard();

    await fireDue(dueAtMs);

    await waitFor(() => expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES.stuck)).toBeDefined());
    expect(harness.autoNextCalls).toEqual([trackInstanceId]);
    expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES.stuck)?.[0]).toBe("warn");
    expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES.stuck)?.[2]).toMatchObject({
      expectedTrackInstanceId: trackInstanceId,
      dueAtMs,
      nextDueAtMs: dueAtMs,
    });
    await waitFor(() => expect(harness.setDueAtMs).toHaveBeenCalledWith({ dueAtMs: null }));
  });

  it("leaves the native due time alone when another advance already claimed the track end", async () => {
    harness.onAutoNext = (guardRef) => {
      (guardRef.current as Guard).autoFired = true;
    };
    const { dueAtMs, trackInstanceId } = await renderWithArmedGuard();

    await fireDue(dueAtMs);

    await waitFor(() => expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES["in-flight"])).toBeDefined());
    expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES["in-flight"])?.[0]).toBe("debug");
    expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES["in-flight"])?.[2]).toMatchObject({
      expectedTrackInstanceId: trackInstanceId,
      nextDueAtMs: dueAtMs,
    });
    expect(harness.setDueAtMs).not.toHaveBeenCalledWith({ dueAtMs: null });
  });

  it("clears the native due time at debug level when no guard remains after the advance", async () => {
    harness.onAutoNext = (guardRef) => {
      guardRef.current = null;
    };
    const { dueAtMs } = await renderWithArmedGuard();

    await fireDue(dueAtMs);

    await waitFor(() => expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES["no-guard"])).toBeDefined());
    expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES["no-guard"])?.[0]).toBe("debug");
    expect(logCallFor(BACKGROUND_ADVANCE_LOG_MESSAGES["no-guard"])?.[2]).toMatchObject({ nextDueAtMs: null });
    await waitFor(() => expect(harness.setDueAtMs).toHaveBeenCalledWith({ dueAtMs: null }));
  });

  it("re-arms the native due time with the next track's due time when the advance moved on", async () => {
    const nextDueAtMs = Date.now() + 500_000;
    harness.onAutoNext = (guardRef) => {
      const guard = guardRef.current as Guard;
      guardRef.current = { ...guard, trackInstanceId: guard.trackInstanceId + 1, dueAtMs: nextDueAtMs };
    };
    const { dueAtMs } = await renderWithArmedGuard();

    await fireDue(dueAtMs);

    await waitFor(() => expect(harness.setDueAtMs).toHaveBeenCalledWith({ dueAtMs: nextDueAtMs }));
    for (const message of Object.values(BACKGROUND_ADVANCE_LOG_MESSAGES)) {
      expect(logCallFor(message)).toBeUndefined();
    }
  });
});
