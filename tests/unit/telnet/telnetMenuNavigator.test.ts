/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from 'vitest';
import { TelnetMock } from '@/lib/telnet/telnetMock';
import { createTelnetSession } from '@/lib/telnet/telnetSession';
import {
  createMenuNavigator,
  matchLabel,
} from '@/lib/telnet/telnetMenuNavigator';
import { TelnetError } from '@/lib/telnet/telnetTypes';

vi.mock('@/lib/logging', () => ({
  addLog: vi.fn(),
}));

/** Helper: create a connected session from a mock */
async function createConnectedSession(mock?: TelnetMock) {
  const m = mock ?? new TelnetMock();
  const session = createTelnetSession(m);
  await session.connect('localhost', 23);
  return session;
}

describe('matchLabel', () => {
  it('matches identical labels', () => {
    expect(matchLabel('Power & Reset', 'Power & Reset')).toBe(true);
  });

  it('matches case-insensitively', () => {
    expect(matchLabel('power & reset', 'Power & Reset')).toBe(true);
  });

  it('matches with extra whitespace', () => {
    expect(matchLabel('  Power  &  Reset  ', 'Power & Reset')).toBe(true);
  });

  it('rejects different labels', () => {
    expect(matchLabel('Power & Reset', 'Software IEC')).toBe(false);
  });
});

describe('createMenuNavigator', () => {
  describe('navigate', () => {
    it('navigates to first category first action', async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      // Power & Reset → Reset C64 (first category, first action)
      await nav.navigate(['Power & Reset', 'Reset C64'], 'F5');
    });

    it('navigates to second category first action', async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await nav.navigate(['Software IEC', 'Turn On'], 'F5');
    });

    it('navigates to a deep action (third category)', async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await nav.navigate(['Printer', 'Flush/Eject'], 'F5');
    });

    it('navigates to an action not at index 0 in submenu', async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      // Power Cycle is 5th action (index 4) in Power & Reset
      await nav.navigate(['Power & Reset', 'Power Cycle'], 'F5');
    });

    it('navigates with F1 key', async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await nav.navigate(['Power & Reset', 'Reset C64'], 'F1');
    });

    it('throws ITEM_NOT_FOUND for missing category', async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await expect(
        nav.navigate(['Nonexistent', 'Reset C64'], 'F5'),
      ).rejects.toThrow(TelnetError);
    });

    it('throws ITEM_NOT_FOUND for missing action', async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      await expect(
        nav.navigate(['Power & Reset', 'Nonexistent Action'], 'F5'),
      ).rejects.toThrow(TelnetError);
    });

    it('handles missingItems in mock', async () => {
      const mock = new TelnetMock({ missingItems: ['Reset C64'] });
      const session = await createConnectedSession(mock);
      const nav = createMenuNavigator(session);

      await expect(
        nav.navigate(['Power & Reset', 'Reset C64'], 'F5'),
      ).rejects.toThrow(TelnetError);
    });

    it('navigates to last category', async () => {
      const session = await createConnectedSession();
      const nav = createMenuNavigator(session);

      // Developer is the 5th (last) category
      await nav.navigate(['Developer', 'Clear Debug Log'], 'F5');
    });
  });
});
