/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  type TelnetScreen,
  type ScreenCell,
  type ParsedMenu,
  type MenuItem,
  type ScreenType,
  TELNET_SCREEN_WIDTH,
  TELNET_SCREEN_HEIGHT,
} from '@/lib/telnet/telnetTypes';

/**
 * VT100 line-drawing characters in alternate charset mode.
 * When \e(0 is active, these ASCII chars map to box-drawing glyphs.
 */
const LINE_DRAW_CHARS = new Set([
  'l', // ┌ top-left corner
  'k', // ┐ top-right corner
  'm', // └ bottom-left corner
  'j', // ┘ bottom-right corner
  'x', // │ vertical line
  'q', // ─ horizontal line
  't', // ├ tee right
  'u', // ┤ tee left
  'w', // ┬ tee down
  'v', // ┴ tee up
  'n', // ┼ crossing
]);

/** Parser state for VT100 escape sequence processing */
interface ParserState {
  cells: ScreenCell[][];
  cursorRow: number;
  cursorCol: number;
  reverseVideo: boolean;
  currentColor: number;
  altCharset: boolean;
  pos: number;
}

/** Create an empty screen cell */
function emptyCell(): ScreenCell {
  return { char: ' ', reverse: false, color: 7 };
}

/** Create a fresh 60×24 cell grid */
function createEmptyGrid(): ScreenCell[][] {
  const grid: ScreenCell[][] = [];
  for (let row = 0; row < TELNET_SCREEN_HEIGHT; row++) {
    const rowCells: ScreenCell[] = [];
    for (let col = 0; col < TELNET_SCREEN_WIDTH; col++) {
      rowCells.push(emptyCell());
    }
    grid.push(rowCells);
  }
  return grid;
}

/** Parse a VT100 data stream into a TelnetScreen */
export function parseTelnetScreen(data: Uint8Array): TelnetScreen {
  const text = new TextDecoder('ascii').decode(data);
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
  const form = null; // CommoServe form detection added in Phase 4
  const selectedItem = findSelectedItem(state.cells, menus);
  const titleLine = extractLine(state.cells, 0);
  const screenType = classifyScreen(state.cells, menus);

  return {
    width: TELNET_SCREEN_WIDTH,
    height: TELNET_SCREEN_HEIGHT,
    cells: state.cells,
    menus,
    form,
    selectedItem,
    titleLine,
    screenType,
  };
}

/** Process VT100 escape sequences and character data */
function parseVt100Stream(text: string, state: ParserState): void {
  const len = text.length;
  while (state.pos < len) {
    const ch = text[state.pos];

    if (ch === '\x1b') {
      // Escape sequence
      state.pos++;
      if (state.pos >= len) break;

      const next = text[state.pos];

      if (next === '[') {
        // CSI sequence
        state.pos++;
        parseCsi(text, state);
      } else if (next === '(') {
        // Character set designation
        state.pos++;
        if (state.pos < len) {
          state.altCharset = text[state.pos] === '0';
          state.pos++;
        }
      } else if (next === 'c') {
        // RIS — Reset to Initial State
        state.pos++;
        resetState(state);
      } else {
        state.pos++;
      }
    } else if (ch === '\xff') {
      // Telnet IAC — skip command sequences
      state.pos++;
      skipTelnetCommand(text, state);
    } else if (ch === '\r') {
      state.cursorCol = 0;
      state.pos++;
    } else if (ch === '\n') {
      state.cursorRow = Math.min(state.cursorRow + 1, TELNET_SCREEN_HEIGHT - 1);
      state.pos++;
    } else if (ch === '\b') {
      state.cursorCol = Math.max(0, state.cursorCol - 1);
      state.pos++;
    } else {
      // Regular character
      putChar(state, ch);
      state.pos++;
    }
  }
}

/** Parse a CSI (Control Sequence Introducer) sequence */
function parseCsi(text: string, state: ParserState): void {
  const params: number[] = [];
  let currentParam = '';

  while (state.pos < text.length) {
    const ch = text[state.pos];

    if (ch >= '0' && ch <= '9') {
      currentParam += ch;
      state.pos++;
    } else if (ch === ';') {
      params.push(currentParam ? parseInt(currentParam, 10) : 0);
      currentParam = '';
      state.pos++;
    } else if (ch === '?') {
      // Private mode prefix — skip
      state.pos++;
    } else {
      // Final character
      if (currentParam) params.push(parseInt(currentParam, 10));
      state.pos++;
      applyCsiCommand(ch, params, state);
      return;
    }
  }
}

