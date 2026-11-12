/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { test, expect, type Page } from "@playwright/test";
import { createMockC64Server } from "../tests/mocks/mockC64Server";
import { seedUiMocks } from "./uiMocks";
import { disableTraceAssertions } from "./traceUtils";
import { DISPLAY_PROFILE_VIEWPORTS } from "./displayProfileViewports";
import { enableKeypad, ringFocus } from "./focusRing";
import { installAudioFxMock } from "./audioFxMock";
import { PLAYBACK_SESSION_KEY, SHARED_PLAYLIST_STORAGE_KEY } from "../src/pages/playFiles/playFilesUtils";

const TUNES = ["Commando", "Crazy Comets", "Delta", "Monty on the Run"];

const seedPlaylist = (page: Page) =>
  page.addInitScript(
    ({ playlistKey, sessionKey, names }) => {
      localStorage.setItem("c64u_display_profile_override", "compact");
      const items = names.map((name) => ({
        source: "hvsc",
        path: `/MUSICIANS/H/Hubbard_Rob/${name.replaceAll(" ", "_")}.sid`,
        name: `${name}.sid`,
        durationMs: 120_000,
        songNr: 1,
      }));
      const payload = JSON.stringify({ items, currentIndex: null });
      localStorage.setItem(playlistKey, payload);
      localStorage.setItem("c64u_playlist:v1:default", payload);
      sessionStorage.removeItem(sessionKey);
    },
    { playlistKey: SHARED_PLAYLIST_STORAGE_KEY, sessionKey: PLAYBACK_SESSION_KEY, names: TUNES },
  );

const readPlaylistRepositoryOrder = (page: Page) =>
  page.evaluate(async (playlistId) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("c64u-playlist-repository", 1);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
    });
    try {
      const value = await new Promise<{ "playlist-position"?: string[] } | undefined>((resolve, reject) => {
        const request = db.transaction("state", "readonly").objectStore("state").get(`playlist-order:${playlistId}`);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("IndexedDB read failed"));
      });
      return value?.["playlist-position"] ?? [];
    } finally {
      db.close();
    }
  }, SHARED_PLAYLIST_STORAGE_KEY);

const rowTitles = (page: Page) =>
  page
    .getByTestId("playlist-item")
    .evaluateAll((rows) => rows.map((row) => (row.textContent ?? "").trim()).map((text) => text.slice(0, 40)));

test.describe("Removing a playlist row can be undone, with the keypad only @layout", () => {
  let server: Awaited<ReturnType<typeof createMockC64Server>>;

  test.beforeEach(async ({ page }, testInfo) => {
    disableTraceAssertions(testInfo, "Playlist removal coverage; trace assertions disabled.");
    server = await createMockC64Server({});
    await seedUiMocks(page, server.baseUrl);
    await enableKeypad(page);
    await installAudioFxMock(page);
    await seedPlaylist(page);
    await page.setViewportSize(DISPLAY_PROFILE_VIEWPORTS.compact.viewport);
    await page.goto("/play", { waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => document.documentElement.dataset.displayProfile === "compact");
    await expect(page.getByTestId("playlist-item")).toHaveCount(TUNES.length);
  });

  test.afterEach(async () => {
    await server.close();
  });

  test("Remove from playlist leaves Undo, which restores the row at its position", async ({ page }) => {
    const before = await rowTitles(page);
    await expect.poll(async () => (await readPlaylistRepositoryOrder(page)).length).toBe(TUNES.length);
    const orderBefore = await readPlaylistRepositoryOrder(page);
    const secondRowActions = page.getByTestId("playlist-item").nth(1).getByRole("button", { name: "Item actions" });
    expect(await ringFocus(page, secondRowActions, 120)).toBe(true);
    await page.keyboard.press("Enter");

    const sheet = page.getByTestId("action-list-item-sheet");
    const remove = sheet.getByRole("button", { name: "Remove from playlist" });
    expect(await ringFocus(page, remove, 20)).toBe(true);
    const box = await remove.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
    await page.keyboard.press("Enter");

    await expect(page.getByTestId("playlist-item")).toHaveCount(TUNES.length - 1);
    const toast = page.getByTestId("app-toast").filter({ hasText: "Removed 1 item" });
    await expect(toast).toBeVisible();
    await expect.poll(async () => (await readPlaylistRepositoryOrder(page)).length).toBe(TUNES.length - 1);

    const blocked = await page.getByTestId("playlist-item").evaluateAll((rows) =>
      rows.flatMap((row) => {
        const button = row.querySelector<HTMLElement>('button[aria-label="Item actions"]');
        if (!button) return [];
        const rect = button.getBoundingClientRect();
        const pageBottom = document.querySelector('[data-slot-active="true"]')?.getBoundingClientRect().bottom ?? 0;
        const centerY = rect.top + rect.height / 2;
        if (centerY <= 0 || centerY >= pageBottom) return [];
        const hit = document.elementFromPoint(rect.left + rect.width / 2, centerY);
        if (hit && (button === hit || button.contains(hit))) return [];
        return [`${hit?.tagName ?? "none"} ${hit?.closest("[data-testid]")?.getAttribute("data-testid") ?? ""}`];
      }),
    );
    expect(blocked, "Playlist controls covered by the notification strip").toEqual([]);

    await page
      .getByTestId("app-bar-quick-menu")
      .first()
      .evaluate((node) => (node as HTMLButtonElement).click());
    await page.getByTestId("keypad-quick-menu-toast-action").click();

    await expect(page.getByTestId("playlist-item")).toHaveCount(TUNES.length);
    expect(await rowTitles(page)).toEqual(before);
    await expect.poll(() => readPlaylistRepositoryOrder(page)).toEqual(orderBefore);
  });

  test("Move to top and Move to bottom reorder the playlist from the row menu", async ({ page }) => {
    const rowActions = (index: number) =>
      page.getByTestId("playlist-item").nth(index).getByRole("button", { name: "Item actions" });
    const sheet = page.getByTestId("action-list-item-sheet");
    const before = await rowTitles(page);

    expect(await ringFocus(page, rowActions(2), 120)).toBe(true);
    await page.keyboard.press("Enter");
    const toTop = sheet.getByRole("button", { name: "Move to top" });
    expect(await ringFocus(page, toTop, 20)).toBe(true);
    await page.keyboard.press("Enter");

    await expect.poll(async () => (await rowTitles(page))[0]).toBe(before[2]);
    expect(await rowTitles(page)).toEqual([before[2], before[0], before[1], before[3]]);
  });
});
