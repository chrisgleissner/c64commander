/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { TelnetMock } from '@/lib/telnet/telnetMock';
import { TelnetError, TELNET_KEYS } from '@/lib/telnet/telnetTypes';
import { parseTelnetScreen } from '@/lib/telnet/telnetScreenParser';

const encode = (s: string): Uint8Array => new TextEncoder().encode(s);

describe('TelnetMock', () => {
    describe('connection', () => {
        it('connects without password', async () => {
            const mock = new TelnetMock();
            await mock.connect('localhost', 23);
            expect(mock.isConnected()).toBe(true);
        });

        it('connects with password', async () => {
            const mock = new TelnetMock({ password: 'secret' });
            await mock.connect('localhost', 23);
            expect(mock.isConnected()).toBe(true);

            // Should get password prompt
            const data = await mock.read(1000);
            const text = new TextDecoder('ascii').decode(data);
            expect(text).toContain('Password:');
        });

        it('authenticates with correct password', async () => {
            const mock = new TelnetMock({ password: 'secret' });
            await mock.connect('localhost', 23);
            await mock.read(1000); // consume prompt

            await mock.send(encode('secret\r'));
            const data = await mock.read(1000);
            expect(data.length).toBeGreaterThan(0);

            // Should render a valid screen
            const screen = parseTelnetScreen(data);
            expect(screen.titleLine).toContain('Ultimate-II+');
        });

        it('rejects wrong password', async () => {
            const mock = new TelnetMock({ password: 'secret' });
            await mock.connect('localhost', 23);
            await mock.read(1000);

            await mock.send(encode('wrong\r'));
            const data = await mock.read(1000);
            const text = new TextDecoder('ascii').decode(data);
            expect(text).toContain('incorrect');
        });

        it('rejects with failAuth option', async () => {
            const mock = new TelnetMock({ password: 'secret', failAuth: true });
            await mock.connect('localhost', 23);
            await mock.read(1000);

            await mock.send(encode('secret\r'));
            const data = await mock.read(1000);
            const text = new TextDecoder('ascii').decode(data);
            expect(text).toContain('incorrect');
        });

        it('throws on failConnect', async () => {
            const mock = new TelnetMock({ failConnect: true });
            await expect(mock.connect('localhost', 23)).rejects.toThrow(TelnetError);
        });

        it('disconnects cleanly', async () => {
            const mock = new TelnetMock();
            await mock.connect('localhost', 23);
            await mock.disconnect();
            expect(mock.isConnected()).toBe(false);
        });

        it('throws on send when disconnected', async () => {
            const mock = new TelnetMock();
            await expect(mock.send(encode('test'))).rejects.toThrow(TelnetError);
        });

        it('throws on read when disconnected', async () => {
            const mock = new TelnetMock();
            await expect(mock.read(1000)).rejects.toThrow(TelnetError);
        });

        it('disconnects after N sends', async () => {
            const mock = new TelnetMock({ disconnectAfterSends: 2 });
            await mock.connect('localhost', 23);
            await mock.read(1000); // consume initial screen

            await mock.send(encode(TELNET_KEYS.UP)); // send 1
            await expect(mock.send(encode(TELNET_KEYS.DOWN))).rejects.toThrow(
                TelnetError,
            ); // send 2 triggers disconnect
        });
    });

    describe('menu navigation', () => {
        async function openMenu(mock: TelnetMock): Promise<void> {
            await mock.connect('localhost', 23);
            await mock.read(1000);
            await mock.send(encode(TELNET_KEYS.F5));
        }

        it('opens action menu on F5', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);

            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            expect(screen.menus.length).toBeGreaterThanOrEqual(1);
            expect(screen.menus[0].items.length).toBeGreaterThan(0);
        });

        it('opens action menu on F1', async () => {
            const mock = new TelnetMock();
            await mock.connect('localhost', 23);
            await mock.read(1000);
            await mock.send(encode(TELNET_KEYS.F1));

            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            expect(screen.menus.length).toBeGreaterThanOrEqual(1);
        });

        it('navigates categories with UP/DOWN', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000); // consume menu screen

            // Move down
            await mock.send(encode(TELNET_KEYS.DOWN));
            const data1 = await mock.read(1000);
            const screen1 = parseTelnetScreen(data1);
            expect(screen1.menus[0].selectedIndex).toBe(1);

            // Move up
            await mock.send(encode(TELNET_KEYS.UP));
            const data2 = await mock.read(1000);
            const screen2 = parseTelnetScreen(data2);
            expect(screen2.menus[0].selectedIndex).toBe(0);
        });

        it('enters submenu with RIGHT', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.RIGHT));
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            // Should have 2 menus: top-level and submenu
            expect(screen.menus.length).toBe(2);
        });

        it('leaves submenu with LEFT', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.RIGHT)); // open submenu
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.LEFT)); // close submenu
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            expect(screen.menus.length).toBe(1); // only top-level
        });

        it('LEFT from top-level menu closes it entirely', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.LEFT));
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            expect(screen.menus.length).toBe(0);
        });

        it('executes action with ENTER in submenu', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.RIGHT)); // open submenu
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.ENTER)); // execute
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            expect(screen.menus.length).toBe(0); // menu closed
        });

        it('navigates submenu actions with UP/DOWN', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.RIGHT));
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.DOWN));
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            // submenu is menus[1]
            expect(screen.menus[1].selectedIndex).toBe(1);
        });
    });

    describe('ESCAPE then any key closes menu', () => {
        async function openMenu(mock: TelnetMock): Promise<void> {
            await mock.connect('localhost', 23);
            await mock.read(1000);
            await mock.send(encode(TELNET_KEYS.F5));
        }

        it('single ESCAPE alone does not close menu', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.ESCAPE));
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            expect(screen.menus.length).toBeGreaterThanOrEqual(1);
        });

        it('ESCAPE then any key closes top-level menu', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.ESCAPE));
            await mock.read(1000);
            // Any follow-up key closes the menu and is consumed
            await mock.send(encode(TELNET_KEYS.UP));
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            expect(screen.menus.length).toBe(0);
        });

        it('ESCAPE then any key closes submenu but not top-level', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.RIGHT)); // open submenu
            await mock.read(1000);

            await mock.send(encode(TELNET_KEYS.ESCAPE));
            await mock.read(1000);
            await mock.send(encode(TELNET_KEYS.DOWN)); // any key after ESC
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            // submenu closed, but top-level menu stays
            expect(screen.menus.length).toBe(1);
        });

        it('follow-up key after ESC is consumed and not processed', async () => {
            const mock = new TelnetMock();
            await openMenu(mock);
            await mock.read(1000);

            // Move down to category 1
            await mock.send(encode(TELNET_KEYS.DOWN));
            await mock.read(1000);

            // ESC + DOWN should close the menu (DOWN consumed), not move cursor
            await mock.send(encode(TELNET_KEYS.ESCAPE));
            await mock.read(1000);
            await mock.send(encode(TELNET_KEYS.DOWN));
            const data = await mock.read(1000);
            const screen = parseTelnetScreen(data);
            expect(screen.menus.length).toBe(0);
        });
    });
});

