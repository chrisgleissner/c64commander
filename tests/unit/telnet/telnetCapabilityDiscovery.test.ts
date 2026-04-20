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

const createMenu = (
  level: number,
  selectedIndex: number,
  labels: string[],
  bounds: ParsedMenu["bounds"] = { x: 0, y: 0, width: 20, height: labels.length + 2 },
): ParsedMenu => ({
  level,
  selectedIndex,
  bounds,
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

const createOverlaySubmenuScreen = (rootLabels: string[], rootIndex: number, rows: string[]) => {
  const bounds = { x: 0, y: 0, width: 48, height: Math.max(rows.length + 2, rootLabels.length + 2) };
  const screen = createScreen({
    menus: [createMenu(0, rootIndex, rootLabels, bounds)],
  });
  rows.forEach((row, index) => {
    stampText(screen, index + 1, 1, row);
  });
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

  it("uses the deepest actionable menu as the root on C64U F1 screens", async () => {
    const actionLabels = ["Power & Reset", "Configuration"];
    const runner = createRunner([
      [
        createScreen({
          menus: [createMenu(0, 0, ["USB1 Verbat Ready"]), createMenu(1, 0, actionLabels)],
        }),
      ],
      [
        createScreen({
          menus: [createMenu(0, 0, ["USB1 Verbat Ready"]), createMenu(1, 0, actionLabels)],
        }),
        createScreen({
          menus: [
            createMenu(0, 0, ["USB1 Verbat Ready"]),
            createMenu(1, 0, actionLabels),
            createMenu(2, 0, ["Reset C64", "Power Cycle"]),
          ],
        }),
      ],
      [
        createScreen({
          menus: [createMenu(0, 0, ["USB1 Verbat Ready"]), createMenu(1, 0, actionLabels)],
        }),
        createScreen({
          menus: [createMenu(0, 0, ["USB1 Verbat Ready"]), createMenu(1, 1, actionLabels)],
        }),
        createScreen({
          menus: [
            createMenu(0, 0, ["USB1 Verbat Ready"]),
            createMenu(1, 1, actionLabels),
            createMenu(2, 0, ["Save to File"]),
          ],
        }),
      ],
    ]);

    const snapshot = await discoverTelnetCapabilities({
      cacheKey: "c64u-nested|F1",
      deviceInfo: {
        product: "C64 Ultimate",
        firmware_version: "1.1.0",
        hostname: "c64u",
        unique_id: "c64u-nested",
      },
      menuKey: "F1",
      runner,
    });

    expect(snapshot.initialMenu.items).toEqual(actionLabels);
    expect(snapshot.actionSupport.powerCycle).toMatchObject({
      status: "supported",
      target: {
        categoryLabel: "Power & Reset",
        actionLabel: "Power Cycle",
      },
    });
  });

  it("tolerates transient blank frames and standalone submenu screens while probing U64 menus", async () => {
    const rootLabels = ["Assembly 64", "C64 Machine", "Configuration"];
    const runner = createRunner([
      [createRootScreen(rootLabels)],
      [createRootScreen(rootLabels), createDirectEntryScreen(rootLabels, 0, "Assembly 64 Query Form")],
      [
        createRootScreen(rootLabels),
        createScreen({ menus: [] }),
        createScreen({
          menus: [createMenu(0, 0, ["Reset C64", "Reboot C64", "Reboot (Clr Mem)", "Save REU Memory"])],
        }),
      ],
      [
        createRootScreen(rootLabels),
        createScreen({ menus: [] }),
        createScreen({ menus: [] }),
        createScreen({
          menus: [createMenu(0, 0, ["Save to File", "Save to Flash"])],
        }),
      ],
    ]);

    const snapshot = await discoverTelnetCapabilities({
      cacheKey: "u64-transient|F5",
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-transient",
      },
      menuKey: "F5",
      runner,
    });

    expect(snapshot.actionSupport.rebootClearMemory).toMatchObject({
      status: "supported",
      target: {
        categoryLabel: "C64 Machine",
        actionLabel: "Reboot (Clr Mem)",
      },
    });
    expect(snapshot.actionSupport.saveConfigToFile).toMatchObject({
      status: "supported",
      target: {
        categoryLabel: "Configuration",
        actionLabel: "Save to File",
      },
    });
  });

  it("extracts overlay submenu items from noisy rows and deduplicates repeated labels", async () => {
    const rootLabels = ["C64 Machine", "Configuration"];
    const runner = createRunner([
      [createRootScreen(rootLabels)],
      [
        createRootScreen(rootLabels),
        createOverlaySubmenuScreen(rootLabels, 0, [
          "│┌ Reset C64",
          "│┌ Reboot C64",
          "│┌ Reboot",
          "│┌ Reboot",
        ]),
      ],
      [
        createRootScreen(rootLabels),
        createRootScreen(rootLabels, 1),
        createSubmenuScreen(rootLabels, 1, ["Save to File"]),
      ],
    ]);

    const snapshot = await discoverTelnetCapabilities({
      cacheKey: "u64-overlay|F5",
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-overlay",
      },
      menuKey: "F5",
      runner,
    });

    expect(snapshot.initialMenu.nodes["C64 Machine"]).toEqual({
      kind: "submenu",
      items: ["Reset C64", "Reboot C64"],
      defaultItem: "Reset C64",
    });
    expect(snapshot.actionSupport.rebootKeepMemory).toMatchObject({
      status: "supported",
      target: {
        categoryLabel: "C64 Machine",
        actionLabel: "Reboot C64",
      },
    });
  });

  it("marks actions unsupported when a category opens a direct-entry screen", async () => {
    const rootLabels = ["Configuration"];
    const runner = createRunner([
      [createRootScreen(rootLabels)],
      [createRootScreen(rootLabels), createDirectEntryScreen(rootLabels, 0, "Configuration File Search")],
    ]);

    const snapshot = await discoverTelnetCapabilities({
      cacheKey: "u64-file-search|F5",
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-file-search",
      },
      menuKey: "F5",
      runner,
    });

    expect(snapshot.initialMenu.nodes.Configuration).toEqual({
      kind: "direct_entry",
      title: "Configuration File Search",
    });
    expect(snapshot.actionSupport.saveConfigToFile).toMatchObject({
      status: "unsupported",
      reason: "Save Config to File is not exposed in the Configuration menu on Ultimate 64 Elite 3.14e.",
      target: null,
    });
  });

  it("marks actions unsupported when a submenu does not expose the requested item", async () => {
    const rootLabels = ["Configuration"];
    const runner = createRunner([
      [createRootScreen(rootLabels)],
      [createRootScreen(rootLabels), createSubmenuScreen(rootLabels, 0, ["Backup to USB"])],
    ]);

    const snapshot = await discoverTelnetCapabilities({
      cacheKey: "u64-missing-action|F5",
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-missing-action",
      },
      menuKey: "F5",
      runner,
    });

    expect(snapshot.actionSupport.saveConfigToFile).toMatchObject({
      status: "unsupported",
      reason: "Save Config to File is not available on Ultimate 64 Elite 3.14e.",
      target: null,
    });
  });

  it("fails discovery when the action menu never becomes visible", async () => {
    const runner = createRunner([[createScreen({ menus: [] }), createScreen({ menus: [] })]]);

    await expect(
      discoverTelnetCapabilities({
        cacheKey: "u64-no-menu|F5",
        deviceInfo: {
          product: "Ultimate 64 Elite",
          firmware_version: "3.14e",
          hostname: "u64",
          unique_id: "u64-no-menu",
        },
        menuKey: "F5",
        runner,
      }),
    ).rejects.toMatchObject({
      code: "MENU_NOT_FOUND",
      message: "Action menu not visible after F5",
    });
  });

  it("reuses an in-flight discovery promise for the same cache key", async () => {
    const rootLabels = ["Configuration"];
    const runner = createRunner([
      [createRootScreen(rootLabels)],
      [createRootScreen(rootLabels), createSubmenuScreen(rootLabels, 0, ["Save to File"])],
    ]);

    const first = discoverTelnetCapabilities({
      cacheKey: "u64-pending|F5",
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-pending",
      },
      menuKey: "F5",
      runner,
    });
    const second = discoverTelnetCapabilities({
      cacheKey: "u64-pending|F5",
      deviceInfo: {
        product: "Ultimate 64 Elite",
        firmware_version: "3.14e",
        hostname: "u64",
        unique_id: "u64-pending",
      },
      menuKey: "F5",
      runner,
    });

    const [firstSnapshot, secondSnapshot] = await Promise.all([first, second]);

    expect(secondSnapshot).toBe(firstSnapshot);
  });
});
