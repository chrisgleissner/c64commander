/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import {
    parseTelnetScreen,
    detectMenus,
} from '@/lib/telnet/telnetScreenParser';
import {
    TELNET_SCREEN_WIDTH,
    TELNET_SCREEN_HEIGHT,
} from '@/lib/telnet/telnetTypes';

/** Helper: encode string to Uint8Array */
const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('parseTelnetScreen', () => {
    it('returns an empty 60x24 grid for empty input', () => {
        const screen = parseTelnetScreen(new Uint8Array(0));
        expect(screen.width).toBe(TELNET_SCREEN_WIDTH);
        expect(screen.height).toBe(TELNET_SCREEN_HEIGHT);
        expect(screen.cells.length).toBe(TELNET_SCREEN_HEIGHT);
        expect(screen.cells[0].length).toBe(TELNET_SCREEN_WIDTH);
        expect(screen.cells[0][0].char).toBe(' ');
        expect(screen.menus).toEqual([]);
        expect(screen.form).toBeNull();
        expect(screen.selectedItem).toBeNull();
    });

    it('places characters at cursor position', () => {
        const data = encode('Hello');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[0][0].char).toBe('H');
        expect(screen.cells[0][1].char).toBe('e');
        expect(screen.cells[0][4].char).toBe('o');
        expect(screen.cells[0][5].char).toBe(' ');
    });

    it('handles cursor positioning via CSI H', () => {
        // Move to row 3, col 5 (1-based) then write "X"
        const data = encode('\x1b[3;5HX');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[2][4].char).toBe('X');
    });

    it('handles RIS (reset) clearing the screen', () => {
        const data = encode('ABC\x1bcDEF');
        const screen = parseTelnetScreen(data);
        // After RIS, screen is reset, cursor at 0,0
        expect(screen.cells[0][0].char).toBe('D');
        expect(screen.cells[0][1].char).toBe('E');
        expect(screen.cells[0][2].char).toBe('F');
    });

    it('handles reverse video SGR', () => {
        const data = encode('\x1b[7mHI\x1b[27mLO');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[0][0].reverse).toBe(true);
        expect(screen.cells[0][1].reverse).toBe(true);
        expect(screen.cells[0][2].reverse).toBe(false);
        expect(screen.cells[0][3].reverse).toBe(false);
    });

    it('handles SGR color codes', () => {
        const data = encode('\x1b[31mR\x1b[32mG');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[0][0].color).toBe(1); // red
        expect(screen.cells[0][1].color).toBe(2); // green
    });

    it('handles SGR reset', () => {
        const data = encode('\x1b[7m\x1b[31mA\x1b[0mB');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[0][0].reverse).toBe(true);
        expect(screen.cells[0][0].color).toBe(1);
        expect(screen.cells[0][1].reverse).toBe(false);
        expect(screen.cells[0][1].color).toBe(7);
    });

    it('handles newline and carriage return', () => {
        const data = encode('AB\r\nCD');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[0][0].char).toBe('A');
        expect(screen.cells[0][1].char).toBe('B');
        expect(screen.cells[1][0].char).toBe('C');
        expect(screen.cells[1][1].char).toBe('D');
    });

    it('handles backspace', () => {
        const data = encode('AB\bX');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[0][0].char).toBe('A');
        expect(screen.cells[0][1].char).toBe('X');
    });

    it('handles cursor movement CSI A/B/C/D', () => {
        // Position at 5,5 then move up 2, right 3
        const data = encode('\x1b[5;5H\x1b[2A\x1b[3CZ');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[2][7].char).toBe('Z');
    });

    it('handles erase display mode 2 (full clear)', () => {
        const data = encode('FILLED\x1b[2JCLEAN');
        const screen = parseTelnetScreen(data);
        // After full clear, cursor stays where it was (row 0 after FILLED), but screen is cleared
        // Then CLEAN is written starting at current cursor position
        expect(screen.cells[0][6].char).toBe('C');
        expect(screen.cells[0][7].char).toBe('L');
    });

    it('handles erase in line mode 0 (to end)', () => {
        const data = encode('ABCDEFGH\x1b[1;4H\x1b[K');
        const screen = parseTelnetScreen(data);
        expect(screen.cells[0][0].char).toBe('A');
        expect(screen.cells[0][1].char).toBe('B');
        expect(screen.cells[0][2].char).toBe('C');
        // From col 3 to end should be cleared
        expect(screen.cells[0][3].char).toBe(' ');
        expect(screen.cells[0][4].char).toBe(' ');
    });

    it('skips Telnet IAC WILL/WONT/DO/DONT sequences', () => {
        // IAC WILL ECHO + IAC DONT LINEMODE + regular text
        const bytes = new Uint8Array([
            0xff, 0xfb, 0x01, 0xff, 0xfe, 0x22, 0x48, 0x49,
        ]);
        const screen = parseTelnetScreen(bytes);
        expect(screen.cells[0][0].char).toBe('H');
        expect(screen.cells[0][1].char).toBe('I');
    });

    it('classifies screen with status bar as file_browser', () => {
        // Put text on last row for status bar
        const data = encode(
            `\x1b[${TELNET_SCREEN_HEIGHT};1H SD Card: Ready`,
        );
        const screen = parseTelnetScreen(data);
        expect(screen.screenType).toBe('file_browser');
    });

    it('extracts title line from first row', () => {
        const data = encode('Ultimate-II+ V3.11');
        const screen = parseTelnetScreen(data);
        expect(screen.titleLine).toContain('Ultimate-II+ V3.11');
    });

    it('wraps cursor at column boundary', () => {
        // Fill the entire first row
        const longText = 'A'.repeat(TELNET_SCREEN_WIDTH) + 'B';
        const data = encode(longText);
        const screen = parseTelnetScreen(data);
        expect(screen.cells[0][TELNET_SCREEN_WIDTH - 1].char).toBe('A');
        expect(screen.cells[1][0].char).toBe('B');
    });

    it('clamps cursor to screen boundaries on extreme positioning', () => {
        // Move to row 999, col 999
        const data = encode('\x1b[999;999HX');
        const screen = parseTelnetScreen(data);
        expect(
            screen.cells[TELNET_SCREEN_HEIGHT - 1][TELNET_SCREEN_WIDTH - 1].char,
        ).toBe('X');
    });
});

