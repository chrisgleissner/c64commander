import { describe, expect, it, vi } from "vitest";
import {
  applyRemoteConfigFromPath,
  applyRemoteConfigFromTemp,
  saveRemoteConfigFromTemp,
} from "@/lib/config/configTelnetWorkflow";
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

describe("configTelnetWorkflow", () => {
  it("waits for the file browser selection before opening Temp for saves", async () => {
    const session = createSession([
      createScreen({ selectedItem: null }),
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.cfg" }),
    ]);

    await saveRemoteConfigFromTemp(session, "F5");

    expect(session.sendKey).toHaveBeenCalledWith("HOME");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
    expect(executeSpy).toHaveBeenCalledWith("saveConfigToFile");
  });

  it("navigates to Temp before executing Save Config to File", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.cfg" }),
    ]);

    await saveRemoteConfigFromTemp(session, "F5");

    expect(session.sendKey).toHaveBeenCalledWith("HOME");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
    expect(executeSpy).toHaveBeenCalledWith("saveConfigToFile");
  });

  it("applies a config directly from /Temp", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "old.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 1,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "View", selected: false, enabled: true },
              { label: "Load Settings", selected: true, enabled: true },
              { label: "Delete", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "capture.cfg" }),
    ]);

    await applyRemoteConfigFromTemp(session, "F5", "capture.cfg");

    expect(session.sendKey).toHaveBeenCalledWith("F5");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
  });

  it("walks nested directories before applying a remote config", async () => {
    const session = createSession([
      createScreen({ selectedItem: "USB1" }),
      createScreen({ selectedItem: "USB1" }),
      createScreen({ selectedItem: "test-data" }),
      createScreen({ selectedItem: "test-data" }),
      createScreen({ selectedItem: "snapshots" }),
      createScreen({ selectedItem: "snapshots" }),
      createScreen({ selectedItem: "config.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "config.cfg" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load Settings", selected: true, enabled: true },
              { label: "View", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "config.cfg" }),
    ]);

    await applyRemoteConfigFromPath(session, "F5", "/USB1/test-data/snapshots/config.cfg");

    expect(session.sendKey).toHaveBeenCalledWith("HOME");
    expect(session.sendKey).toHaveBeenCalledWith("F5");
  });

  it("loads configs stored at the browser root without descending into directories", async () => {
    const session = createSession([
      createScreen({ selectedItem: "config.cfg" }),
      createScreen({ selectedItem: "config.cfg" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load Settings", selected: true, enabled: true },
              { label: "View", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "config.cfg" }),
    ]);

    await applyRemoteConfigFromPath(session, "F5", "/config.cfg");

    expect(session.sendKey).toHaveBeenCalledWith("HOME");
    expect(session.sendKey).toHaveBeenCalledWith("F5");
    expect(session.sendKey).not.toHaveBeenCalledWith("DOWN");
  });

  it("waits through delayed file-browser updates while opening nested config directories", async () => {
    const session = createSession([
      createScreen({ selectedItem: "USB1" }),
      createScreen({ selectedItem: "USB1" }),
      createScreen({ selectedItem: "test-data" }),
      createScreen({ selectedItem: "test-data" }),
      createScreen({ selectedItem: "snapshots" }),
      createScreen({ selectedItem: "snapshots" }),
      createScreen({ selectedItem: "config.cfg" }),
      createScreen({ selectedItem: "config.cfg" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Load Settings", selected: true, enabled: true },
              { label: "View", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "config.cfg" }),
    ]);

    await applyRemoteConfigFromPath(session, "F5", "/USB1/test-data/snapshots/config.cfg");

    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
  });

  it("finds Load Settings by label even when the menu order changes", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Delete", selected: true, enabled: true },
              { label: "View", selected: false, enabled: true },
              { label: "Load Settings", selected: false, enabled: true },
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
              { label: "Delete", selected: false, enabled: true },
              { label: "View", selected: true, enabled: true },
              { label: "Load Settings", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 2,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "Delete", selected: false, enabled: true },
              { label: "View", selected: false, enabled: true },
              { label: "Load Settings", selected: true, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "capture.cfg" }),
    ]);

    await applyRemoteConfigFromTemp(session, "F5", "capture.cfg");

    expect(session.sendKey).toHaveBeenCalledWith("DOWN");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
  });

  it("falls back to the first visible menu and navigates upward to Load Settings", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 1,
            selectedIndex: 2,
            bounds: { x: 0, y: 0, width: 12, height: 5 },
            items: [
              { label: "Delete", selected: false, enabled: true },
              { label: "Load Settings", selected: false, enabled: true },
              { label: "View", selected: true, enabled: true },
            ],
          },
        ],
      }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 1,
            selectedIndex: 1,
            bounds: { x: 0, y: 0, width: 12, height: 5 },
            items: [
              { label: "Delete", selected: false, enabled: true },
              { label: "Load Settings", selected: true, enabled: true },
              { label: "View", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "capture.cfg" }),
    ]);

    await applyRemoteConfigFromTemp(session, "F5", "capture.cfg");

    expect(session.sendKey).toHaveBeenCalledWith("UP");
    expect(session.sendKey).toHaveBeenCalledWith("ENTER");
  });

  it("throws when the requested Load Settings menu entry is missing", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
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

    await expect(applyRemoteConfigFromTemp(session, "F5", "capture.cfg")).rejects.toMatchObject<Partial<TelnetError>>({
      code: "ITEM_NOT_FOUND",
    });
  });

  it("throws when the action menu never appears after opening a config file", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
    ]);

    await expect(applyRemoteConfigFromTemp(session, "F5", "capture.cfg")).rejects.toMatchObject<Partial<TelnetError>>({
      code: "MENU_NOT_FOUND",
    });
  });

  it("throws when the action menu disappears while moving to Load Settings", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Drive A" }),
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({
        screenType: "action_menu",
        menus: [
          {
            level: 0,
            selectedIndex: 0,
            bounds: { x: 0, y: 0, width: 10, height: 4 },
            items: [
              { label: "View", selected: true, enabled: true },
              { label: "Load Settings", selected: false, enabled: true },
            ],
          },
        ],
      }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
      createScreen({ selectedItem: "capture.cfg" }),
    ]);

    await expect(applyRemoteConfigFromTemp(session, "F5", "capture.cfg")).rejects.toMatchObject<Partial<TelnetError>>({
      code: "DESYNC",
    });
  });

  it("throws when a remote config path does not include a file name", async () => {
    const session = createSession([]);

    await expect(applyRemoteConfigFromPath(session, "F5", "/")).rejects.toMatchObject<Partial<TelnetError>>({
      code: "ITEM_NOT_FOUND",
    });
  });

  it("throws when file-browser navigation stalls before reaching the target file", async () => {
    const session = createSession([
      createScreen({ selectedItem: "Temp" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
      createScreen({ selectedItem: "other.cfg" }),
    ]);

    await expect(applyRemoteConfigFromTemp(session, "F5", "capture.cfg")).rejects.toMatchObject<Partial<TelnetError>>({
      code: "TIMEOUT",
    });
  });
});
