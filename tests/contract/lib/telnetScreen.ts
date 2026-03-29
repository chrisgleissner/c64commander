/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  type MenuItem,
  type ParsedMenu,
  type ScreenCell,
  type ScreenType,
  type TelnetScreen,
  TELNET_SCREEN_HEIGHT,
  TELNET_SCREEN_WIDTH,
} from "./telnetTypes.js";

const LINE_DRAW_CHARS = new Set(["l", "k", "m", "j", "x", "q", "t", "u", "w", "v", "n"]);
const MENU_LABEL_EDGE_NOISE = /^[lkmjqx]+\s*|\s*[lkmjqx]+$/g;
const MENU_LABEL_INTERNAL_NOISE = /q{4,}/gi;

const replaceControlCharacters = (value: string) =>
  Array.from(value, (char) => (char.charCodeAt(0) < 32 ? " " : char)).join("");

interface ParserState {
  cells: ScreenCell[][];
  cursorRow: number;
  cursorCol: number;
  reverseVideo: boolean;
  currentColor: number;
  altCharset: boolean;
  pos: number;
}

function emptyCell(): ScreenCell {
  return { char: " ", reverse: false, color: 7 };
}

function createEmptyGrid(): ScreenCell[][] {
  const grid: ScreenCell[][] = [];
  for (let row = 0; row < TELNET_SCREEN_HEIGHT; row += 1) {
    const line: ScreenCell[] = [];
    for (let col = 0; col < TELNET_SCREEN_WIDTH; col += 1) {
      line.push(emptyCell());
    }
    grid.push(line);
  }
  return grid;
}

export function parseTelnetScreen(data: Uint8Array): TelnetScreen {
  const text = new TextDecoder("ascii").decode(data);
  const state: ParserState = {
    cells: createEmptyGrid(),
    cursorRow: 0,
    cursorCol: 0,
    reverseVideo: false,
    currentColor: 7,
    altCharset: false,
    pos: 0,
  };

  parseVt100Stream(text, state);

  const menus = detectMenus(state.cells);
  const selectedItem = findSelectedItem(state.cells, menus);
  const titleLine = extractLine(state.cells, 0).trimEnd();
  const screenType = classifyScreen(state.cells, menus);

  return {
    width: TELNET_SCREEN_WIDTH,
    height: TELNET_SCREEN_HEIGHT,
    cells: state.cells,
    menus,
    selectedItem,
    titleLine,
    screenType,
  };
}

export function extractVisibleLines(screen: TelnetScreen): string[] {
  return Array.from({ length: screen.height }, (_, index) => extractLine(screen.cells, index).trimEnd()).filter(
    (line) => line.trim().length > 0,
  );
}

function parseVt100Stream(text: string, state: ParserState): void {
  while (state.pos < text.length) {
    const ch = text[state.pos];

    if (ch === "\x1b") {
      state.pos += 1;
      if (state.pos >= text.length) break;
      const next = text[state.pos];
      if (next === "[") {
        state.pos += 1;
        parseCsi(text, state);
      } else if (next === "(") {
        state.pos += 1;
        if (state.pos < text.length) {
          state.altCharset = text[state.pos] === "0";
          state.pos += 1;
        }
      } else if (next === "c") {
        state.pos += 1;
        resetState(state);
      } else {
        state.pos += 1;
      }
      continue;
    }

    if (ch === "\xff") {
      state.pos += 1;
      skipTelnetCommand(text, state);
      continue;
    }

    if (ch === "\r") {
      state.cursorCol = 0;
      state.pos += 1;
      continue;
    }
    if (ch === "\n") {
      state.cursorRow = Math.min(state.cursorRow + 1, TELNET_SCREEN_HEIGHT - 1);
      state.pos += 1;
      continue;
    }
    if (ch === "\b") {
      state.cursorCol = Math.max(0, state.cursorCol - 1);
      state.pos += 1;
      continue;
    }

    putChar(state, ch);
    state.pos += 1;
  }
}

