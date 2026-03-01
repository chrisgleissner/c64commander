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
});
