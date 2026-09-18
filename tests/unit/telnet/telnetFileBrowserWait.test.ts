/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

/*
 * Waiting for the menu that offers a particular action, rather than for any menu at all: the frame
 * a file listing is drawn in parses as a menu too, so a caller that waits for the first and reads
 * the second gets whichever box was found first. When the wait runs out, what comes back is the
 * last screen that did show a menu, so the failure can say what that menu offered.
 */

import { describe, expect, it, vi } from "vitest";
import { navigateToFileBrowserEntry, waitForScreen } from "@/lib/telnet/telnetFileBrowser";
import type { ParsedMenu, TelnetScreen, TelnetSessionApi } from "@/lib/telnet/telnetTypes";

const menu = (labels: string[]): ParsedMenu => ({
  level: 0,
  selectedIndex: 0,
  bounds: { x: 0, y: 0, width: 10, height: 4 },
  items: labels.map((label, index) => ({ label, selected: index === 0, enabled: true })),
});

const screen = (menus: ParsedMenu[]): TelnetScreen =>
  ({
    width: 60,
    height: 24,
    cells: [],
    menus,
    form: null,
    selectedItem: null,
    titleLine: "",
    screenType: "unknown",
  }) as unknown as TelnetScreen;

const sessionOf = (screens: TelnetScreen[]): TelnetSessionApi =>
  ({ readScreen: vi.fn(async () => screens.shift() ?? screen([])) }) as unknown as TelnetSessionApi;

const entry = (label: string | null): TelnetScreen =>
  ({ ...screen([]), selectedItem: label }) as unknown as TelnetSessionApi as unknown as TelnetScreen;

const walkSession = (screens: TelnetScreen[]) => {
  const sendKey = vi.fn(async () => undefined);
  const queue = [...screens];
  return {
    sendKey,
    readScreen: vi.fn(async () => queue.shift() ?? screens[screens.length - 1]),
  } as unknown as TelnetSessionApi & { sendKey: ReturnType<typeof vi.fn> };
};

const offersLoad = (candidate: TelnetScreen) =>
  candidate.menus.some((entry) => entry.items.some((item) => item.label === "Load Settings"));
const hasAnyMenu = (candidate: TelnetScreen) => candidate.menus.length > 0;

describe("waiting for a screen", () => {
  it("returns the first screen that satisfies the predicate", async () => {
    const wanted = screen([menu(["Load Settings", "Delete"])]);
    const result = await waitForScreen(sessionOf([wanted]), screen([]), offersLoad, hasAnyMenu);
    expect(result).toBe(wanted);
  });

  it("hands back the menu it did get when the one it wanted never came", async () => {
    const other = screen([menu(["Delete"])]);
    const result = await waitForScreen(sessionOf([other, screen([]), screen([])]), screen([]), offersLoad, hasAnyMenu);
    expect(result).toBe(other);
  });

  /* With nothing to fall back on there is only the last read, and a caller reports it as no menu. */
  it("hands back the last screen read when no menu ever appeared", async () => {
    const last = screen([]);
    const result = await waitForScreen(sessionOf([screen([]), screen([]), last]), screen([]), offersLoad, hasAnyMenu);
    expect(result.menus).toEqual([]);
  });

  /* The device can answer on the very last read the wait allows, and that still counts. */
  it("accepts a screen that only arrives on the last read", async () => {
    const wanted = screen([menu(["Load Settings"])]);
    const result = await waitForScreen(sessionOf([screen([]), screen([]), wanted]), screen([]), offersLoad, hasAnyMenu);
    expect(result).toBe(wanted);
  });

  it("works without a fallback predicate at all", async () => {
    const wanted = screen([menu(["Load Settings"])]);
    const result = await waitForScreen(sessionOf([wanted]), screen([]), offersLoad);
    expect(result).toBe(wanted);
  });
});

/*
 * The listing does not wrap and the cursor does not start at the top: coming back out of a
 * directory leaves it on the directory it came from, so an entry above that is unreachable by DOWN
 * alone. On an Ultimate 64 that entry is `Temp`, third in the root listing, and every attempt to
 * stage a settings file through it walked to the bottom of the list and stopped there.
 */
describe("walking the file browser to an entry", () => {
  it("finds an entry below the cursor without turning round", async () => {
    const session = walkSession([entry("Flash"), entry("Temp")]);
    const found = await navigateToFileBrowserEntry(session, "Temp", { maxSteps: 20 });
    expect(found.selectedItem).toBe("Temp");
    expect(session.sendKey.mock.calls.map(([key]: [string]) => key)).not.toContain("UP");
  });

  it("turns round at the end of the list to reach an entry above the cursor", async () => {
    const stuck = Array.from({ length: 14 }, () => entry("USB2"));
    const session = walkSession([entry("USB2"), ...stuck, entry("Temp")]);

    const found = await navigateToFileBrowserEntry(session, "Temp", { maxSteps: 40 });

    const keys = session.sendKey.mock.calls.map(([key]: [string]) => key);
    expect(found.selectedItem).toBe("Temp");
    expect(keys).toContain("DOWN");
    expect(keys).toContain("UP");
    expect(keys.indexOf("UP")).toBeGreaterThan(keys.indexOf("DOWN"));
  });

  /* A browser that answers the same thing in both directions is stuck, and that is a failure. */
  it("gives up when neither direction moves", async () => {
    const session = walkSession(Array.from({ length: 60 }, () => entry("USB2")));
    await expect(navigateToFileBrowserEntry(session, "Temp", { maxSteps: 40 })).rejects.toMatchObject({
      code: "TIMEOUT",
    });
  });
});