/** Apply a CSI command to the parser state */
function applyCsiCommand(
  command: string,
  params: number[],
  state: ParserState,
): void {
  switch (command) {
    case 'H':
    case 'f': {
      // Cursor position (1-based)
      const row = (params[0] || 1) - 1;
      const col = (params[1] || 1) - 1;
      state.cursorRow = clamp(row, 0, TELNET_SCREEN_HEIGHT - 1);
      state.cursorCol = clamp(col, 0, TELNET_SCREEN_WIDTH - 1);
      break;
    }
    case 'A': {
      // Cursor up
      const n = params[0] || 1;
      state.cursorRow = Math.max(0, state.cursorRow - n);
      break;
    }
    case 'B': {
      // Cursor down
      const n = params[0] || 1;
      state.cursorRow = Math.min(TELNET_SCREEN_HEIGHT - 1, state.cursorRow + n);
      break;
    }
    case 'C': {
      // Cursor forward
      const n = params[0] || 1;
      state.cursorCol = Math.min(TELNET_SCREEN_WIDTH - 1, state.cursorCol + n);
      break;
    }
    case 'D': {
      // Cursor backward
      const n = params[0] || 1;
      state.cursorCol = Math.max(0, state.cursorCol - n);
      break;
    }
    case 'm': {
      // SGR — Set Graphics Rendition
      if (params.length === 0) params.push(0);
      for (const p of params) {
        applySgr(p, state);
      }
      break;
    }
    case 'J': {
      // Erase in display
      const mode = params[0] || 0;
      eraseDisplay(mode, state);
      break;
    }
    case 'K': {
      // Erase in line
      const mode = params[0] || 0;
      eraseLine(mode, state);
      break;
    }
    case '~': {
      // Function key — ignore in parser (these are input, not output)
      break;
    }
    case 'l':
    case 'h': {
      // Set/reset mode — ignore
      break;
    }
    default:
      // Unknown CSI command — ignore
      break;
  }
}

/** Apply SGR (Select Graphic Rendition) parameters */
function applySgr(param: number, state: ParserState): void {
  if (param === 0) {
    // Reset
    state.reverseVideo = false;
    state.currentColor = 7;
  } else if (param === 7) {
    state.reverseVideo = true;
  } else if (param === 27) {
    state.reverseVideo = false;
  } else if (param >= 30 && param <= 37) {
    state.currentColor = param - 30;
  } else if (param >= 40 && param <= 47) {
    // Background color — store in color field
    state.currentColor = param - 40;
  }
}

/** Erase part of the display */
function eraseDisplay(mode: number, state: ParserState): void {
  if (mode === 0) {
    // From cursor to end
    for (let col = state.cursorCol; col < TELNET_SCREEN_WIDTH; col++) {
      state.cells[state.cursorRow][col] = emptyCell();
    }
    for (let row = state.cursorRow + 1; row < TELNET_SCREEN_HEIGHT; row++) {
      for (let col = 0; col < TELNET_SCREEN_WIDTH; col++) {
        state.cells[row][col] = emptyCell();
      }
    }
  } else if (mode === 1) {
    // From start to cursor
    for (let row = 0; row < state.cursorRow; row++) {
      for (let col = 0; col < TELNET_SCREEN_WIDTH; col++) {
        state.cells[row][col] = emptyCell();
      }
    }
    for (let col = 0; col <= state.cursorCol; col++) {
      state.cells[state.cursorRow][col] = emptyCell();
    }
  } else if (mode === 2) {
    // Entire display
    state.cells = createEmptyGrid();
  }
}

/** Erase part of the current line */
function eraseLine(mode: number, state: ParserState): void {
  const row = state.cursorRow;
  if (mode === 0) {
    for (let col = state.cursorCol; col < TELNET_SCREEN_WIDTH; col++) {
      state.cells[row][col] = emptyCell();
    }
  } else if (mode === 1) {
    for (let col = 0; col <= state.cursorCol; col++) {
      state.cells[row][col] = emptyCell();
    }
  } else if (mode === 2) {
    for (let col = 0; col < TELNET_SCREEN_WIDTH; col++) {
      state.cells[row][col] = emptyCell();
    }
  }
}

/** Place a character at the current cursor position */
function putChar(state: ParserState, ch: string): void {
  if (
    state.cursorRow < 0 ||
    state.cursorRow >= TELNET_SCREEN_HEIGHT ||
    state.cursorCol < 0 ||
    state.cursorCol >= TELNET_SCREEN_WIDTH
  ) {
    return;
  }

  let displayChar = ch;
  if (state.altCharset && LINE_DRAW_CHARS.has(ch)) {
    // Keep the alt-charset character code for border detection
    displayChar = ch;
  }

  state.cells[state.cursorRow][state.cursorCol] = {
    char: displayChar,
    reverse: state.reverseVideo,
    color: state.currentColor,
  };

  state.cursorCol++;
  if (state.cursorCol >= TELNET_SCREEN_WIDTH) {
    state.cursorCol = 0;
    state.cursorRow = Math.min(state.cursorRow + 1, TELNET_SCREEN_HEIGHT - 1);
  }
}

/** Reset parser state (on RIS) */
function resetState(state: ParserState): void {
  state.cells = createEmptyGrid();
  state.cursorRow = 0;
  state.cursorCol = 0;
  state.reverseVideo = false;
  state.currentColor = 7;
  state.altCharset = false;
}

