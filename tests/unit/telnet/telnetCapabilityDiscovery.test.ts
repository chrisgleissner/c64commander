/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearTelnetCapabilityCache,
  discoverTelnetCapabilities,
  type TelnetSessionRunner,
} from "@/lib/telnet/telnetCapabilityDiscovery";
import type { ParsedMenu, ScreenCell, TelnetScreen, TelnetSessionApi } from "@/lib/telnet/telnetTypes";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

const blankCell = (): ScreenCell => ({ char: " ", reverse: false, color: 7 });

const createScreen = (overrides: Partial<TelnetScreen>): TelnetScreen => ({
  width: 60,
  height: 24,
  cells: Array.from({ length: 24 }, () => Array.from({ length: 60 }, () => blankCell())),
  menus: [],
  form: null,
  selectedItem: null,
  titleLine: "",
  screenType: "action_menu",
  ...overrides,
});

const stampText = (screen: TelnetScreen, row: number, col: number, text: string) => {
  text.split("").forEach((char, index) => {
    screen.cells[row][col + index] = { char, reverse: false, color: 7 };
  });
};

const createMenu = (level: number, selectedIndex: number, labels: string[]): ParsedMenu => ({
  level,
  selectedIndex,
  bounds: { x: 0, y: 0, width: 20, height: labels.length + 2 },
  items: labels.map((label, index) => ({
    label,
    selected: index === selectedIndex,
    enabled: true,
  })),
});

const createRootScreen = (labels: string[], selectedIndex = 0) =>
  createScreen({
    menus: [createMenu(0, selectedIndex, labels)],
  });

const createSubmenuScreen = (rootLabels: string[], rootIndex: number, submenuLabels: string[]) =>
  createScreen({
    menus: [createMenu(0, rootIndex, rootLabels), createMenu(1, 0, submenuLabels)],
  });

const createDirectEntryScreen = (rootLabels: string[], rootIndex: number, title: string) => {
  const screen = createScreen({
    menus: [
      createMenu(0, rootIndex, rootLabels),
      {
        level: 1,
        selectedIndex: 0,
        bounds: { x: 20, y: 1, width: 28, height: 6 },
        items: [],
      },
    ],
  });
  stampText(screen, 2, 22, title);
  return screen;
};

const createRunner = (sessionScreens: TelnetScreen[][]): TelnetSessionRunner => {
  const queue = [...sessionScreens];
  return {
    withSession: async (callback) => {
      const screens = queue.shift();
      if (!screens) {
        throw new Error("No queued session screens available");
      }
      const session: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn().mockImplementation(async () => {
          const next = screens.shift();
          if (!next) {
            throw new Error("No queued screen available");
          }
          return next;
        }),
        isConnected: vi.fn().mockReturnValue(true),
      };
      return await callback(session);
    },
  };
};

describe("discoverTelnetCapabilities", () => {
  beforeEach(() => {
    clearTelnetCapabilityCache();
  });

  it("maps U64 C64 Machine actions without assuming Power & Reset and marks powerCycle unsupported", async () => {
    const rootLabels = ["Assembly 64", "C64 Machine", "Configuration"];
    const runner = createRunner([
      [createRootScreen(rootLabels)],
      [createRootScreen(rootLabels), createDirectEntryScreen(rootLabels, 0, "Assembly 64 Query Form")],
      [
        createRootScreen(rootLabels),
        createRootScreen(rootLabels, 1),
        createSubmenuScreen(rootLabels, 1, ["Reset C64", "Reboot C64", "Reboot (Clr Mem)"]),
      ],
      [
        createRootScreen(rootLabels),
        createRootScreen(rootLabels, 1),
        createRootScreen(rootLabels, 2),
        createSubmenuScreen(rootLabels, 2, ["Save to File"]),
      ],
    ]);

    const snapshot = await discoverTelnetCapabilities({
      cacheKey: "u64|F5",
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-1",
      },
      menuKey: "F5",
      runner,
    });

    expect(snapshot.initialMenu.nodes["Assembly 64"]).toEqual({
      kind: "direct_entry",
      title: "Assembly 64 Query Form",
    });
    expect(snapshot.actionSupport.rebootClearMemory).toMatchObject({
      status: "supported",
      target: {
        categoryLabel: "C64 Machine",
        actionLabel: "Reboot (Clr Mem)",
      },
    });
    expect(snapshot.actionSupport.powerCycle).toMatchObject({
      status: "unsupported",
      reason: "Power Cycle is not available on Ultimate 64 Elite 3.14e.",
      target: null,
    });
  });

  it("keeps C64U powerCycle supported through the same discovery path", async () => {
    const rootLabels = ["Power & Reset", "Configuration"];
    const runner = createRunner([
      [createRootScreen(rootLabels)],
      [
        createRootScreen(rootLabels),
        createSubmenuScreen(rootLabels, 0, ["Reset C64", "Reboot C64", "Reboot (Clr Mem)", "Power Cycle"]),
      ],
      [
        createRootScreen(rootLabels),
        createRootScreen(rootLabels, 1),
        createSubmenuScreen(rootLabels, 1, ["Save to File"]),
      ],
    ]);

    const snapshot = await discoverTelnetCapabilities({
      cacheKey: "c64u|F1",
      deviceInfo: {
        product: "C64 Ultimate",
        firmware_version: "1.1.0",
        hostname: "c64u",
        unique_id: "c64u-1",
      },
      menuKey: "F1",
      runner,
    });

    expect(snapshot.actionSupport.powerCycle).toMatchObject({
      status: "supported",
      target: {
        categoryLabel: "Power & Reset",
        actionLabel: "Power Cycle",
      },
    });
  });
});
