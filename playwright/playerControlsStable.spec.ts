/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Page, type Locator } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { installAudioFxMock } from "./audioFxMock";
import { createSidBase64WithMetadata } from "./sidFixture";
import { LARGEST_TEXT_SCALE_ID } from "../src/lib/textScale";
import { PLAYBACK_SESSION_KEY, SHARED_PLAYLIST_STORAGE_KEY } from "../src/pages/playFiles/playFilesUtils";

/**
 * The player controls must not move on screen while anything else on the Play page changes.
 *
 * A requestAnimationFrame sampler records the exact bounding box of the transport buttons, the
 * progress bar and the time labels on every frame, from before an interaction until 500 ms after
 * the page has settled. Every sample must equal the first one exactly: no tolerance, because a
 * single pixel of movement is the defect.
 */

const MONITORED = [
  "playlist-prev",
  "playlist-play",
  "playlist-pause",
  "playlist-next",
  "playback-progress",
  "playback-elapsed",
  "playback-remaining",
] as const;

const SETTLE_AFTER_MS = 500;
const METADATA_DELAY_MS = 300;

type Tune = {
  file: string;
  title: string;
  author: string;
  released: string;
  songCount: number;
  stil?: { credits?: { title: string; artist: string }[]; comment?: string; subsongs?: Record<number, unknown> };
  fails?: boolean;
};

const LONG_COMMENT = Array.from(
  { length: 6 },
  (_, index) =>
    `Comment ${index + 1}: this tune was reworked several times over the years, and the notes by the archive editors run to many lines on a narrow screen so that the folded block is much taller than a single line.`,
).join(" ");

const TUNES: Tune[] = [
  { file: "Plain.sid", title: "Plain", author: "Plain Composer", released: "1985 Plain Publisher", songCount: 1 },
  {
    file: "Stil_Long.sid",
    title: "Stil Long",
    author: "Rob Hubbard",
    released: "1985 Hubbard",
    songCount: 5,
    stil: {
      credits: [{ title: "The Devil's Gallop [from the radio show]", artist: "Charles Williams" }],
      comment: LONG_COMMENT,
    },
  },
  { file: "Many_Tunes.sid", title: "Many Tunes", author: "Martin Galway", released: "1986 Ocean", songCount: 19 },
  {
    file: "A_Very_Long_File_Name_That_Will_Not_Fit_On_One_Line_Of_A_Small_Screen_At_All.sid",
    title: "Long Name",
    author: "Jeroen Tel & Charles Deenen of Maniacs",
    released: "1990 A Publisher With A Rather Long Name Ltd",
    songCount: 3,
  },
  { file: "No_Credits.sid", title: "No Credits", author: "", released: "", songCount: 1 },
  { file: "Broken.sid", title: "Broken", author: "Nobody", released: "1999", songCount: 1, fails: true },
  {
    file: "Stil_Note_Only.sid",
    title: "Note Only",
    author: "Ben Daglish",
    released: "1987 Gremlin",
    songCount: 2,
    stil: { comment: "A short note." },
  },
];

const virtualPath = (tune: Tune) => `/MUSICIANS/T/Test/${tune.file}`;

