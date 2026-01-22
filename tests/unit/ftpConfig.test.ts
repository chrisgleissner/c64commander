import { describe, expect, it, beforeEach } from 'vitest';
import {
  clearFtpBridgeUrl,
  clearStoredFtpPort,
  getFtpBridgeUrl,
  getStoredFtpPort,
  setFtpBridgeUrl,
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

  it('stores and clears FTP bridge URL', () => {
    setFtpBridgeUrl('http://localhost:4000');
    expect(getFtpBridgeUrl()).toBe('http://localhost:4000');
    clearFtpBridgeUrl();
    expect(getFtpBridgeUrl()).toBe('');
  });
});
