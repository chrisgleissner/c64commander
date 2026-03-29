/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import net from "node:net";
import path from "node:path";
import {
  DEFAULT_MENU_FIXTURE,
  TELNET_SCREEN_HEIGHT,
  type BrowserEntryFixture,
  type MenuFixture,
  type MenuTreeNode,
} from "./lib/telnetTypes.js";

type MockTelnetServerOptions = {
  host?: string;
  port?: number;
  password?: string;
  menuFixture?: MenuFixture;
};

export type MockTelnetServer = {
  host: string;
  port: number;
  close: () => Promise<void>;
};

type OverlayState =
  | { kind: "none" }
  | { kind: "action_menu"; categoryIndex: number; submenuOpen: boolean; actionIndex: number }
  | { kind: "context_menu"; items: string[]; selectedIndex: number };

type ConnectionState = {
  authenticated: boolean;
  currentPath: string;
  selectedIndexByPath: Record<string, number>;
  overlay: OverlayState;
  escapePending: boolean;
};

const INIT_BYTES = new Uint8Array([0xff, 0xfe, 0x22, 0xff, 0xfb, 0x01, 0x1b, 0x63]);

export async function createMockTelnetServer(options: MockTelnetServerOptions = {}): Promise<MockTelnetServer> {
  const host = options.host ?? "127.0.0.1";
  const fixture = options.menuFixture ?? DEFAULT_MENU_FIXTURE;
  const password = options.password ?? "";
  const sockets = new Set<net.Socket>();

  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });

    const state: ConnectionState = {
      authenticated: password.length === 0,
      currentPath: "/",
      selectedIndexByPath: {},
      overlay: { kind: "none" },
      escapePending: false,
    };

    if (state.authenticated) {
      socket.write(Buffer.concat([Buffer.from(INIT_BYTES), Buffer.from(renderScreen(fixture, state))]));
    } else {
      socket.write(Buffer.concat([Buffer.from(INIT_BYTES), Buffer.from(new TextEncoder().encode("Password: "))]));
    }

    socket.on("data", (chunk) => {
      const text = new TextDecoder("ascii").decode(chunk);
      if (!state.authenticated) {
        if (text.includes("\r") || text.includes("\n")) {
          const attempt = text.replace(/[\r\n]/g, "");
          if (attempt !== password) {
            socket.write(Buffer.from(new TextEncoder().encode("\r\nPassword incorrect\r\nPassword: ")));
            return;
          }
          state.authenticated = true;
          socket.write(Buffer.from(renderScreen(fixture, state)));
        }
        return;
      }

      processInput(text, state, fixture);
      socket.write(Buffer.from(renderScreen(fixture, state)));
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to start mock Telnet server");
  }

  return {
    host,
    port: address.port,
    close: async () => {
      for (const socket of sockets) {
        socket.destroy();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}

function processInput(text: string, state: ConnectionState, fixture: MenuFixture): void {
  if (state.escapePending && text !== "\x1b") {
    state.escapePending = false;
    state.overlay = { kind: "none" };
    return;
  }

  if (text === "\x1b[15~" || text === "\x1b[11~") {
    state.overlay = {
      kind: "action_menu",
      categoryIndex: 0,
      submenuOpen: false,
      actionIndex: 0,
    };
    state.escapePending = false;
    return;
  }

  if (state.overlay.kind === "action_menu") {
    processActionMenuInput(text, state, fixture);
    return;
  }

  if (state.overlay.kind === "context_menu") {
    processContextMenuInput(text, state, fixture);
    return;
  }

  if (text === "\x1b[A") {
    moveSelection(state, fixture, -1);
    return;
  }

  if (text === "\x1b[B") {
    moveSelection(state, fixture, 1);
    return;
  }

  if (text === "\x1b[C") {
    if (state.currentPath === "/") {
      enterSelectedDirectory(state, fixture);
    }
    return;
  }

  if (text === "\x1b[D") {
    if (state.currentPath !== "/") {
      state.currentPath = path.posix.dirname(state.currentPath) || "/";
    }
    return;
  }

  if (text === "\r") {
    openContextMenu(state, fixture);
    return;
  }

  if (text === "\x1b") {
    state.escapePending = true;
  }
}

function processActionMenuInput(text: string, state: ConnectionState, fixture: MenuFixture): void {
  const overlay = state.overlay;
  if (overlay.kind !== "action_menu") {
    return;
  }

  const menu = getVisibleActionMenu(fixture, state);
  if (text === "\x1b[A") {
    if (overlay.submenuOpen) {
      overlay.actionIndex = Math.max(0, overlay.actionIndex - 1);
    } else {
      overlay.categoryIndex = Math.max(0, overlay.categoryIndex - 1);
    }
    return;
  }

  if (text === "\x1b[B") {
    if (overlay.submenuOpen) {
      const submenu = getVisibleSubmenu(menu, overlay.categoryIndex);
      overlay.actionIndex = submenu.items.length > 0 ? Math.min(submenu.items.length - 1, overlay.actionIndex + 1) : 0;
    } else {
      overlay.categoryIndex = Math.min(menu.items.length - 1, overlay.categoryIndex + 1);
    }
    return;
  }

  if (text === "\x1b[C") {
    const submenu = getVisibleSubmenu(menu, overlay.categoryIndex);
    if (submenu.items.length > 0) {
      overlay.submenuOpen = true;
      overlay.actionIndex = Math.max(0, submenu.items.indexOf(submenu.defaultItem));
    }
    return;
  }

  if (text === "\x1b[D") {
    if (overlay.submenuOpen) {
      overlay.submenuOpen = false;
    } else {
      state.overlay = { kind: "none" };
    }
    return;
  }

  if (text === "\r") {
    state.overlay = { kind: "none" };
    return;
  }

  if (text === "\x1b") {
    state.escapePending = true;
  }
}

function processContextMenuInput(text: string, state: ConnectionState, fixture: MenuFixture): void {
  const overlay = state.overlay;
  if (overlay.kind !== "context_menu") {
    return;
  }

  if (text === "\x1b[A") {
    overlay.selectedIndex = Math.max(0, overlay.selectedIndex - 1);
    return;
  }

  if (text === "\x1b[B") {
    overlay.selectedIndex =
      overlay.items.length > 0 ? Math.min(overlay.items.length - 1, overlay.selectedIndex + 1) : 0;
    return;
  }

  if (text === "\x1b[D") {
    state.overlay = { kind: "none" };
    return;
  }

  if (text === "\r") {
    const selectedItem = overlay.items[overlay.selectedIndex] ?? null;
    if (selectedItem === "Enter") {
      enterSelectedDirectory(state, fixture);
    }
    state.overlay = { kind: "none" };
    return;
  }

  if (text === "\x1b") {
    state.escapePending = true;
  }
}

function moveSelection(state: ConnectionState, fixture: MenuFixture, delta: number): void {
  const entries = getVisibleEntries(fixture, state.currentPath);
  const current = state.selectedIndexByPath[state.currentPath] ?? 0;
  const next = Math.max(0, Math.min(entries.length - 1, current + delta));
  state.selectedIndexByPath[state.currentPath] = next;
}

function enterSelectedDirectory(state: ConnectionState, fixture: MenuFixture): void {
  const selected = getSelectedEntry(fixture, state);
  if (!selected || selected.type !== "directory") {
    return;
  }
  state.currentPath = joinPath(state.currentPath, selected.name);
}

function openContextMenu(state: ConnectionState, fixture: MenuFixture): void {
  const selected = getSelectedEntry(fixture, state);
  if (!selected || state.currentPath === "/") {
    return;
  }
  const definition = getContextMenuDefinition(fixture, state.currentPath, selected);
  state.overlay = {
    kind: "context_menu",
    items: definition.items,
    selectedIndex: Math.max(0, definition.items.indexOf(definition.defaultItem)),
  };
}

function getVisibleEntries(fixture: MenuFixture, currentPath: string): BrowserEntryFixture[] {
  return fixture.browser.directories[currentPath] ?? [];
}

function getSelectedEntry(fixture: MenuFixture, state: ConnectionState): BrowserEntryFixture | null {
  const entries = getVisibleEntries(fixture, state.currentPath);
  const index = state.selectedIndexByPath[state.currentPath] ?? 0;
  return entries[index] ?? null;
}

function getVisibleActionMenu(fixture: MenuFixture, state: ConnectionState): MenuTreeNode {
  return state.currentPath === "/" ? fixture.initialActionMenu : fixture.selectedDirectoryActionMenu;
}

function getVisibleSubmenu(menu: MenuTreeNode, categoryIndex: number): MenuTreeNode {
  const category = menu.items[categoryIndex];
  return menu.submenus?.[category] ?? { items: [], defaultItem: "" };
}

function getContextMenuDefinition(
  fixture: MenuFixture,
  currentPath: string,
  entry: BrowserEntryFixture,
): { items: string[]; defaultItem: string } {
  if (entry.type === "directory") {
    return {
      items: fixture.filesystemContextMenus.selectedDirectory.menuItems,
      defaultItem: fixture.filesystemContextMenus.selectedDirectory.defaultItem,
    };
  }

  const entryPath = joinPath(currentPath, entry.name);
  const definition = Object.values(fixture.filesystemContextMenus.menuDefinitions).find(
    (candidate) => candidate.representativeFile === entryPath,
  );
  return definition ?? { items: ["Rename", "Delete"], defaultItem: "Rename" };
}

function renderScreen(fixture: MenuFixture, state: ConnectionState): Uint8Array {
  const parts: string[] = [];
  parts.push("\x1b" + "c");
  parts.push("\x1b[1;1H");
  parts.push(fixture.titleLine);
  parts.push("\x1b(0");
  parts.push("\x1b[2;1H");
  parts.push("q".repeat(60));
  parts.push("\x1b[3;1H");
  parts.push("l" + "q".repeat(58) + "k");
  parts.push("\x1b(B");
  renderBrowser(parts, fixture, state);
  parts.push(`\x1b[${TELNET_SCREEN_HEIGHT};1H`);
  parts.push(" Ready.");

  if (state.overlay.kind === "action_menu") {
    renderActionMenuOverlay(parts, fixture, state.overlay, state.currentPath);
  }
  if (state.overlay.kind === "context_menu") {
    renderContextMenuOverlay(parts, state.overlay);
  }

  return new TextEncoder().encode(parts.join(""));
}

function renderBrowser(parts: string[], fixture: MenuFixture, state: ConnectionState): void {
  const entries = getVisibleEntries(fixture, state.currentPath);
  const selectedIndex = state.selectedIndexByPath[state.currentPath] ?? 0;
  const visibleRows = Math.max(1, TELNET_SCREEN_HEIGHT - 6);
  const lastRow = 3 + visibleRows + 1;

  for (let index = 0; index < visibleRows; index += 1) {
    const row = 4 + index;
    const entry = entries[index];
    parts.push(`\x1b[${row};1H`);
    parts.push("\x1b(0x\x1b(B");
    if (entry) {
      if (index === selectedIndex) {
        parts.push("\x1b[7m");
      }
      parts.push(entry.name.padEnd(58, " ").slice(0, 58));
      if (index === selectedIndex) {
        parts.push("\x1b[0m");
      }
    } else {
      parts.push(" ".repeat(58));
    }
    parts.push("\x1b(0x\x1b(B");
  }

  parts.push("\x1b(0");
  parts.push(`\x1b[${lastRow};1H`);
  parts.push("m" + "q".repeat(58) + "j");
  parts.push("\x1b(B");
}

function renderActionMenuOverlay(
  parts: string[],
  fixture: MenuFixture,
  overlay: Extract<OverlayState, { kind: "action_menu" }>,
  currentPath: string,
): void {
  const menu = currentPath === "/" ? fixture.initialActionMenu : fixture.selectedDirectoryActionMenu;
  const categories = menu.items;
  const menuWidth = 22;
  const menuLeft = 2;
  const menuTop = 3;
  const menuHeight = categories.length + 2;

  parts.push("\x1b(0");
  parts.push(`\x1b[${menuTop};${menuLeft}H`);
  parts.push("l" + "q".repeat(menuWidth - 2) + "k");
  parts.push("\x1b(B");

  for (let index = 0; index < categories.length; index += 1) {
    const row = menuTop + index + 1;
    const category = categories[index] ?? "";
    parts.push(`\x1b[${row};${menuLeft}H`);
    parts.push("\x1b(0x\x1b(B");
    if (index === overlay.categoryIndex && !overlay.submenuOpen) {
      parts.push("\x1b[7m");
    }
    parts.push(category.padEnd(menuWidth - 2, " ").slice(0, menuWidth - 2));
    if (index === overlay.categoryIndex && !overlay.submenuOpen) {
      parts.push("\x1b[0m");
    }
    parts.push("\x1b(0x\x1b(B");
  }

  parts.push("\x1b(0");
  parts.push(`\x1b[${menuTop + menuHeight - 1};${menuLeft}H`);
  parts.push("m" + "q".repeat(menuWidth - 2) + "j");

  if (overlay.submenuOpen) {
    const actions = getVisibleSubmenu(menu, overlay.categoryIndex).items;
    const submenuWidth = 24;
    const submenuLeft = menuLeft + menuWidth - 1;
    const submenuTop = menuTop + overlay.categoryIndex;
    const submenuHeight = actions.length + 2;

    parts.push(`\x1b[${submenuTop};${submenuLeft}H`);
    parts.push("l" + "q".repeat(submenuWidth - 2) + "k");
    parts.push("\x1b(B");
    for (let index = 0; index < actions.length; index += 1) {
      const row = submenuTop + index + 1;
      const action = actions[index] ?? "";
      parts.push(`\x1b[${row};${submenuLeft}H`);
      parts.push("\x1b(0x\x1b(B");
      if (index === overlay.actionIndex) {
        parts.push("\x1b[7m");
      }
      parts.push(action.padEnd(submenuWidth - 2, " ").slice(0, submenuWidth - 2));
      if (index === overlay.actionIndex) {
        parts.push("\x1b[0m");
      }
      parts.push("\x1b(0x\x1b(B");
    }
    parts.push("\x1b(0");
    parts.push(`\x1b[${submenuTop + submenuHeight - 1};${submenuLeft}H`);
    parts.push("m" + "q".repeat(submenuWidth - 2) + "j");
  }

  parts.push("\x1b(B");
}

function renderContextMenuOverlay(parts: string[], overlay: Extract<OverlayState, { kind: "context_menu" }>): void {
  const widestItem = overlay.items.reduce((maxWidth, item) => Math.max(maxWidth, item.length), 0);
  const menuWidth = Math.max(20, Math.min(32, widestItem + 4));
  const menuLeft = 20;
  const menuTop = 6;

  parts.push("\x1b(0");
  parts.push(`\x1b[${menuTop};${menuLeft}H`);
  parts.push("l" + "q".repeat(menuWidth - 2) + "k");
  parts.push("\x1b(B");
  for (let index = 0; index < overlay.items.length; index += 1) {
    const row = menuTop + index + 1;
    const item = overlay.items[index] ?? "";
    parts.push(`\x1b[${row};${menuLeft}H`);
    parts.push("\x1b(0x\x1b(B");
    if (index === overlay.selectedIndex) {
      parts.push("\x1b[7m");
    }
    parts.push(item.padEnd(menuWidth - 2, " ").slice(0, menuWidth - 2));
    if (index === overlay.selectedIndex) {
      parts.push("\x1b[0m");
    }
    parts.push("\x1b(0x\x1b(B");
  }
  parts.push("\x1b(0");
  parts.push(`\x1b[${menuTop + overlay.items.length + 1};${menuLeft}H`);
  parts.push("m" + "q".repeat(menuWidth - 2) + "j");
  parts.push("\x1b(B");
}

function joinPath(currentPath: string, name: string): string {
  return currentPath === "/" ? `/${name}` : `${currentPath}/${name}`;
}
