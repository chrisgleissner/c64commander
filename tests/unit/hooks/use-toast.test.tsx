import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { reducer, useToast } from '@/hooks/use-toast';

describe('toast reducer', () => {
  it('adds, updates, dismisses, and removes toasts', () => {
    const initial = { toasts: [] };
    const added = reducer(initial, {
      type: 'ADD_TOAST',
      toast: { id: '1', title: 'Hello', open: true },
    });
    expect(added.toasts).toHaveLength(1);

    const updated = reducer(added, {
      type: 'UPDATE_TOAST',
      toast: { id: '1', description: 'Updated' },
    });
    expect(updated.toasts[0].description).toBe('Updated');

    const dismissed = reducer(updated, { type: 'DISMISS_TOAST', toastId: '1' });
    expect(dismissed.toasts[0].open).toBe(false);

    const removed = reducer(dismissed, { type: 'REMOVE_TOAST', toastId: '1' });
    expect(removed.toasts).toHaveLength(0);
  });

  it('dismisses all toasts without id', () => {
    const state = {
      toasts: [
        { id: '1', title: 'One', open: true },
        { id: '2', title: 'Two', open: true },
      ],
    };
    const dismissed = reducer(state, { type: 'DISMISS_TOAST' });
    expect(dismissed.toasts.every((toast) => !toast.open)).toBe(true);
  });
});

describe('useToast', () => {
  it('creates and updates a toast', () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());

    act(() => {
      const handle = result.current.toast({ title: 'Hello' });
      handle.update({ title: 'Updated', description: 'Changed', id: handle.id, open: true });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe('Updated');

    act(() => {
      result.current.dismiss();
      vi.advanceTimersByTime(1000000);
    });

    vi.useRealTimers();
  });

  it('dismisses a toast', () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: 'Temporary' });
    });

    const toastId = result.current.toasts[0].id;
    act(() => {
      result.current.dismiss(toastId);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });
});