describe('detectMenus', () => {
    it('detects a bordered menu overlay', () => {
        // Build a simple menu with line-drawing characters
        const cells: Array<Array<{ char: string; reverse: boolean; color: number }>> = [];
        for (let r = 0; r < TELNET_SCREEN_HEIGHT; r++) {
            cells.push([]);
            for (let c = 0; c < TELNET_SCREEN_WIDTH; c++) {
                cells[r].push({ char: ' ', reverse: false, color: 7 });
            }
        }

        // Draw a 10x5 menu box at row 2, col 3
        const boxTop = 2;
        const boxLeft = 3;
        const boxWidth = 10;
        const boxHeight = 5;

        // Top border
        cells[boxTop][boxLeft].char = 'l';
        for (let c = boxLeft + 1; c < boxLeft + boxWidth - 1; c++) {
            cells[boxTop][c].char = 'q';
        }
        cells[boxTop][boxLeft + boxWidth - 1].char = 'k';

        // Left and right borders + content
        for (let r = boxTop + 1; r < boxTop + boxHeight - 1; r++) {
            cells[r][boxLeft].char = 'x';
            cells[r][boxLeft + boxWidth - 1].char = 'x';
        }

        // Bottom border
        cells[boxTop + boxHeight - 1][boxLeft].char = 'm';
        for (let c = boxLeft + 1; c < boxLeft + boxWidth - 1; c++) {
            cells[boxTop + boxHeight - 1][c].char = 'q';
        }
        cells[boxTop + boxHeight - 1][boxLeft + boxWidth - 1].char = 'j';

        // Fill items
        const items = ['Power', 'Config', 'Debug'];
        for (let i = 0; i < items.length; i++) {
            const row = boxTop + 1 + i;
            for (let j = 0; j < items[i].length; j++) {
                cells[row][boxLeft + 1 + j].char = items[i][j];
            }
        }

        // Select second item
        for (let c = boxLeft + 1; c < boxLeft + boxWidth - 1; c++) {
            cells[boxTop + 2][c].reverse = true;
        }

        const menus = detectMenus(cells);
        expect(menus.length).toBe(1);
        expect(menus[0].items.length).toBe(3);
        expect(menus[0].items[0].label).toBe('Power');
        expect(menus[0].items[1].label).toBe('Config');
        expect(menus[0].items[1].selected).toBe(true);
        expect(menus[0].items[2].label).toBe('Debug');
        expect(menus[0].selectedIndex).toBe(1);
        expect(menus[0].bounds).toEqual({
            x: boxLeft,
            y: boxTop,
            width: boxWidth,
            height: boxHeight,
        });
    });

    it('returns empty array when no menu borders detected', () => {
        const cells: Array<Array<{ char: string; reverse: boolean; color: number }>> = [];
        for (let r = 0; r < TELNET_SCREEN_HEIGHT; r++) {
            cells.push([]);
            for (let c = 0; c < TELNET_SCREEN_WIDTH; c++) {
                cells[r].push({ char: ' ', reverse: false, color: 7 });
            }
        }
        const menus = detectMenus(cells);
        expect(menus).toEqual([]);
    });
});