describe('missingItems', () => {
    it('filters out actions specified in missingItems', async () => {
        const mock = new TelnetMock({
            missingItems: ['Reset C64', 'Power Cycle'],
        });
        await mock.connect('localhost', 23);
        await mock.read(1000);
        await mock.send(encode(TELNET_KEYS.F5));
        await mock.read(1000);

        // Enter first category submenu
        await mock.send(encode(TELNET_KEYS.RIGHT));
        const data = await mock.read(1000);
        const screen = parseTelnetScreen(data);

        if (screen.menus.length >= 2) {
            const submenuLabels = screen.menus[1].items.map((i) => i.label);
            expect(submenuLabels).not.toContain('Reset C64');
            expect(submenuLabels).not.toContain('Power Cycle');
        }
    });
});

describe('no-password mode', () => {
    it('renders file browser screen immediately', async () => {
        const mock = new TelnetMock();
        await mock.connect('localhost', 23);
        const data = await mock.read(1000);
        const screen = parseTelnetScreen(data);
        expect(screen.titleLine).toContain('Ultimate-II+');
        expect(screen.screenType).toBe('file_browser');
    });
});

describe('read returns empty when no pending output', () => {
    it('returns empty Uint8Array after consuming all output', async () => {
        const mock = new TelnetMock();
        await mock.connect('localhost', 23);
        await mock.read(1000); // consume initial screen
        const data = await mock.read(1000);
        expect(data.length).toBe(0);
    });
});
