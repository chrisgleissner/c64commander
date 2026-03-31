/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { TelnetMock } from "@/lib/telnet/telnetMock";
import { createTelnetSession } from "@/lib/telnet/telnetSession";
import { createMenuNavigator, matchLabel } from "@/lib/telnet/telnetMenuNavigator";
import { TelnetError } from "@/lib/telnet/telnetTypes";
import type { TelnetSessionApi, TelnetScreen } from "@/lib/telnet/telnetTypes";

vi.mock("@/lib/logging", () => ({
  addLog: vi.fn(),
}));

/** Helper: create a connected session from a mock */
async function createConnectedSession(mock?: TelnetMock) {
  const m = mock ?? new TelnetMock();
  const session = createTelnetSession(m);
  await session.connect("localhost", 23);
  return session;
}

describe("matchLabel", () => {
  it("matches identical labels", () => {
    expect(matchLabel("Power & Reset", "Power & Reset")).toBe(true);
  });

  it("matches case-insensitively", () => {
    expect(matchLabel("power & reset", "Power & Reset")).toBe(true);
  });

  it("matches with extra whitespace", () => {
    expect(matchLabel("  Power  &  Reset  ", "Power & Reset")).toBe(true);
  });

  it("rejects different labels", () => {
    expect(matchLabel("Power & Reset", "Software IEC")).toBe(false);
  });
});