const seed = async (
  page: Page,
  options: { textScale: string; profile: keyof typeof DISPLAY_PROFILE_VIEWPORTS; station?: boolean },
) => {
  const stil: Record<string, unknown> = {};
  for (const tune of TUNES) {
    if (tune.stil) {
      stil[virtualPath(tune)] = {
        subsongs: { 1: { credits: tune.stil.credits, comment: tune.stil.comment } },
      };
    }
  }
  const songs = TUNES.map((tune, index) => ({
    id: index + 1,
    virtualPath: virtualPath(tune),
    fileName: tune.file,
    durationSeconds: 120 + index * 7,
    fails: Boolean(tune.fails),
    dataBase64: createSidBase64WithMetadata({
      name: tune.title,
      author: tune.author,
      released: tune.released,
      songCount: tune.songCount,
      startSong: 1,
      clock: "pal",
      sidModel: "6581",
    }),
  }));
  await page.addInitScript(
    ({ stilEntries, hvscSongs, textScale, override, delay, playlistKey, sessionKey, paths, station }) => {
      localStorage.setItem("c64u_display_profile_override", override);
      localStorage.setItem("c64u_text_scale", textScale);
      localStorage.setItem("c64u_sid_radio_enabled", "1");
      localStorage.setItem("c64u_sid_ranking_enabled", "1");
      localStorage.setItem("c64u_last_device_id", "TEST-123");
      if (station) {
        localStorage.setItem(
          "c64u_sid_radio_session",
          JSON.stringify({
            seedKind: "style",
            seedLabel: "Chill / Ambient",
            seed: { kind: "style", styleBit: 0 },
            styleFilter: 0,
            shuffleSeed: 777,
            rankingSnapshotId: "snap",
            excludeOrdinals: [],
          }),
        );
      }
      const w = window as unknown as Record<string, unknown>;
      // STIL arrives late, as it does when the shard has to be read.
      const stilMock = new Proxy(stilEntries as Record<string, unknown>, {});
      w.__stilMock__ = stilMock;
      w.__playerStableDelayMs = delay;
      const state = { installedVersion: 84, ingestionState: "ready" };
      const status = () => ({
        installedBaselineVersion: 84,
        installedVersion: state.installedVersion,
        ingestionState: state.ingestionState,
        lastUpdateCheckUtcMs: Date.now(),
        ingestionError: null,
        ingestionSummary: {
          totalSongs: hvscSongs.length,
          ingestedSongs: hvscSongs.length,
          failedSongs: 0,
          songlengthSyntaxErrors: 0,
        },
      });
      const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
      w.__hvscMock__ = {
        addListener: () => ({ remove: async () => {} }),
        getHvscStatus: async () => status(),
        getHvscCacheStatus: async () => ({ baselineVersion: null, updateVersions: [] }),
        checkForHvscUpdates: async () => ({
          latestVersion: 84,
          installedVersion: 84,
          baselineVersion: null,
          requiredUpdates: [],
        }),
        ingestCachedHvsc: async () => status(),
        getHvscFolderListing: async ({ path }: { path: string }) => ({
          path,
          folders: [],
          songs: path === "/MUSICIANS/T/Test" ? hvscSongs : [],
        }),
        getHvscSong: async ({ id, virtualPath: requested }: { id?: number; virtualPath?: string } = {}) => {
          await wait(delay as number);
          const match = (hvscSongs as Array<Record<string, unknown>>).find(
            (song) => song.id === id || song.virtualPath === requested,
          );
          if (!match) throw new Error("Song not found");
          if (match.fails) throw new Error("This tune cannot be loaded");
          return match;
        },
        getHvscDurationByMd5: async () => ({ durationSeconds: 143 }),
      };
      const items = (paths as string[]).map((path) => ({
        source: "hvsc",
        path,
        name: path.split("/").pop(),
        durationMs: 120_000,
        songNr: 1,
      }));
      const payload = JSON.stringify({ items, currentIndex: 0 });
      localStorage.setItem(playlistKey, payload);
      localStorage.setItem("c64u_playlist:v1:default", payload);
      sessionStorage.setItem(
        sessionKey,
        JSON.stringify({
          playlistKey,
          currentItemId: null,
          currentItemLabel: items[0].name,
          currentIndex: 0,
          isPlaying: false,
          isPaused: false,
          elapsedMs: 0,
          playedMs: 0,
          durationMs: 120_000,
          autoAdvanceDueAtMs: null,
          shuffleEnabled: false,
          repeatEnabled: false,
          randomSeed: 1,
          updatedAt: new Date().toISOString(),
        }),
      );
    },
    {
      stilEntries: stil,
      hvscSongs: songs,
      textScale: options.textScale,
      override: DISPLAY_PROFILE_VIEWPORTS[options.profile].override,
      delay: METADATA_DELAY_MS,
      playlistKey: SHARED_PLAYLIST_STORAGE_KEY,
      sessionKey: PLAYBACK_SESSION_KEY,
      paths: TUNES.map(virtualPath),
      station: options.station ?? false,
    },
  );
};

