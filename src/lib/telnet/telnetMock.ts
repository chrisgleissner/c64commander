/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import type { TelnetTransport, MenuFixture, ScreenCell } from "@/lib/telnet/telnetTypes";
import { DEFAULT_MENU_FIXTURE, TELNET_SCREEN_WIDTH, TELNET_SCREEN_HEIGHT, TelnetError } from "@/lib/telnet/telnetTypes";

/** Mock configuration */
export interface TelnetMockOptions {
  /** Password required for authentication; null means no password */
  password?: string | null;
  /** Menu fixture data */
  menuFixture?: MenuFixture;
  /** Whether to fail on connect */
  failConnect?: boolean;
  /** Whether to fail on auth */
  failAuth?: boolean;
  /** Simulate disconnect after N sends */
  disconnectAfterSends?: number;
  /** Per-send delay in ms (0 = synchronous, default for tests) */
  sendDelayMs?: number;
  /** Missing items — actions to omit from menu for error testing */
  missingItems?: string[];
}

/** Internal menu state */
interface MockMenuState {
  open: boolean;
  categoryIndex: number;
  submenuOpen: boolean;
  actionIndex: number;
  /** Set by ESC; the next key press closes one menu level and is consumed */
  escapePending: boolean;
}

/**
 * Deterministic Telnet mock for testing.
 * Implements TelnetTransport with configurable fixtures and failure injection.
 */
export class TelnetMock implements TelnetTransport {
  private connected = false;
  private authenticated = false;
  private menu: MockMenuState = {
    open: false,
    categoryIndex: 0,
    submenuOpen: false,
    actionIndex: 0,
  };
  private fixture: MenuFixture;
  private pendingOutput: Uint8Array[] = [];
  private sendCount = 0;
  private readonly options: TelnetMockOptions;
  private password: string | null;

  constructor(options?: TelnetMockOptions) {
    this.options = options ?? {};
    this.fixture = options?.menuFixture ?? DEFAULT_MENU_FIXTURE;
    this.password = options?.password ?? null;
  }

  async connect(_host: string, _port: number): Promise<void> {
    if (this.options.failConnect) {
      throw new TelnetError("Connection refused (mock)", "CONNECTION_FAILED");
    }
    this.connected = true;
    this.authenticated = false;
    this.menu = { open: false, categoryIndex: 0, submenuOpen: false, actionIndex: 0, escapePending: false };
    this.sendCount = 0;

    // Emit Telnet init sequence + optional password prompt
    const initBytes = [0xff, 0xfe, 0x22, 0xff, 0xfb, 0x01]; // DONT LINEMODE + WILL ECHO
    const ris = [0x1b, 0x63]; // \ec (RIS)

    if (this.password !== null) {
      const prompt = new TextEncoder().encode("Password: ");
      this.pendingOutput.push(new Uint8Array([...initBytes, ...ris, ...prompt]));
    } else {
      this.authenticated = true;
      const fileBrowser = this.renderScreen();
      this.pendingOutput.push(new Uint8Array([...initBytes, ...ris, ...fileBrowser]));
    }
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.authenticated = false;
    this.pendingOutput = [];
  }

  async send(data: Uint8Array): Promise<void> {
    if (!this.connected) {
      throw new TelnetError("Not connected (mock)", "DISCONNECTED");
    }

    this.sendCount++;
    if (this.options.disconnectAfterSends && this.sendCount >= this.options.disconnectAfterSends) {
      this.connected = false;
      throw new TelnetError("Connection lost (mock)", "DISCONNECTED");
    }

    if (this.options.sendDelayMs && this.options.sendDelayMs > 0) {
      await new Promise((r) => setTimeout(r, this.options.sendDelayMs));
    }

    const text = new TextDecoder("ascii").decode(data);
    this.processInput(text);
  }

  async read(_timeoutMs: number): Promise<Uint8Array> {
    if (!this.connected) {
      throw new TelnetError("Not connected (mock)", "DISCONNECTED");
    }
    if (this.pendingOutput.length === 0) {
      return new Uint8Array(0);
    }
    // Return all pending output as one chunk
    const total = this.pendingOutput.reduce((s, c) => s + c.length, 0);
    const combined = new Uint8Array(total);
    let offset = 0;
    for (const chunk of this.pendingOutput) {
      combined.set(chunk, offset);
      offset += chunk.length;
    }
    this.pendingOutput = [];
    return combined;
  }

  isConnected(): boolean {
    return this.connected;
  }

