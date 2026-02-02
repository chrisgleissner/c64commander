import { describe, expect, it } from 'vitest';
import { redactExportText, redactExportValue } from '@/lib/diagnostics/exportRedaction';

describe('exportRedaction', () => {
  it('redacts IPs, hosts, paths, and credentials in text', () => {
    const input = 'Host c64u.local 192.168.0.10 path /mnt/usb/secret password=supersecret token: abc123';
    const output = redactExportText(input);
    expect(output).not.toContain('192.168.0.10');
    expect(output).not.toContain('c64u.local');
    expect(output).not.toContain('/mnt/usb/secret');
    expect(output).not.toContain('supersecret');
    expect(output).not.toContain('abc123');
  });

  it('redacts sensitive keys in structured data', () => {
    const input = {
      host: 'c64u',
      path: '/private/keys',
      password: 'topsecret',
      token: 'abc',
      nested: { url: 'http://c64u.local:8080/v1/info' },
    };
    const output = redactExportValue(input) as Record<string, unknown>;
    expect(output.password).toBe('***');
    expect(output.token).toBe('***');
    expect(String(output.host)).not.toContain('c64u');
    expect(String(output.path)).not.toContain('/private/keys');
    expect(JSON.stringify(output.nested)).not.toContain('c64u.local');
  });

  it('uses key hints to redact URLs and arrays', () => {
    const input = {
      apiUrl: 'https://example.com/secret',
      hosts: ['c64u.local', '10.0.0.1'],
    };
    const output = redactExportValue(input) as Record<string, unknown>;
    expect(String(output.apiUrl)).toContain('***');
    expect(JSON.stringify(output.hosts)).toContain('***');
  });
});