/** Skip Telnet IAC command bytes */
function skipTelnetCommand(text: string, state: ParserState): void {
  if (state.pos >= text.length) return;
  const cmd = text.charCodeAt(state.pos);
  state.pos++;

  if (cmd === 0xfb || cmd === 0xfc || cmd === 0xfd || cmd === 0xfe) {
    // WILL/WONT/DO/DONT — skip one more option byte
    if (state.pos < text.length) state.pos++;
  }
  // SB (250) ... SE (240) subnegotiation could be handled here if needed
}

/** Detect bordered menu overlays from line-drawing characters */
export function detectMenus(cells: ScreenCell[][]): ParsedMenu[] {
  const menus: ParsedMenu[] = [];
  const visited = new Set<string>();

  for (let row = 0; row < TELNET_SCREEN_HEIGHT; row++) {
    for (let col = 0; col < TELNET_SCREEN_WIDTH; col++) {
      const key = `${row},${col}`;
      if (visited.has(key)) continue;

      const cell = cells[row][col];
      if (cell.char === 'l') {
        // Potential top-left corner of a menu box
        const bounds = traceMenuBounds(cells, row, col);
        if (bounds) {
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
    }
  }

  return menus;
}

/** Trace the bounds of a bordered menu starting from top-left corner */
function traceMenuBounds(
  cells: ScreenCell[][],
  startRow: number,
  startCol: number,
): { x: number; y: number; width: number; height: number } | null {
  // Find top-right corner (k) on same row
  let endCol = -1;
  for (let col = startCol + 1; col < TELNET_SCREEN_WIDTH; col++) {
    if (cells[startRow][col].char === 'k') {
      endCol = col;
      break;
    }
    if (cells[startRow][col].char !== 'q' && cells[startRow][col].char !== 'w') {
      break;
    }
  }
  if (endCol < 0) return null;

  // Find bottom row (m on left, j on right)
  let endRow = -1;
  for (let row = startRow + 1; row < TELNET_SCREEN_HEIGHT; row++) {
    if (cells[row][startCol].char === 'm') {
      if (cells[row][endCol].char === 'j') {
        endRow = row;
      }
      break;
    }
    if (cells[row][startCol].char !== 'x' && cells[row][startCol].char !== 't') {
      break;
    }
  }
  if (endRow < 0) return null;

  const width = endCol - startCol + 1;
  const height = endRow - startRow + 1;
  if (width < 4 || height < 3) return null;

  return { x: startCol, y: startRow, width, height };
}

/** Extract menu items from within the bounds of a detected menu */
function extractMenuItems(
  cells: ScreenCell[][],
  bounds: { x: number; y: number; width: number; height: number },
): MenuItem[] {
  const items: MenuItem[] = [];

  // Menu items are between the top and bottom borders (rows y+1 to y+height-2)
  for (let row = bounds.y + 1; row < bounds.y + bounds.height - 1; row++) {
    // Content is between the left and right borders (cols x+1 to x+width-2)
    let label = '';
    let isReverse = false;

    for (let col = bounds.x + 1; col < bounds.x + bounds.width - 1; col++) {
      if (col >= TELNET_SCREEN_WIDTH) break;
      const cell = cells[row][col];
      label += cell.char;
      if (cell.reverse) isReverse = true;
    }

    const trimmedLabel = label.trim();
    if (trimmedLabel.length > 0) {
      items.push({
        label: trimmedLabel,
        selected: isReverse,
        enabled: true,
      });
    }
  }

  return items;
}

/** Find the currently selected (reverse-video) item text across all menus */
function findSelectedItem(
  _cells: ScreenCell[][],
  menus: ParsedMenu[],
): string | null {
  for (const menu of menus) {
    const selected = menu.items.find((item) => item.selected);
    if (selected) return selected.label;
  }
  return null;
}

/** Extract a full text line from the cell grid */
function extractLine(cells: ScreenCell[][], row: number): string {
  if (row < 0 || row >= TELNET_SCREEN_HEIGHT) return '';
  return cells[row].map((cell) => cell.char).join('');
}

/** Classify the screen type based on structural analysis */
function classifyScreen(
  cells: ScreenCell[][],
  menus: ParsedMenu[],
): ScreenType {
  if (menus.length > 0) {
    // Check for CommoServe form by looking for title patterns
    const firstMenu = menus[0];
    const titleRow = firstMenu.bounds.y + 1;
    if (titleRow < TELNET_SCREEN_HEIGHT) {
      const titleText = extractLine(cells, titleRow).trim();
      if (
        titleText.includes('File Search') ||
        titleText.includes('Query Form')
      ) {
        return 'search_form';
      }
    }
    return 'action_menu';
  }

  // Check for status bar at bottom (file browser indicator)
  const bottomLine = extractLine(cells, TELNET_SCREEN_HEIGHT - 1);
  if (bottomLine.trim().length > 0) {
    return 'file_browser';
  }

  return 'unknown';
}

/** Utility: clamp a number to a range */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
