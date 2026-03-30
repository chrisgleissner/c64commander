/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTheme } from '@/hooks/useTheme';

describe('useTheme', () => {
  let mediaQueryMock: {
    matches: boolean;
    addEventListener: ReturnType<typeof vi.fn>;
    removeEventListener: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    localStorage.clear();
    mediaQueryMock = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    vi.spyOn(window, 'matchMedia').mockReturnValue(mediaQueryMock as unknown as MediaQueryList);
    document.documentElement.classList.remove('light', 'dark');
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
    document.documentElement.classList.remove('light', 'dark');
  });

  describe('initial state', () => {
    it('defaults to system theme when no stored preference', () => {
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('system');
    });

    it('reads stored light theme from localStorage', () => {
      localStorage.setItem('c64u_theme', 'light');
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('light');
    });

    it('reads stored dark theme from localStorage', () => {
      localStorage.setItem('c64u_theme', 'dark');
      const { result } = renderHook(() => useTheme());
      expect(result.current.theme).toBe('dark');
    });
  });

  describe('resolvedTheme', () => {
    it('resolves to light when system theme and prefers-color-scheme is light', () => {
      mediaQueryMock.matches = false;
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolvedTheme).toBe('light');
    });

    it('resolves to dark when system theme and prefers-color-scheme is dark', () => {
      mediaQueryMock.matches = true;
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('resolves to light when theme is explicitly light regardless of system', () => {
      localStorage.setItem('c64u_theme', 'light');
      mediaQueryMock.matches = true;
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolvedTheme).toBe('light');
    });

    it('resolves to dark when theme is explicitly dark regardless of system', () => {
      localStorage.setItem('c64u_theme', 'dark');
      mediaQueryMock.matches = false;
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolvedTheme).toBe('dark');
    });

    it('applies the resolved theme class to document.documentElement', () => {
      localStorage.setItem('c64u_theme', 'dark');
      renderHook(() => useTheme());
      expect(document.documentElement.classList.contains('dark')).toBe(true);
    });

    it('removes conflicting theme class when applying new resolved theme', () => {
      document.documentElement.classList.add('dark');
      localStorage.setItem('c64u_theme', 'light');
      renderHook(() => useTheme());
      expect(document.documentElement.classList.contains('dark')).toBe(false);
      expect(document.documentElement.classList.contains('light')).toBe(true);
    });
  });

  describe('setTheme', () => {
    it('updates theme state', () => {
      const { result } = renderHook(() => useTheme());
      act(() => {
        result.current.setTheme('dark');
      });
      expect(result.current.theme).toBe('dark');
    });

    it('persists new theme to localStorage', () => {
      const { result } = renderHook(() => useTheme());
      act(() => {
        result.current.setTheme('light');
      });
      expect(localStorage.getItem('c64u_theme')).toBe('light');
    });

    it('updates resolvedTheme when explicit theme is set', () => {
      mediaQueryMock.matches = true;
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolvedTheme).toBe('dark');
      act(() => {
        result.current.setTheme('light');
      });
      expect(result.current.resolvedTheme).toBe('light');
    });
  });

  describe('media query listener', () => {
    it('registers change listener on matchMedia', () => {
      renderHook(() => useTheme());
      expect(mediaQueryMock.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('removes change listener on unmount', () => {
      const { unmount } = renderHook(() => useTheme());
      unmount();
      expect(mediaQueryMock.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    });

    it('updates resolvedTheme when system preference changes to dark', () => {
      mediaQueryMock.matches = false;
      const { result } = renderHook(() => useTheme());
      expect(result.current.resolvedTheme).toBe('light');

      const handler = mediaQueryMock.addEventListener.mock.calls[0]?.[1] as () => void;
      act(() => {
        mediaQueryMock.matches = true;
        handler();
      });
      expect(result.current.resolvedTheme).toBe('dark');
    });
  });
});