type Box = { x: number; y: number; width: number; height: number };
type Frame = Record<string, Box | null>;

const installSampler = async (page: Page) => {
  await page.evaluate(
    (ids) => {
      const w = window as unknown as {
        __frames?: Record<string, Box | null>[];
        __sampling?: boolean;
      };
      w.__frames = [];
      w.__sampling = false;
      const read = () => {
        const frame: Record<string, Box | null> = {};
        const root = document.querySelector('[data-slot-active="true"]') ?? document;
        for (const id of ids) {
          const element = root.querySelector(`[data-testid="${id}"]`);
          if (!element) {
            frame[id] = null;
            continue;
          }
          const rect = element.getBoundingClientRect();
          frame[id] = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        }
        return frame;
      };
      const tick = () => {
        if (w.__sampling) w.__frames!.push(read());
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    },
    MONITORED as unknown as string[],
  );
};

const startSampling = (page: Page) =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: unknown[]; __sampling: boolean };
    w.__frames = [];
    w.__sampling = true;
  });

const stopSampling = (page: Page): Promise<Frame[]> =>
  page.evaluate(() => {
    const w = window as unknown as { __frames: Record<string, Box | null>[]; __sampling: boolean };
    w.__sampling = false;
    return w.__frames;
  });

type Movement = { id: string; frame: number; dx: number; dy: number; dw: number; dh: number };

const firstMovements = (reference: Frame, frames: Frame[]): Movement[] => {
  const moved = new Map<string, Movement>();
  frames.forEach((frame, index) => {
    for (const id of [...MONITORED, "scrollTop"]) {
      const a = reference[id];
      const b = frame[id];
      if (!a || !b) continue;
      if (a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height) continue;
      const previous = moved.get(id);
      const movement = {
        id,
        frame: index,
        dx: b.x - a.x,
        dy: b.y - a.y,
        dw: b.width - a.width,
        dh: b.height - a.height,
      };
      if (!previous || Math.abs(movement.dy) + Math.abs(movement.dx) > Math.abs(previous.dy) + Math.abs(previous.dx)) {
        moved.set(id, movement);
      }
    }
  });
  return [...moved.values()];
};

const activeSlot = (page: Page) => page.locator('[data-slot-active="true"]').first();

/**
 * Runs `action` while sampling and returns the largest movement of every monitored element
 * relative to `reference`.
 */
const watch = async (page: Page, reference: Frame, action: () => Promise<void>): Promise<Movement[]> => {
  await startSampling(page);
  await action();
  await page.waitForTimeout(SETTLE_AFTER_MS);
  const frames = await stopSampling(page);
  expect(frames.length, "the sampler recorded frames").toBeGreaterThan(5);
  return firstMovements(reference, frames);
};

const currentFrame = async (page: Page): Promise<Frame> => {
  await startSampling(page);
  await page.waitForTimeout(100);
  const frames = await stopSampling(page);
  return frames[frames.length - 1];
};

/**
 * Clicks `target` the way a person does: the page is first scrolled until the target is in view
 * (that scroll is the person's own movement, not the page's), then the controls are measured again
 * and watched through the click itself.
 */
const clickWatched = async (page: Page, target: Locator): Promise<Movement[]> => {
  await target.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const reference = await currentFrame(page);
  const r = await watch(page, reference, () => target.click());
  return r;
};

const expectUnmoved = (where: string, movements: Movement[]) => {
  expect(
    movements.map((m) => `${m.id}: dx=${m.dx} dy=${m.dy} dw=${m.dw} dh=${m.dh} (frame ${m.frame})`),
    `${where}: the player controls moved`,
  ).toEqual([]);
};

const titleOf = async (page: Page) =>
  (await activeSlot(page).getByTestId("playback-current-title").textContent()) ?? "";

