/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import {
  clearFtpBridgeUrl,
  clearRuntimeFtpPortOverride,
  clearStoredFtpPort,
  getFtpBridgeUrl,
  getStoredFtpPort,
  setFtpBridgeUrl,
  setRuntimeFtpPortOverride,
  setStoredFtpPort,
} from '@/lib/ftp/ftpConfig';

describe('ftpConfig', () => {
  beforeEach(() => {
    localStorage.clear();
    clearRuntimeFtpPortOverride();
  });

  afterEach(() => {
    clearRuntimeFtpPortOverride();
    vi.unstubAllEnvs();
  });

  it('returns default FTP port when missing or invalid', () => {
    expect(getStoredFtpPort()).toBe(21);
    localStorage.setItem('c64u_ftp_port', '0');
    expect(getStoredFtpPort()).toBe(21);
    localStorage.setItem('c64u_ftp_port', 'abc');
    expect(getStoredFtpPort()).toBe(21);
  });

  it('stores and clears FTP port', () => {
    setStoredFtpPort(2121);
    expect(getStoredFtpPort()).toBe(2121);
    clearStoredFtpPort();
    expect(getStoredFtpPort()).toBe(21);
  });

  it('ignores invalid port in setStoredFtpPort', () => {
    setStoredFtpPort(2121);
    setStoredFtpPort(0);
    expect(getStoredFtpPort()).toBe(2121);
    setStoredFtpPort(-1);
    expect(getStoredFtpPort()).toBe(2121);
  });

  it('stores and clears FTP bridge URL', () => {
    setFtpBridgeUrl('http://localhost:4000');
    expect(getFtpBridgeUrl()).toBe('http://localhost:4000');
    clearFtpBridgeUrl();
    expect(getFtpBridgeUrl()).toBe('');
  });

  it('ignores empty URL in setFtpBridgeUrl', () => {
    setFtpBridgeUrl('http://before.example.com');
    setFtpBridgeUrl('');
    expect(getFtpBridgeUrl()).toBe('http://before.example.com');
  });

  describe('runtime FTP port override', () => {
    afterEach(() => {
      clearRuntimeFtpPortOverride();
    });

    it('overrides stored port when set', () => {
      setStoredFtpPort(2121);
      setRuntimeFtpPortOverride(9021);
      expect(getStoredFtpPort()).toBe(9021);
    });

    it('restores stored port after clearing override', () => {
      setStoredFtpPort(2121);
      setRuntimeFtpPortOverride(9021);
      clearRuntimeFtpPortOverride();
      expect(getStoredFtpPort()).toBe(2121);
    });

    it('clears override when null is passed to setRuntimeFtpPortOverride', () => {
      setRuntimeFtpPortOverride(9021);
      setRuntimeFtpPortOverride(null);
      expect(getStoredFtpPort()).toBe(21);
    });

    it('ignores invalid port in setRuntimeFtpPortOverride', () => {
      setRuntimeFtpPortOverride(9021);
      setRuntimeFtpPortOverride(0);
      expect(getStoredFtpPort()).toBe(9021);
      setRuntimeFtpPortOverride(-5);
      expect(getStoredFtpPort()).toBe(9021);
    });
  });

  it('setRuntimeFtpPortOverride sets and clears override (lines 16, 33)', () => {
    setRuntimeFtpPortOverride(2121);
    expect(getStoredFtpPort()).toBe(2121);  // line 16 TRUE
    setRuntimeFtpPortOverride(null);        // line 33 TRUE
    expect(getStoredFtpPort()).toBe(21);
  });

  it('setRuntimeFtpPortOverride ignores invalid port (line 37)', () => {
    setRuntimeFtpPortOverride(-1);
    expect(getStoredFtpPort()).toBe(21);
    setRuntimeFtpPortOverride(0);
    expect(getStoredFtpPort()).toBe(21);
  });

  it('setStoredFtpPort ignores invalid port (line 24)', () => {
    setStoredFtpPort(-5);
    expect(getStoredFtpPort()).toBe(21);
    setStoredFtpPort(0);
    expect(getStoredFtpPort()).toBe(21);
  });

  it('setFtpBridgeUrl ignores empty string (line 56)', () => {
    setFtpBridgeUrl('');
    expect(getFtpBridgeUrl()).toBe('');
  });

  it('getFtpBridgeUrl returns /api/ftp when VITE_WEB_PLATFORM is 1 (line 48)', () => {
    vi.stubEnv('VITE_WEB_PLATFORM', '1');
    clearFtpBridgeUrl();
    expect(getFtpBridgeUrl()).toBe('/api/ftp');
  });
});
