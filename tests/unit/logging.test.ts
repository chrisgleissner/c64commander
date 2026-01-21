import { beforeEach, describe, expect, it, vi } from 'vitest';
import { addErrorLog, addLog, clearLogs, formatLogsForShare, getErrorLogs, getLogs } from '@/lib/logging';

describe('logging', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('adds logs and filters errors', () => {
    const handler = vi.fn();
    window.addEventListener('c64u-logs-updated', handler as EventListener);

    addLog('info', 'hello');
    addErrorLog('boom', { code: 500 });

    const logs = getLogs();
    expect(logs).toHaveLength(2);
    expect(getErrorLogs()).toHaveLength(1);
    expect(handler).toHaveBeenCalled();

    window.removeEventListener('c64u-logs-updated', handler as EventListener);
  });

  it('clears logs and formats entries for sharing', () => {
    addLog('warn', 'warning', { note: 'check' });
    const formatted = formatLogsForShare(getLogs());
    expect(formatted).toContain('WARN');
    expect(formatted).toContain('warning');

    clearLogs();
    expect(getLogs()).toHaveLength(0);
  });
});
