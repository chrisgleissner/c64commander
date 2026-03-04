/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, describe, expect, it, beforeEach } from 'vitest';
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
});