describe("createMenuNavigator", () => {
  describe("navigate", () => {
    it("navigates to first category first action", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      // Power & Reset → Reset C64 (first category, first action)
      await nav.navigate(["Power & Reset", "Reset C64"], "F5");
    });

    it("navigates to second category first action", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await nav.navigate(["Software IEC", "Turn On"], "F5");
    });

    it("navigates to a deep action (third category)", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await nav.navigate(["Printer", "Flush/Eject"], "F5");
    });

    it("navigates to an action not at index 0 in submenu", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      // Power Cycle is 5th action (index 4) in Power & Reset
      await nav.navigate(["Power & Reset", "Power Cycle"], "F5");
    });

    it("navigates with F1 key", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await nav.navigate(["Power & Reset", "Reset C64"], "F1");
    });

    it("throws ITEM_NOT_FOUND for missing category", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await expect(nav.navigate(["Nonexistent", "Reset C64"], "F5")).rejects.toThrow(TelnetError);
    });

    it("throws ITEM_NOT_FOUND for missing action", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await expect(nav.navigate(["Power & Reset", "Nonexistent Action"], "F5")).rejects.toThrow(TelnetError);
    });

    it("handles missingItems in mock", async () => {
      const mock = new TelnetMock({ missingItems: ["Reset C64"] });
      const session = await createConnectedSession(mock);
      const nav = createMenuNavigator(session);

      await expect(nav.navigate(["Power & Reset", "Reset C64"], "F5")).rejects.toThrow(TelnetError);
    });

    it("navigates to last category", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      // Developer is the 5th (last) category
      await nav.navigate(["Developer", "Clear Debug Log"], "F5");
    });

    it("navigates to second action in submenu", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      // Reboot (Clr Mem) is 2nd action (index 1) in Power & Reset
      await nav.navigate(["Power & Reset", "Reboot (Clr Mem)"], "F5");
    });

    it("navigates from already-selected category", async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      // First category, first action — category already selected at index 0
      await nav.navigate(["Power & Reset", "Reset C64"], "F5");
    });

    it("wraps generic errors in TelnetError", async () => {
      // Create a mock session that throws a non-TelnetError
      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(() => {
          throw new Error("generic transport failure");
        }),
        sendRaw: vi.fn(),
        readScreen: vi.fn(),
      };
      const nav = createMenuNavigator(fakeSession);

      await expect(nav.navigate(["Power & Reset", "Reset C64"], "F5")).rejects.toThrow(TelnetError);
    });
  });

  describe("openActionMenu retry", () => {
    it("retries once when menu not visible on first F5", async () => {
      // Build a fake session that returns no menu on first readScreen, then returns menu on second
      const emptyScreen: TelnetScreen = {
        width: 60,
        height: 24,
        cells: [],
        menus: [],
        form: null,
        selectedItem: null,
        titleLine: "",
        screenType: "file_browser",
      };
      const menuScreen: TelnetScreen = {
        width: 60,
        height: 24,
        cells: [],
        menus: [
          {
            level: 0,
            items: [
              {
                label: "Power & Reset",
                selected: true,
                enabled: true,
              },
            ],
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 20, height: 5 },
          },
        ],
        form: null,
        selectedItem: "Power & Reset",
        titleLine: "",
        screenType: "action_menu",
      };
      const menuScreenWithSub: TelnetScreen = {
        ...menuScreen,
        menus: [
          ...menuScreen.menus,
          {
            level: 1,
            items: [
              {
                label: "Reset C64",
                selected: true,
                enabled: true,
              },
            ],
            selectedIndex: 0,
            bounds: { x: 20, y: 0, width: 20, height: 5 },
          },
        ],
      };
      const afterExecScreen: TelnetScreen = {
        ...emptyScreen,
        screenType: "file_browser",
      };

      let readCount = 0;
      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn(() => {
          readCount++;
          // Read 1: no menu (triggers retry)
          // Read 2: menu visible (retry succeeds)
          // Read 3: submenu visible (after RIGHT)
          // Read 4: after ENTER (menu closed)
          if (readCount === 1) return Promise.resolve(emptyScreen);
          if (readCount === 2) return Promise.resolve(menuScreen);
          if (readCount === 3) return Promise.resolve(menuScreenWithSub);
          return Promise.resolve(afterExecScreen);
        }),
      };

      const nav = createMenuNavigator(fakeSession);
      await nav.navigate(["Power & Reset", "Reset C64"], "F5");
      // sendKey should have been called with F5 twice (initial + retry)
      const f5Calls = (fakeSession.sendKey as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: string[]) => c[0] === "F5",
      );
      expect(f5Calls.length).toBe(2);
    });

    it("throws MENU_NOT_FOUND when menu not visible after two tries", async () => {
      const emptyScreen: TelnetScreen = {
        width: 60,
        height: 24,
        cells: [],
        menus: [],
        form: null,
        selectedItem: null,
        titleLine: "",
        screenType: "file_browser",
      };

      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn(() => Promise.resolve(emptyScreen)),
      };

      const nav = createMenuNavigator(fakeSession);
      await expect(nav.navigate(["Power & Reset", "Reset C64"], "F5")).rejects.toThrow("tried twice");
    });
  });

  describe("menu still visible after ENTER", () => {
    it("reads extra screen when menu persists after execute", async () => {
      const menuScreen: TelnetScreen = {
        width: 60,
        height: 24,
        cells: [],
        menus: [
          {
            level: 0,
            items: [
              {
                label: "Power & Reset",
                selected: true,
                enabled: true,
              },
            ],
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 20, height: 5 },
          },
        ],
        form: null,
        selectedItem: "Power & Reset",
        titleLine: "",
        screenType: "action_menu",
      };
      const menuScreenWithSub: TelnetScreen = {
        ...menuScreen,
        menus: [
          ...menuScreen.menus,
          {
            level: 1,
            items: [
              {
                label: "Reset C64",
                selected: true,
                enabled: true,
              },
            ],
            selectedIndex: 0,
            bounds: { x: 20, y: 0, width: 20, height: 5 },
          },
        ],
      };
      const emptyScreen: TelnetScreen = {
        width: 60,
        height: 24,
        cells: [],
        menus: [],
        form: null,
        selectedItem: null,
        titleLine: "",
        screenType: "file_browser",
      };

      let readCount = 0;
      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn(() => {
          readCount++;
          if (readCount === 1) return Promise.resolve(menuScreen);
          if (readCount === 2) return Promise.resolve(menuScreenWithSub);
          // After ENTER, menu still visible
          if (readCount === 3) return Promise.resolve(menuScreen);
          // Extra read to clear
          return Promise.resolve(emptyScreen);
        }),
      };

      const nav = createMenuNavigator(fakeSession);
      await nav.navigate(["Power & Reset", "Reset C64"], "F5");
      // Should have called readScreen 4 times (including the extra one)
      expect((fakeSession.readScreen as ReturnType<typeof vi.fn>).mock.calls.length).toBe(4);
    });
  });

  describe("cursor desync during navigation", () => {
    const makeMenuScreen = (
      items: Array<{ label: string; selected: boolean }>,
      selectedIndex: number,
      subItems?: Array<{ label: string; selected: boolean }>,
    ): TelnetScreen => ({
      width: 60,
      height: 24,
      cells: [],
      menus: [
        {
          level: 0,
          items: items.map((i) => ({ ...i, enabled: true })),
          selectedIndex,
          bounds: { x: 0, y: 0, width: 20, height: 10 },
        },
        ...(subItems
          ? [
              {
                level: 1,
                items: subItems.map((i) => ({ ...i, enabled: true })),
                selectedIndex: 0,
                bounds: { x: 20, y: 0, width: 20, height: 5 },
              },
            ]
          : []),
      ],
      form: null,
      selectedItem: items.find((i) => i.selected)?.label ?? null,
      titleLine: "",
      screenType: "action_menu",
    });

    const makeEmptyScreen = (): TelnetScreen => ({
      width: 60,
      height: 24,
      cells: [],
      menus: [],
      form: null,
      selectedItem: null,
      titleLine: "",
      screenType: "file_browser",
    });

    const topItems = [
      { label: "Power & Reset", selected: true },
      { label: "Software IEC", selected: false },
    ];
    const subItems = [{ label: "Reset C64", selected: true }];

    it("retries DOWN and succeeds when cursor didn't advance on first key", async () => {
      // Navigate to "Software IEC" (index 1) — first DOWN doesn't move cursor, retry does
      const menuAt0 = makeMenuScreen(topItems, 0);
      const menuAt0AfterBadDown = makeMenuScreen(topItems, 0); // cursor stuck
      const menuAt1 = makeMenuScreen(
        [
          { label: "Power & Reset", selected: false },
          { label: "Software IEC", selected: true },
        ],
        1,
        subItems,
      );
      const menuAt1WithSub = makeMenuScreen(
        [
          { label: "Power & Reset", selected: false },
          { label: "Software IEC", selected: true },
        ],
        1,
        subItems,
      );

      let readCount = 0;
      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn(() => {
          readCount++;
          if (readCount === 1) return Promise.resolve(menuAt0); // F5 → menu visible
          if (readCount === 2) return Promise.resolve(menuAt0AfterBadDown); // DOWN → stuck at 0
          if (readCount === 3) return Promise.resolve(menuAt1); // retry DOWN → moves to 1
          if (readCount === 4) return Promise.resolve(menuAt1WithSub); // RIGHT → submenu
          return Promise.resolve(makeEmptyScreen()); // ENTER → done
        }),
      };

      const nav = createMenuNavigator(fakeSession);
      await nav.navigate(["Software IEC", "Reset C64"], "F5");
      // Verify retry happened: DOWN called at least twice
      const downCalls = (fakeSession.sendKey as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c: string[]) => c[0] === "DOWN",
      );
      expect(downCalls.length).toBeGreaterThanOrEqual(2);
    });

    it("throws DESYNC when cursor remains stuck after retry", async () => {
      const menuAt0 = makeMenuScreen(topItems, 0);

      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn(() => {
          // Always returns cursor at index 0 — never advances
          return Promise.resolve(menuAt0);
        }),
      };

      const nav = createMenuNavigator(fakeSession);
      await expect(nav.navigate(["Software IEC", "Reset C64"], "F5")).rejects.toThrow(TelnetError);
    });

    it("throws DESYNC when menu disappears during DOWN navigation", async () => {
      const menuAt0 = makeMenuScreen(topItems, 0);
      const emptyScreen = makeEmptyScreen();

      let readCount = 0;
      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn(() => {
          readCount++;
          if (readCount === 1) return Promise.resolve(menuAt0); // F5 → menu
          return Promise.resolve(emptyScreen); // all subsequent reads → no menu at all
        }),
      };

      const nav = createMenuNavigator(fakeSession);
      await expect(nav.navigate(["Software IEC", "Reset C64"], "F5")).rejects.toThrow(TelnetError);
    });

    it("throws DESYNC when final selected item label does not match target after navigation", async () => {
      // Navigate to "Software IEC" — after moving down, selectedItem is a different label
      const menuAt0 = makeMenuScreen(topItems, 0);
      const menuWithWrongLabel = makeMenuScreen(
        [
          { label: "Power & Reset", selected: false },
          { label: "Unexpected Label", selected: true }, // wrong label at index 1
        ],
        1,
      );

      let readCount = 0;
      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn(() => {
          readCount++;
          if (readCount === 1) return Promise.resolve(menuAt0);
          return Promise.resolve(menuWithWrongLabel);
        }),
      };

      const nav = createMenuNavigator(fakeSession);
      await expect(nav.navigate(["Software IEC", "Reset C64"], "F5")).rejects.toThrow(TelnetError);
    });
  });

  describe("timeout and submenu edge cases", () => {
    const makeMenuScreen = (
      items: Array<{ label: string; selected: boolean }>,
      selectedIndex: number,
      subItems?: Array<{ label: string; selected: boolean }>,
    ): TelnetScreen => ({
      width: 60,
      height: 24,
      cells: [],
      menus: [
        {
          level: 0,
          items: items.map((i) => ({ ...i, enabled: true })),
          selectedIndex,
          bounds: { x: 0, y: 0, width: 20, height: 10 },
        },
        ...(subItems
          ? [
              {
                level: 1,
                items: subItems.map((i) => ({ ...i, enabled: true })),
                selectedIndex: 0,
                bounds: { x: 20, y: 0, width: 20, height: 5 },
              },
            ]
          : []),
      ],
      form: null,
      selectedItem: items.find((i) => i.selected)?.label ?? null,
      titleLine: "",
      screenType: "action_menu",
    });

    it("throws TIMEOUT when checkTimeout fires before navigation completes", async () => {
      const menuWithItem = makeMenuScreen([{ label: "Power & Reset", selected: true }], 0);

      const dateSpy = vi.spyOn(Date, "now");
      let callCount = 0;
      dateSpy.mockImplementation(() => {
        callCount++;
        // First call records startTime; second call makes timeout fire
        return callCount === 1 ? 0 : 100_000;
      });

      try {
        const fakeSession: TelnetSessionApi = {
          connect: vi.fn(),
          disconnect: vi.fn(),
          isConnected: vi.fn(() => true),
          sendKey: vi.fn(),
          sendRaw: vi.fn(),
          readScreen: vi.fn(() => Promise.resolve(menuWithItem)),
        };
        const nav = createMenuNavigator(fakeSession);
        await expect(nav.navigate(["Power & Reset", "Reset C64"], "F5")).rejects.toThrow("timed out");
      } finally {
        dateSpy.mockRestore();
      }
    });

    it("throws MENU_NOT_FOUND when submenu not visible after entering category", async () => {
      const topItems = [{ label: "Power & Reset", selected: true }];
      const menuScreen = makeMenuScreen(topItems, 0); // no subItems → no level-1 menu

      const fakeSession: TelnetSessionApi = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        isConnected: vi.fn(() => true),
        sendKey: vi.fn(),
        sendRaw: vi.fn(),
        readScreen: vi.fn(() => Promise.resolve(menuScreen)),
      };

      const nav = createMenuNavigator(fakeSession);
      await expect(nav.navigate(["Power & Reset", "Reset C64"], "F5")).rejects.toThrow(TelnetError);
    });
  });
});