function parseCsi(text: string, state: ParserState): void {
  const params: number[] = [];
  let currentParam = "";

  while (state.pos < text.length) {
    const ch = text[state.pos];
    if (ch >= "0" && ch <= "9") {
      currentParam += ch;
      state.pos += 1;
      continue;
    }
    if (ch === ";") {
      params.push(currentParam ? Number.parseInt(currentParam, 10) : 0);
      currentParam = "";
      state.pos += 1;
      continue;
    }
    if (ch === "?") {
      state.pos += 1;
      continue;
    }
    if (currentParam) {
      params.push(Number.parseInt(currentParam, 10));
    }
    state.pos += 1;
    applyCsiCommand(ch, params, state);
    return;
  }
}

function applyCsiCommand(command: string, params: number[], state: ParserState): void {
  switch (command) {
    case "H":
    case "f": {
      const row = (params[0] || 1) - 1;
      const col = (params[1] || 1) - 1;
      state.cursorRow = clamp(row, 0, TELNET_SCREEN_HEIGHT - 1);
      state.cursorCol = clamp(col, 0, TELNET_SCREEN_WIDTH - 1);
      break;
    }
    case "A": {
      state.cursorRow = Math.max(0, state.cursorRow - (params[0] || 1));
      break;
    }
    case "B": {
      state.cursorRow = Math.min(TELNET_SCREEN_HEIGHT - 1, state.cursorRow + (params[0] || 1));
      break;
    }
    case "C": {
      state.cursorCol = Math.min(TELNET_SCREEN_WIDTH - 1, state.cursorCol + (params[0] || 1));
      break;
    }
    case "D": {
      state.cursorCol = Math.max(0, state.cursorCol - (params[0] || 1));
      break;
    }
    case "m": {
      for (const param of params.length === 0 ? [0] : params) {
        applySgr(param, state);
      }
      break;
    }
    case "J": {
      eraseDisplay(params[0] || 0, state);
      break;
    }
    case "K": {
      eraseLine(params[0] || 0, state);
      break;
    }
    default:
      break;
  }
}

function applySgr(param: number, state: ParserState): void {
  if (param === 0) {
    state.reverseVideo = false;
    state.currentColor = 7;
    return;
  }
  if (param === 7) {
    state.reverseVideo = true;
    return;
  }
  if (param === 27) {
    state.reverseVideo = false;
    return;
  }
  if (param >= 30 && param <= 37) {
    state.currentColor = param - 30;
  }
}

function eraseDisplay(mode: number, state: ParserState): void {
  if (mode !== 2) {
    return;
  }
  state.cells = createEmptyGrid();
  state.cursorRow = 0;
  state.cursorCol = 0;
}

function eraseLine(mode: number, state: ParserState): void {
  const row = state.cells[state.cursorRow];
  if (!row) {
    return;
  }
  const start = mode === 1 ? 0 : state.cursorCol;
  const end = mode === 0 ? TELNET_SCREEN_WIDTH : state.cursorCol + 1;
  for (let col = start; col < end && col < TELNET_SCREEN_WIDTH; col += 1) {
    row[col] = emptyCell();
  }
}

function resetState(state: ParserState): void {
  state.cells = createEmptyGrid();
  state.cursorRow = 0;
  state.cursorCol = 0;
  state.reverseVideo = false;
  state.currentColor = 7;
  state.altCharset = false;
}

function putChar(state: ParserState, char: string): void {
  if (state.cursorRow < 0 || state.cursorRow >= TELNET_SCREEN_HEIGHT) {
    return;
  }
  if (state.cursorCol < 0 || state.cursorCol >= TELNET_SCREEN_WIDTH) {
    return;
  }
  const printable = char.charCodeAt(0) < 32 ? " " : char;
  const normalizedChar = state.altCharset && LINE_DRAW_CHARS.has(printable) ? printable : printable;
  state.cells[state.cursorRow][state.cursorCol] = {
    char: normalizedChar,
    reverse: state.reverseVideo,
    color: state.currentColor,
  };
  state.cursorCol = Math.min(state.cursorCol + 1, TELNET_SCREEN_WIDTH - 1);
}

function skipTelnetCommand(text: string, state: ParserState): void {
  if (state.pos >= text.length) return;
  const cmd = text.charCodeAt(state.pos);
  state.pos += 1;
  if (cmd === 0xfb || cmd === 0xfc || cmd === 0xfd || cmd === 0xfe) {
    if (state.pos < text.length) state.pos += 1;
  }
}