  /** Process VT100 input and update mock state */
  private processInput(text: string): void {
    // Handle authentication
    if (!this.authenticated) {
      if (text.includes("\r") || text.includes("\n")) {
        const password = text.replace(/[\r\n]/g, "");
        if (this.options.failAuth || (this.password && password !== this.password)) {
          this.pendingOutput.push(new TextEncoder().encode("\r\nPassword incorrect\r\nPassword: "));
          return;
        }
        this.authenticated = true;
        this.pendingOutput.push(new Uint8Array(this.renderScreen()));
        return;
      }
      return;
    }

    // Handle key sequences
    // If ESC was pending, the next key closes one menu level and is consumed
    if (this.menu.escapePending && text !== "\x1b") {
      this.menu.escapePending = false;
      if (this.menu.submenuOpen) {
        this.menu.submenuOpen = false;
      } else if (this.menu.open) {
        this.menu.open = false;
      }
      this.pendingOutput.push(new Uint8Array(this.renderScreen()));
      return;
    }

    if (text === "\x1b[15~" || text === "\x1b[11~") {
      // F5 or F1 — open action menu
      this.menu.open = true;
      this.menu.categoryIndex = 0;
      this.menu.submenuOpen = false;
      this.menu.actionIndex = 0;
      this.menu.escapePending = false;
    } else if (text === "\x1b[A") {
      // UP
      if (this.menu.submenuOpen) {
        this.menu.actionIndex = Math.max(0, this.menu.actionIndex - 1);
      } else if (this.menu.open) {
        this.menu.categoryIndex = Math.max(0, this.menu.categoryIndex - 1);
      }
    } else if (text === "\x1b[B") {
      // DOWN
      if (this.menu.submenuOpen) {
        const actions = this.getVisibleActions();
        this.menu.actionIndex = Math.min(actions.length - 1, this.menu.actionIndex + 1);
      } else if (this.menu.open) {
        this.menu.categoryIndex = Math.min(this.fixture.categories.length - 1, this.menu.categoryIndex + 1);
      }
    } else if (text === "\x1b[C") {
      // RIGHT — enter submenu
      if (this.menu.open && !this.menu.submenuOpen) {
        this.menu.submenuOpen = true;
        this.menu.actionIndex = 0;
      }
    } else if (text === "\x1b[D") {
      // LEFT — leave submenu, or close top-level menu
      if (this.menu.submenuOpen) {
        this.menu.submenuOpen = false;
      } else if (this.menu.open) {
        this.menu.open = false;
      }
    } else if (text === "\r") {
      // ENTER — execute selected action
      if (this.menu.submenuOpen) {
        // Action executed — close menus
        this.menu.open = false;
        this.menu.submenuOpen = false;
      }
    } else if (text === "\x1b") {
      // ESCAPE — sets pending flag; the next key closes one menu level
      this.menu.escapePending = true;
    }

    this.pendingOutput.push(new Uint8Array(this.renderScreen()));
  }

  /** Get the visible actions for the current category, filtering out missing items */
  private getVisibleActions(): Array<{ label: string; enabled: boolean }> {
    const category = this.fixture.categories[this.menu.categoryIndex];
    if (!category) return [];
    return category.actions.filter((a) => !this.options.missingItems?.includes(a.label));
  }

  /** Render the current screen state as VT100 bytes */
  private renderScreen(): number[] {
    const encoder = new TextEncoder();
    const parts: string[] = [];

    // RIS to clear screen
    parts.push("\x1b" + "c");

    // Title line (row 1)
    parts.push("\x1b[1;1H");
    parts.push("Ultimate-II+ V3.11 — C64 Ultimate");

    // Bottom status line
    parts.push(`\x1b[${TELNET_SCREEN_HEIGHT};1H`);
    parts.push(" SD Card: Ready");

    if (this.menu.open) {
      this.renderMenuOverlay(parts);
    }

    return Array.from(encoder.encode(parts.join("")));
  }

  /** Render menu overlay VT100 sequences */
  private renderMenuOverlay(parts: string[]): void {
    const categories = this.fixture.categories;
    const menuWidth = 22;
    const menuLeft = 2;
    const menuTop = 3;
    const menuHeight = categories.length + 2; // border top + items + border bottom

    // Switch to alternate charset for border drawing
    parts.push("\x1b(0");

    // Top border
    parts.push(`\x1b[${menuTop};${menuLeft}H`);
    parts.push("l"); // top-left corner
    for (let i = 0; i < menuWidth - 2; i++) parts.push("q"); // horizontal
    parts.push("k"); // top-right corner

    // Menu items
    for (let i = 0; i < categories.length; i++) {
      const row = menuTop + 1 + i;
      parts.push(`\x1b[${row};${menuLeft}H`);
      parts.push("x"); // left border
      parts.push("\x1b(B"); // back to normal charset

      // Highlight selected item with reverse video
      if (i === this.menu.categoryIndex) {
        parts.push("\x1b[7m");
      }
      const label = categories[i].label.padEnd(menuWidth - 2);
      parts.push(label);
      if (i === this.menu.categoryIndex) {
        parts.push("\x1b[27m");
      }

      parts.push("\x1b(0"); // back to alt charset for right border
      parts.push("x"); // right border
    }

    // Bottom border
    parts.push(`\x1b[${menuTop + categories.length + 1};${menuLeft}H`);
    parts.push("m"); // bottom-left corner
    for (let i = 0; i < menuWidth - 2; i++) parts.push("q");
    parts.push("j"); // bottom-right corner

    // Back to normal charset
    parts.push("\x1b(B");

    // Render submenu if open
    if (this.menu.submenuOpen) {
      this.renderSubmenuOverlay(parts, menuLeft + menuWidth, menuTop);
    }
  }

  /** Render submenu overlay */
  private renderSubmenuOverlay(parts: string[], left: number, top: number): void {
    const actions = this.getVisibleActions();
    if (actions.length === 0) return;

    const subWidth = 22;
    const subHeight = actions.length + 2;

    // Switch to alternate charset
    parts.push("\x1b(0");

    // Top border
    parts.push(`\x1b[${top};${left}H`);
    parts.push("l");
    for (let i = 0; i < subWidth - 2; i++) parts.push("q");
    parts.push("k");

    // Action items
    for (let i = 0; i < actions.length; i++) {
      const row = top + 1 + i;
      parts.push(`\x1b[${row};${left}H`);
      parts.push("x"); // left border
      parts.push("\x1b(B"); // normal charset

      if (i === this.menu.actionIndex) {
        parts.push("\x1b[7m");
      }
      const label = actions[i].label.padEnd(subWidth - 2);
      parts.push(label);
      if (i === this.menu.actionIndex) {
        parts.push("\x1b[27m");
      }

      parts.push("\x1b(0");
      parts.push("x");
    }

    // Bottom border
    parts.push(`\x1b[${top + actions.length + 1};${left}H`);
    parts.push("m");
    for (let i = 0; i < subWidth - 2; i++) parts.push("q");
    parts.push("j");

    parts.push("\x1b(B");
  }
}
