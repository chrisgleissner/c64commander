import { renderHook, act } from '@testing-library/react';
import { useListPreviewLimit } from '@/hooks/useListPreviewLimit';
import { getListPreviewLimit, setListPreviewLimit, clampListPreviewLimit } from '@/lib/uiPreferences';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/uiPreferences', () => ({
  getListPreviewLimit: vi.fn(),
  setListPreviewLimit: vi.fn(),
  clampListPreviewLimit: vi.fn((val) => val),
}));

describe('useListPreviewLimit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getListPreviewLimit).mockReturnValue(100);
  });

  it('initializes with stored limit', () => {
    const { result } = renderHook(() => useListPreviewLimit());
    expect(result.current.limit).toBe(100);
    expect(getListPreviewLimit).toHaveBeenCalled();
  });

  it('updates limit via setLimit', () => {
    const { result } = renderHook(() => useListPreviewLimit());
    
    act(() => {
      result.current.setLimit(200);
    });

    expect(result.current.limit).toBe(200);
    expect(setListPreviewLimit).toHaveBeenCalledWith(200);
  });

  it('updates limit on window event', () => {
    const { result } = renderHook(() => useListPreviewLimit());
    
    act(() => {
      window.dispatchEvent(
        new CustomEvent('c64u-ui-preferences-changed', {
          detail: { listPreviewLimit: 150 },
        })
      );
    });

    expect(result.current.limit).toBe(150);
  });

    it('updates limit on window event without detail', () => { // cover the else branch
    const { result } = renderHook(() => useListPreviewLimit());
    
    vi.mocked(getListPreviewLimit).mockReturnValue(300);

    act(() => {
      window.dispatchEvent(
        new CustomEvent('c64u-ui-preferences-changed', {
          detail: {},
        })
      );
    });

    expect(result.current.limit).toBe(300);
  });
});
