/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

export const TELNET_SCREEN_WIDTH = 60;
export const TELNET_SCREEN_HEIGHT = 24;
export const TELNET_DEFAULT_PORT = 23;

export const TELNET_KEYS = {
  F1: "\x1b[11~",
  F5: "\x1b[15~",
  UP: "\x1b[A",
  DOWN: "\x1b[B",
  RIGHT: "\x1b[C",
  LEFT: "\x1b[D",
  ENTER: "\r",
  ESCAPE: "\x1b",
} as const;

export type TelnetKeyName = keyof typeof TELNET_KEYS;

export interface ScreenCell {
  char: string;
  reverse: boolean;
  color: number;
}

export interface MenuItem {
  label: string;
  selected: boolean;
  enabled: boolean;
}

export interface ParsedMenu {
  level: number;
  items: MenuItem[];
  selectedIndex: number;
  bounds: { x: number; y: number; width: number; height: number };
}

export type ScreenType = "file_browser" | "action_menu" | "unknown";

export interface TelnetScreen {
  width: typeof TELNET_SCREEN_WIDTH;
  height: typeof TELNET_SCREEN_HEIGHT;
  cells: ScreenCell[][];
  menus: ParsedMenu[];
  selectedItem: string | null;
  titleLine: string;
  screenType: ScreenType;
}

export interface BrowserEntryFixture {
  name: string;
  type: "directory" | "file";
}

export interface MenuTreeNode {
  items: string[];
  defaultItem: string;
  submenus?: Record<string, MenuTreeNode>;
}

export interface FilesystemContextMenuFixture {
  path: string;
  browserPath: string;
  selectedEntry: string;
  menuItems: string[];
  defaultItem: string;
}

export interface FileContextMenuDefinition {
  representativeFile: string;
  items: string[];
  defaultItem: string;
}

export type MenuFixture = {
  titleLine: string;
  browser: {
    directories: Record<string, BrowserEntryFixture[]>;
  };
  initialActionMenu: MenuTreeNode;
  selectedDirectoryActionMenu: MenuTreeNode;
  filesystemContextMenus: {
    selectedDirectory: FilesystemContextMenuFixture;
    menuDefinitions: Record<string, FileContextMenuDefinition>;
  };
};