function detectMenus(cells: ScreenCell[][]): ParsedMenu[] {
  const menus: ParsedMenu[] = [];
  const visited = new Set<string>();

  for (let row = 0; row < TELNET_SCREEN_HEIGHT; row += 1) {
    for (let col = 0; col < TELNET_SCREEN_WIDTH; col += 1) {
      const key = `${row},${col}`;
      if (visited.has(key)) {
        continue;
      }
      if (cells[row][col].char !== "l") {
        continue;
      }
      const bounds = traceMenuBounds(cells, row, col);
      if (!bounds) {
        continue;
      }
      visited.add(key);
      const items = extractMenuItems(cells, bounds);
      const selectedIndex = items.findIndex((item) => item.selected);
      menus.push({
        level: menus.length,
        items,
        selectedIndex: selectedIndex >= 0 ? selectedIndex : 0,
        bounds,
      });
    }
  }

  return menus;
}

function traceMenuBounds(
  cells: ScreenCell[][],
  startRow: number,
  startCol: number,
): { x: number; y: number; width: number; height: number } | null {
  let endCol = -1;
  for (let col = startCol + 1; col < TELNET_SCREEN_WIDTH; col += 1) {
    const char = cells[startRow][col].char;
    if (char === "k") {
      endCol = col;
      break;
    }
    if (char !== "q" && char !== "w") {
      break;
    }
  }
  if (endCol < 0) {
    return null;
  }

  let endRow = -1;
  for (let row = startRow + 1; row < TELNET_SCREEN_HEIGHT; row += 1) {
    const leftChar = cells[row][startCol].char;
    if (leftChar === "m") {
      if (cells[row][endCol].char === "j") {
        endRow = row;
      }
      break;
    }
    if (leftChar !== "x" && leftChar !== "t") {
      break;
    }
  }
  if (endRow < 0) {
    return null;
  }

  const width = endCol - startCol + 1;
  const height = endRow - startRow + 1;
  if (width < 4 || height < 3) {
    return null;
  }

  return { x: startCol, y: startRow, width, height };
}

function extractMenuItems(
  cells: ScreenCell[][],
  bounds: { x: number; y: number; width: number; height: number },
): MenuItem[] {
  const items: MenuItem[] = [];

  for (let row = bounds.y + 1; row < bounds.y + bounds.height - 1; row += 1) {
    let label = "";
    let isReverse = false;
    for (let col = bounds.x + 1; col < bounds.x + bounds.width - 1; col += 1) {
      const cell = cells[row][col];
      label += cell.char;
      if (cell.reverse) {
        isReverse = true;
      }
    }
    const normalizedLabel = replaceControlCharacters(label)
      .replace(MENU_LABEL_INTERNAL_NOISE, " ")
      .replace(MENU_LABEL_EDGE_NOISE, "")
      .replace(/\s+/g, " ")
      .trim();
    if (normalizedLabel.length === 0) {
      continue;
    }
    items.push({ label: normalizedLabel, selected: isReverse, enabled: true });
  }

  return items;
}

function findSelectedItem(cells: ScreenCell[][], menus: ParsedMenu[]): string | null {
  for (const menu of menus) {
    const selected = menu.items.find((item) => item.selected);
    if (selected) {
      return selected.label;
    }
  }
  for (let row = 0; row < TELNET_SCREEN_HEIGHT; row += 1) {
    const line = cells[row];
    if (!line.some((cell) => cell.reverse)) {
      continue;
    }
    const label = replaceControlCharacters(line.map((cell) => cell.char).join(""))
      .replace(/\s+/g, " ")
      .trim();
    if (label.length > 0) {
      return label;
    }
  }
  return null;
}

function extractLine(cells: ScreenCell[][], row: number): string {
  if (row < 0 || row >= TELNET_SCREEN_HEIGHT) {
    return "";
  }
  return cells[row].map((cell) => cell.char).join("");
}

function classifyScreen(cells: ScreenCell[][], menus: ParsedMenu[]): ScreenType {
  if (menus.length > 0) {
    return "action_menu";
  }
  const bottomLine = extractLine(cells, TELNET_SCREEN_HEIGHT - 1);
  if (bottomLine.trim().length > 0) {
    return "file_browser";
  }
  return "unknown";
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
