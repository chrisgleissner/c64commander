import { describe, expect, it, vi } from "vitest";
import { restoreRemoteReuFromTemp, saveRemoteReuFromTemp } from "@/lib/reu/reuTelnetWorkflow";
import { TelnetError, type TelnetScreen, type TelnetSessionApi } from "@/lib/telnet/telnetTypes";

const executeSpy = vi.fn().mockResolvedValue(undefined);

const createScreen = (overrides: Partial<TelnetScreen>): TelnetScreen => ({
  width: 60,
  height: 24,
  cells: Array.from({ length: 24 }, () => Array.from({ length: 60 }, () => ({ char: " ", reverse: false, color: 7 }))),
  menus: [],
  form: null,
  selectedItem: null,
  titleLine: "",
  screenType: "file_browser",
  ...overrides,
});

const createSession = (screens: TelnetScreen[]): TelnetSessionApi => {
  const sendKey = vi.fn().mockResolvedValue(undefined);
  const readScreen = vi.fn().mockImplementation(async () => screens.shift() ?? createScreen({}));
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    sendKey,
    sendRaw: vi.fn().mockResolvedValue(undefined),
    readScreen,
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  };
};

vi.mock("@/lib/telnet/telnetActionExecutor", () => ({
  createActionExecutor: vi.fn(() => ({
    execute: executeSpy,
  })),
}));

describe("reuTelnetWorkflow", () => {
  it("navigates to Temp before executing Save REU", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
    ]);

    await saveRemoteReuFromTemp(session, "F5");

    expect(session.sendKey).toHaveBeenCalledWith("HOME");
    expect(session.sendKey).toHaveBeenCalledWith("DOWN");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
    expect(executeSpy).toHaveBeenCalledWith("saveReuMemory");
  });

  it("opens the selected file menu in /Temp and applies the requested restore action", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "old.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load into REU", selected: true, enabled: true },
              { label: "Preload on Startup", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 1,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load into REU", selected: false, enabled: true },
              { label: "Preload on Startup", selected: true, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "capture.reu" }),
    ]);

    await restoreRemoteReuFromTemp(session, "F5", "capture.reu", "preload-on-startup");

    expect(session.sendKey).toHaveBeenCalledWith("F5");
    expect(session.sendKey).toHaveBeenCalledWith("DOWN");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
  });

  it("loads into REU when the target menu item is already selected", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load into REU", selected: true, enabled: true },
              { label: "Preload on Startup", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "capture.reu" }),
    ]);

    await restoreRemoteReuFromTemp(session, "F5", "capture.reu", "load-into-reu");

    expect(session.sendKey).toHaveBeenCalledWith("F5");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
  });

  it("moves upward in the menu when the requested restore action is above the current selection", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 1,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load into REU", selected: false, enabled: true },
              { label: "Preload on Startup", selected: true, enabled: true },
            ],
          },
        ],
      }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load into REU", selected: true, enabled: true },
              { label: "Preload on Startup", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "capture.reu" }),
    ]);

    await restoreRemoteReuFromTemp(session, "F5", "capture.reu", "load-into-reu");

    expect(session.sendKey).toHaveBeenCalledWith("UP");
  });

  it("waits through delayed file-browser updates before reaching Temp", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
    ]);

    await saveRemoteReuFromTemp(session, "F5");

    expect(executeSpy).toHaveBeenCalledWith("saveReuMemory");
  });

  it("finds restore actions by label even when the menu order changes", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Preload on Startup", selected: true, enabled: true },
              { label: "Load into REU", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 1,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Preload on Startup", selected: false, enabled: true },
              { label: "Load into REU", selected: true, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "capture.reu" }),
    ]);

    await restoreRemoteReuFromTemp(session, "F5", "capture.reu", "load-into-reu");

    expect(session.sendKey).toHaveBeenCalledWith("DOWN");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
  });

  it("throws when the context menu is not visible after opening the file menu", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
    ]);

    await expect(restoreRemoteReuFromTemp(session, "F5", "capture.reu", "load-into-reu")).rejects.toMatchObject<
      Partial<TelnetError>
    >({
      code: "MENU_NOT_FOUND",
    });
  });

  it("throws when the requested context-menu action is missing", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [{ label: "Delete", selected: true, enabled: true }],
          },
        ],
      }),
    ]);

    await expect(restoreRemoteReuFromTemp(session, "F5", "capture.reu", "load-into-reu")).rejects.toMatchObject<
      Partial<TelnetError>
    >({
      code: "ITEM_NOT_FOUND",
    });
  });

  it("throws when the requested file browser item cannot be found", async () => {
    const session = createSession(Array.from({ length: 60 }, () => createScreen({ selectedItem: "Other" })));

    await expect(saveRemoteReuFromTemp(session, "F5")).rejects.toMatchObject<Partial<TelnetError>>({
      code: "TIMEOUT",
    });
  });

  it("throws when the context menu disappears during menu navigation", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({ selectedItem: "capture.reu" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load into REU", selected: true, enabled: true },
              { label: "Preload on Startup", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ menus: [], selectedItem: null }),
    ]);

    await expect(restoreRemoteReuFromTemp(session, "F5", "capture.reu", "preload-on-startup")).rejects.toMatchObject<
      Partial<TelnetError>
    >({
      code: "DESYNC",
    });
  });
});