export const DEFAULT_MENU_FIXTURE: MenuFixture = {
  titleLine: "     *** C64 Ultimate (V1.49) 1.1.0 *** Remote ***",
  browser: {
    directories: {
      "/": [
        { name: "SD", type: "directory" },
        { name: "Flash", type: "directory" },
        { name: "Temp", type: "directory" },
        { name: "USB1", type: "directory" },
      ],
      "/SD": [],
      "/Flash": [],
      "/Temp": [],
      "/USB1": [{ name: "test-data", type: "directory" }],
      "/USB1/test-data": [
        { name: "SID", type: "directory" },
        { name: "crt", type: "directory" },
        { name: "d64", type: "directory" },
        { name: "d71", type: "directory" },
        { name: "d81", type: "directory" },
        { name: "mod", type: "directory" },
        { name: "prg", type: "directory" },
        { name: "snapshots", type: "directory" },
      ],
      "/USB1/test-data/SID": [
        { name: "10_Orbyte.sid", type: "file" },
        { name: "HVSC_77-all-of-them.7z", type: "file" },
      ],
      "/USB1/test-data/crt": [{ name: "266_Cabal_1989_Ocean.crt", type: "file" }],
      "/USB1/test-data/d64": [{ name: "Boulder Dash 1 (Nostalgia).d64", type: "file" }],
      "/USB1/test-data/d71": [{ name: "10_Years_HVSC.d71", type: "file" }],
      "/USB1/test-data/d81": [{ name: "10_Years_HVSC.d81", type: "file" }],
      "/USB1/test-data/mod": [{ name: "jukebox_packtune.mod", type: "file" }],
      "/USB1/test-data/prg": [{ name: "1k-mini-bdash-note.prg", type: "file" }],
      "/USB1/test-data/snapshots": [{ name: "reu.reu", type: "file" }],
    },
  },
  initialActionMenu: {
    items: [
      "Power & Reset",
      "Built-in Drive A",
      "Built-in Drive B",
      "Software IEC",
      "Printer",
      "Configuration",
      "Streams",
      "Developer",
      "Return to Main Menu",
    ],
    defaultItem: "Power & Reset",
    submenus: {
      "Power & Reset": {
        items: [
          "Reset C64",
          "Reboot C64",
          "Reboot (Clr Mem)",
          "Power OFF",
          "Power Cycle",
          "Save C64 Memory",
          "Save REU Memory",
        ],
        defaultItem: "Reset C64",
      },
      "Built-in Drive A": {
        items: ["Turn Off", "Reset", "Switch to 1571", "Switch to 1581", "Insert Blank"],
        defaultItem: "Turn Off",
      },
      "Built-in Drive B": {
        items: ["Turn On", "Switch to 1541", "Switch to 1571", "Switch to 1581"],
        defaultItem: "Turn On",
      },
      "Software IEC": {
        items: ["Turn On", "Reset", "Set dir. here"],
        defaultItem: "Turn On",
      },
      Printer: {
        items: ["Flush/Eject", "Reset", "Turn On"],
        defaultItem: "Flush/Eject",
      },
      Configuration: {
        items: ["Save to Flash", "Save to File", "Reset from Flash", "Reset to Defaults", "Clear Flash Config"],
        defaultItem: "Save to Flash",
      },
      Streams: {
        items: ["VIC Stream", "Audio Stream"],
        defaultItem: "VIC Stream",
      },
      Developer: {
        items: ["Clear Debug Log", "Save Debug Log", "Save EDID to file", "Debug Stream"],
        defaultItem: "Clear Debug Log",
      },
    },
  },
  selectedDirectoryActionMenu: {
    items: [
      "Create",
      "Power & Reset",
      "Built-in Drive A",
      "Built-in Drive B",
      "Software IEC",
      "UltiCopy",
      "Tape",
      "Printer",
      "Configuration",
      "Streams",
      "Developer",
      "Return to Main Menu",
    ],
    defaultItem: "Create",
    submenus: {
      Create: {
        items: [
          "D64 Image",
          "G64 Image",
          "D71 Image",
          "G71 Image",
          "D81 Image",
          "D81 (81 Tr.)",
          "DNP Image",
          "Directory",
        ],
        defaultItem: "D64 Image",
      },
      "Power & Reset": {
        items: [
          "Reset C64",
          "Reboot C64",
          "Reboot (Clr Mem)",
          "Power OFF",
          "Power Cycle",
          "Save C64 Memory",
          "Save REU Memory",
          "Save Cartridge",
          "Save MP3 Drv D",
        ],
        defaultItem: "Reset C64",
      },
      "Built-in Drive A": {
        items: ["Turn Off", "Reset", "Switch to 1571", "Switch to 1581", "Insert Blank"],
        defaultItem: "Turn Off",
      },
      "Built-in Drive B": {
        items: ["Turn On", "Switch to 1541", "Switch to 1571", "Switch to 1581"],
        defaultItem: "Turn On",
      },
      "Software IEC": {
        items: ["Turn On", "Reset", "Set dir. here"],
        defaultItem: "Turn On",
      },
      UltiCopy: {
        items: ["Drive 8", "Drive 9", "Drive 10", "Drive 11"],
        defaultItem: "Drive 8",
      },
      Tape: {
        items: ["Sample tape to TAP", "Capture save to TAP"],
        defaultItem: "Sample tape to TAP",
      },
      Printer: {
        items: ["Flush/Eject", "Reset", "Turn On"],
        defaultItem: "Flush/Eject",
      },
      Configuration: {
        items: ["Save to Flash", "Save to File", "Reset from Flash", "Reset to Defaults", "Clear Flash Config"],
        defaultItem: "Save to Flash",
      },
      Streams: {
        items: ["VIC Stream", "Audio Stream"],
        defaultItem: "VIC Stream",
      },
      Developer: {
        items: ["Clear Debug Log", "Save Debug Log", "Save EDID to file", "Debug Stream"],
        defaultItem: "Clear Debug Log",
      },
    },
  },
  filesystemContextMenus: {
    selectedDirectory: {
      path: "/USB1/test-data",
      browserPath: "/USB1/",
      selectedEntry: "test-data",
      menuItems: ["Enter", "Rename", "Delete"],
      defaultItem: "Enter",
    },
    menuDefinitions: {
      archive_7z: {
        representativeFile: "/USB1/test-data/SID/HVSC_77-all-of-them.7z",
        items: ["Rename", "Delete"],
        defaultItem: "Rename",
      },
      crt: {
        representativeFile: "/USB1/test-data/crt/266_Cabal_1989_Ocean.crt",
        items: ["Run Cart", "Copy to Flash", "View", "Rename", "Delete"],
        defaultItem: "Run Cart",
      },
      d64: {
        representativeFile: "/USB1/test-data/d64/Boulder Dash 1 (Nostalgia).d64",
        items: [
          "Run Disk",
          "Mount Disk",
          "Mount Disk Read Only",
          "Mount Disk Unlinked",
          "Mount Disk on B",
          "Mount Disk R/O on B",
          "Mount Disk Unl. on B",
          "Load into MP3 Drv D",
          "View",
          "Rename",
          "Delete",
        ],
        defaultItem: "Run Disk",
      },
      d71: {
        representativeFile: "/USB1/test-data/d71/10_Years_HVSC.d71",
        items: [
          "Run Disk",
          "Mount Disk",
          "Mount Disk Read Only",
          "Mount Disk Unlinked",
          "Mount Disk on B",
          "Mount Disk R/O on B",
          "Mount Disk Unl. on B",
          "Rename",
          "Delete",
        ],
        defaultItem: "Run Disk",
      },
      d81: {
        representativeFile: "/USB1/test-data/d81/10_Years_HVSC.d81",
        items: [
          "Run Disk",
          "Mount Disk",
          "Mount Disk Read Only",
          "Mount Disk Unlinked",
          "Mount Disk on B",
          "Mount Disk R/O on B",
          "Mount Disk Unl. on B",
          "Rename",
          "Delete",
        ],
        defaultItem: "Run Disk",
      },
      mod: {
        representativeFile: "/USB1/test-data/mod/jukebox_packtune.mod",
        items: ["Play MOD", "Load into REU", "Preload on Startup", "View", "Rename", "Delete"],
        defaultItem: "Play MOD",
      },
      prg: {
        representativeFile: "/USB1/test-data/prg/1k-mini-bdash-note.prg",
        items: ["Run", "Load", "DMA", "View", "Rename", "Delete"],
        defaultItem: "Run",
      },
      sid: {
        representativeFile: "/USB1/test-data/SID/10_Orbyte.sid",
        items: ["Play Main Tune", "Show Info", "View", "Rename", "Delete"],
        defaultItem: "Play Main Tune",
      },
      reu: {
        representativeFile: "/USB1/test-data/snapshots/reu.reu",
        items: ["Load into REU", "Preload on Startup", "Rename", "Delete"],
        defaultItem: "Load into REU",
      },
    },
  },
};

export class ContractTelnetError extends Error {
  constructor(
    message: string,
    readonly code: "CONNECTION_FAILED" | "AUTH_FAILED" | "TIMEOUT" | "DISCONNECTED" | "INVALID_SCREEN",
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ContractTelnetError";
  }
}
