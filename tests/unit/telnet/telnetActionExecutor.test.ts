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
import { createActionExecutor } from '@/lib/telnet/telnetActionExecutor';
import { TELNET_ACTIONS, TelnetError } from '@/lib/telnet/telnetTypes';

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

describe('createActionExecutor', () => {
  describe('execute', () => {
    it('executes powerCycle action', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session);
      await executor.execute('powerCycle');
    });

    it('executes iecTurnOn action', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session);
      await executor.execute('iecTurnOn');
    });

    it('executes printerFlush action', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session);
      await executor.execute('printerFlush');
    });

    it('executes saveConfigToFile action', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session);
      await executor.execute('saveConfigToFile');
    });

    it('throws ACTION_FAILED for unknown action ID', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session);
      await expect(executor.execute('nonexistent')).rejects.toThrow(
        TelnetError,
      );
    });

    it('uses F1 as menu key when configured', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session, { menuKey: 'F1' });
      await executor.execute('powerCycle');
    });
  });

  describe('getAction', () => {
    it('returns action for known ID', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session);
      const action = executor.getAction('powerCycle');
      expect(action).not.toBeNull();
      expect(action!.id).toBe('powerCycle');
      expect(action!.label).toBe('Power Cycle');
      expect(action!.menuPath).toEqual(['Power & Reset', 'Power Cycle']);
    });

    it('returns null for unknown ID', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session);
      expect(executor.getAction('nonexistent')).toBeNull();
    });
  });

  describe('listActions', () => {
    it('returns all defined actions', async () => {
      const session = await createConnectedSession();
      const executor = createActionExecutor(session);
      const actions = executor.listActions();
      expect(actions.length).toBe(Object.keys(TELNET_ACTIONS).length);
      expect(actions.every((a) => a.id && a.label && a.menuPath)).toBe(true);
    });
  });
});
