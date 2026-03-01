/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

const normalizeHostInput = (hostInput?: string) => {
    const value = typeof hostInput === 'string' ? hostInput.trim() : '';
    return value || 'c64u';
};

const splitHostAndPort = (hostValue: string) => {
    const normalized = hostValue.trim().toLowerCase();
    if (!normalized) return '';

    if (normalized.startsWith('[')) {
        const closingBracketIndex = normalized.indexOf(']');
        if (closingBracketIndex > 0) {
            return normalized.slice(1, closingBracketIndex);
        }
    }

    const firstColon = normalized.indexOf(':');
    const lastColon = normalized.lastIndexOf(':');
    if (firstColon !== -1 && firstColon === lastColon) {
        const maybePort = normalized.slice(lastColon + 1);
        if (/^\d+$/.test(maybePort)) {
            return normalized.slice(0, lastColon);
        }
    }

    return normalized;
};

const isPrivateIpv4Host = (host: string) => {
    const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
    if (!match) return false;

    const octets = match.slice(1).map((value) => Number(value));
    if (octets.some((value) => Number.isNaN(value) || value < 0 || value > 255)) return false;
    if (octets[0] === 10) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 127) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
    return false;
};

const isPrivateIpv6Host = (host: string) => {
    if (!host.includes(':')) return false;
    if (host === '::1') return true;

    const firstSegment = host.split(':')[0];
    if (!firstSegment) return false;
    const firstHextet = Number.parseInt(firstSegment, 16);
    if (Number.isNaN(firstHextet)) return false;

    if ((firstHextet & 0xffc0) === 0xfe80) return true;
    if ((firstHextet & 0xfe00) === 0xfc00) return true;
    return false;
};

const isSingleLabelHostname = (host: string) => {
    if (host.includes('.')) return false;
    if (host.includes(':')) return false;
    return /^[a-z0-9-]+$/i.test(host);
};

export const isTrustedLanDeviceHost = (hostInput: string) => {
    const normalized = normalizeHostInput(hostInput).toLowerCase();
    const host = splitHostAndPort(normalized);
    if (!host) return false;

    if (host === 'c64u' || host === 'localhost' || host === '127.0.0.1' || host === '::1') {
        return true;
    }

    if (host.endsWith('.local')) {
        return true;
    }

    if (isSingleLabelHostname(host)) {
        return true;
    }

    if (isPrivateIpv4Host(host) || isPrivateIpv6Host(host)) {
        return true;
    }

    return false;
};
