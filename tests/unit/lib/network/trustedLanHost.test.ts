/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it } from 'vitest';
import { isTrustedLanDeviceHost } from '@/lib/network/trustedLanHost';

describe('trustedLanHost', () => {
  it('accepts private IPv4 targets', () => {
    expect(isTrustedLanDeviceHost('192.168.0.42')).toBe(true);
    expect(isTrustedLanDeviceHost('10.0.0.5')).toBe(true);
    expect(isTrustedLanDeviceHost('172.16.10.9')).toBe(true);
  });

  it('accepts local hostnames', () => {
    expect(isTrustedLanDeviceHost('c64u')).toBe(true);
    expect(isTrustedLanDeviceHost('my-c64.local')).toBe(true);
    expect(isTrustedLanDeviceHost('localhost')).toBe(true);
    expect(isTrustedLanDeviceHost('nas-box')).toBe(true);
  });

  it('accepts private IPv6 targets', () => {
    expect(isTrustedLanDeviceHost('[::1]')).toBe(true);
    expect(isTrustedLanDeviceHost('fe80::1')).toBe(true);
    expect(isTrustedLanDeviceHost('fd00::1234')).toBe(true);
  });

  it('rejects public or wan hosts', () => {
    expect(isTrustedLanDeviceHost('8.8.8.8')).toBe(false);
    expect(isTrustedLanDeviceHost('example.com')).toBe(false);
    expect(isTrustedLanDeviceHost('2606:4700:4700::1111')).toBe(false);
  });

  it('handles non-string input gracefully', () => {
    expect(isTrustedLanDeviceHost(undefined as unknown as string)).toBe(true);
    expect(isTrustedLanDeviceHost(null as unknown as string)).toBe(true);
  });

  it('treats empty or whitespace-only input as the default c64u host', () => {
    expect(isTrustedLanDeviceHost('')).toBe(true);
    expect(isTrustedLanDeviceHost('  ')).toBe(true);
  });

  it('handles host:port notation', () => {
    expect(isTrustedLanDeviceHost('c64u:8080')).toBe(true);
    expect(isTrustedLanDeviceHost('192.168.1.10:1234')).toBe(true);
    expect(isTrustedLanDeviceHost('8.8.8.8:80')).toBe(false);
  });

  it('rejects IPv4 addresses with out-of-range octets', () => {
    expect(isTrustedLanDeviceHost('256.0.0.1')).toBe(false);
    expect(isTrustedLanDeviceHost('192.168.0.300')).toBe(false);
  });

  it('accepts link-local IPv4 addresses', () => {
    expect(isTrustedLanDeviceHost('169.254.1.5')).toBe(true);
    expect(isTrustedLanDeviceHost('127.0.0.2')).toBe(true);
  });

  it('accepts IPv6 unique-local (fc00::/7) addresses', () => {
    expect(isTrustedLanDeviceHost('fd12::1234')).toBe(true);
    expect(isTrustedLanDeviceHost('fc00::1')).toBe(true);
  });

  it('rejects IPv6 with non-hex first segment', () => {
    expect(isTrustedLanDeviceHost('xyz::1')).toBe(false);
  });

  it('rejects malformed bracket notation without closing bracket', () => {
    expect(isTrustedLanDeviceHost('[c64u')).toBe(false);
  });

  it('rejects IPv6 with empty first segment (double-colon prefix)', () => {
    expect(isTrustedLanDeviceHost('::1234:5678')).toBe(false);
  });

  it('rejects host:non-numeric-port (treated as opaque)', () => {
    expect(isTrustedLanDeviceHost('myhost:notaport')).toBe(false);
  });
});