const dismissToasts = async (page: Page) => {
  for (const close of await page.getByTestId("app-toast-close").all()) await close.click().catch(() => undefined);
};

const documentPositionOfPlay = (page: Page) =>
  page.evaluate(() => {
    const play = document.querySelector('[data-slot-active="true"] [data-testid="playlist-play"]');
    const scroller = play?.closest("main");
    if (!play || !scroller) return Number.NaN;
    return play.getBoundingClientRect().top + scroller.scrollTop - scroller.getBoundingClientRect().top;
  });

const clickAndExpectUnmoved = async (page: Page, name: string, locator: Locator) => {
  await expect(locator.first(), `${name}: the control exists`).toBeVisible();
  expectUnmoved(name, await clickWatched(page, locator.first()));
  await dismissToasts(page);
};

const profiles = [
  { profile: "compact", textScale: "default" },
  { profile: "compact", textScale: LARGEST_TEXT_SCALE_ID },
  { profile: "medium", textScale: "default" },
  { profile: "medium", textScale: LARGEST_TEXT_SCALE_ID },
] as const;

test.describe("Player controls stay put", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page: _page }, testInfo) => {
    disableTraceAssertions(testInfo, "Layout-only coverage; trace assertions disabled.");
    server = await createMockC64Server();
  });

  test.afterEach(async () => {
    await server.close();
  });

  for (const { profile, textScale } of profiles) {
    const label = `${profile}, text ${textScale}`;

    const open = async (page: Page, station = false) => {
      await seedUiMocks(page, server.baseUrl);
      await installAudioFxMock(page, { active: true });
      await seed(page, { textScale, profile, station });
      await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS[profile].viewport);
      await page.goto("/play", { waitUntil: "domcontentloaded" });
      const slot = activeSlot(page);
      await expect(slot.getByTestId("playlist-play")).toBeVisible({ timeout: 30_000 });
      await expect(slot.getByTestId("playback-current-title")).toBeVisible();
      await dismissToasts(page);
      await slot.getByTestId("playlist-play").scrollIntoViewIfNeeded();
      await page.waitForTimeout(800);
      await installSampler(page);
      return currentFrame(page);
    };

    test(`walking through tunes with different metadata (${label})`, async ({ page }) => {
      const reference = await open(page);
      const slot = activeSlot(page);
      await slot.getByTestId("playlist-play").dispatchEvent("click");
      await expect(slot.getByTestId("playlist-play")).toHaveAttribute("aria-label", "Stop", { timeout: 20_000 });
      await dismissToasts(page);
      const problems: string[] = [];
      for (const direction of ["playlist-next", "playlist-prev"] as const) {
        for (let step = 0; step < TUNES.length - 1; step += 1) {
          const movements = await watch(page, reference, async () => {
            await slot.getByTestId(direction).dispatchEvent("click");
          });
          const shown = await titleOf(page);
          const summary = [...new Set(movements.map((m) => `dx=${m.dx} dy=${m.dy} dw=${m.dw} dh=${m.dh}`))];
          if (summary.length) {
            problems.push(
              `${direction} #${step + 1} -> "${shown}": ${movements.length} elements, ${summary.join(" | ")}`,
            );
          }
          await dismissToasts(page);
        }
      }
      expect(problems, `${label}: movement while walking`).toEqual([]);
    });

    test(`opening and closing folds and notes (${label})`, async ({ page }) => {
      await open(page);
      const slot = activeSlot(page);
      await slot.getByTestId("playlist-next").dispatchEvent("click");
      await expect(slot.getByTestId("tune-details-toggle")).toBeVisible({ timeout: 10_000 });
      const toggle = slot.getByTestId("tune-details-toggle");
      expectUnmoved(`${label}: open About this tune`, await clickWatched(page, toggle));
      const more = slot.getByTestId("tune-notes-toggle");
      await expect(more, "the long STIL note offers Show more").toHaveCount(1);
      expectUnmoved(`${label}: Show more`, await clickWatched(page, more));
      expectUnmoved(`${label}: Show less`, await clickWatched(page, more));
      expectUnmoved(`${label}: close About this tune`, await clickWatched(page, toggle));
    });

    test(`order, ranking, volume, sleep timer and spectrum (${label})`, async ({ page }) => {
      await open(page);
      const slot = activeSlot(page);
      const click = (name: string, locator: Locator) => clickAndExpectUnmoved(page, name, locator);
      await click("shuffle on", slot.getByTestId("playback-shuffle"));
      await click("shuffle off", slot.getByTestId("playback-shuffle"));
      await click("repeat playlist", slot.getByTestId("playback-repeat"));
      await click("repeat tune", slot.getByTestId("playback-repeat"));
      await click("repeat off", slot.getByTestId("playback-repeat"));
      await click("like", slot.getByTestId("now-playing-like"));
      await click("like again", slot.getByTestId("now-playing-like"));
      await click("mute", slot.getByTestId("volume-mute"));
      await click("unmute", slot.getByTestId("volume-mute"));
      for (const key of ["m15", "m30", "off"]) {
        await click(`sleep timer ${key}`, slot.getByTestId(`sleep-timer-${key}`));
      }
      const spectrumHeader = slot.getByTestId("play-section-spectrum").locator("button[aria-expanded]").first();
      await click("spectrum toggle", spectrumHeader);
      await click("spectrum toggle back", spectrumHeader);
    });

    test(`a running SID Radio station, its explanation and stopping it (${label})`, async ({ page }) => {
      await open(page, true);
      const slot = activeSlot(page);
      await expect(slot.getByTestId("sid-radio-chip")).toBeVisible({ timeout: 10_000 });
      await clickAndExpectUnmoved(page, "open station explanation", slot.getByTestId("sid-radio-chip-toggle"));
      await clickAndExpectUnmoved(page, "close station explanation", slot.getByTestId("sid-radio-chip-toggle"));
      await slot.getByTestId("playlist-next").dispatchEvent("click");
      await clickAndExpectUnmoved(page, "stop station", slot.getByTestId("sid-radio-stop"));
      await expect(slot.getByTestId("sid-radio-chip")).toHaveCount(0);
    });

    test(`an error toast appearing and being dismissed (${label})`, async ({ page }) => {
      const reference = await open(page);
      const slot = activeSlot(page);
      await slot.getByTestId("playlist-play").dispatchEvent("click");
      await expect(slot.getByTestId("playlist-play")).toHaveAttribute("aria-label", "Stop", { timeout: 20_000 });
      await dismissToasts(page);
      await page.route("**/v1/runners:*", (route) =>
        route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ errors: ["refused"] }) }),
      );
      const toast = page.getByTestId("app-toast-close").first();
      const appearing = await watch(page, reference, async () => {
        await slot.getByTestId("playlist-next").dispatchEvent("click");
        await expect(toast, "an error toast appears").toBeVisible({ timeout: 15_000 });
      });
      expectUnmoved(`${label}: toast appearing`, appearing);
      expectUnmoved(`${label}: toast dismissed`, await watch(page, reference, () => toast.click()));
    });

    test(`a station does not change where the controls sit in the page (${label})`, async ({ page }) => {
      await open(page);
      const withoutStation = await documentPositionOfPlay(page);
      await page.evaluate(() =>
        localStorage.setItem(
          "c64u_sid_radio_session",
          JSON.stringify({
            seedKind: "style",
            seedLabel: "Chill / Ambient",
            seed: { kind: "style", styleBit: 0 },
            styleFilter: 0,
            shuffleSeed: 777,
            rankingSnapshotId: "snap",
            excludeOrdinals: [],
          }),
        ),
      );
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(activeSlot(page).getByTestId("sid-radio-chip")).toBeVisible({ timeout: 30_000 });
      const withStation = await documentPositionOfPlay(page);
      expect(withStation, "play button position in the page with a station").toBe(withoutStation);
    });
  }
});
