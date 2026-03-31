/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { reducer, useToast } from "@/hooks/use-toast";
import { saveNotificationVisibility } from "@/lib/config/appSettings";

beforeEach(() => {
  // Allow all toast variants so hook-level tests are not filtered by visibility setting.
  localStorage.clear();
  saveNotificationVisibility("all");
});

describe("toast reducer", () => {
  it("adds, updates, dismisses, and removes toasts", () => {
    const initial = { toasts: [] };
    const added = reducer(initial, {
      type: "ADD_TOAST",
      toast: { id: "1", title: "Hello", open: true },
    });
    expect(added.toasts).toHaveLength(1);

    const updated = reducer(added, {
      type: "UPDATE_TOAST",
      toast: { id: "1", description: "Updated" },
    });
    expect(updated.toasts[0].description).toBe("Updated");

    const dismissed = reducer(updated, { type: "DISMISS_TOAST", toastId: "1" });
    expect(dismissed.toasts[0].open).toBe(false);

    const removed = reducer(dismissed, { type: "REMOVE_TOAST", toastId: "1" });
    expect(removed.toasts).toHaveLength(0);
  });

  it("dismisses all toasts without id", () => {
    const state = {
      toasts: [
        { id: "1", title: "One", open: true },
        { id: "2", title: "Two", open: true },
      ],
    };
    const dismissed = reducer(state, { type: "DISMISS_TOAST" });
    expect(dismissed.toasts.every((toast) => !toast.open)).toBe(true);
  });
});

describe("useToast", () => {
  it("creates and updates a toast", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());

    act(() => {
      const handle = result.current.toast({ title: "Hello" });
      handle.update({
        title: "Updated",
        description: "Changed",
        id: handle.id,
        open: true,
      });
    });

    expect(result.current.toasts).toHaveLength(1);
    expect(result.current.toasts[0].title).toBe("Updated");

    act(() => {
      result.current.dismiss();
      vi.advanceTimersByTime(1000000);
    });

    vi.useRealTimers();
  });

  it("dismisses a toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Temporary" });
    });

    const toastId = result.current.toasts[0].id;
    act(() => {
      result.current.dismiss(toastId);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });

  it("removes all toasts when REMOVE_TOAST is dispatched without a toastId", () => {
    const state = {
      toasts: [
        { id: "1", title: "One", open: false },
        { id: "2", title: "Two", open: false },
      ],
    };
    const cleared = reducer(state, { type: "REMOVE_TOAST" });
    expect(cleared.toasts).toHaveLength(0);
  });

  it("auto-removes a toast after the remove delay elapses", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Auto-remove" });
    });

    expect(result.current.toasts).toHaveLength(1);
    const toastId = result.current.toasts[0].id;

    act(() => {
      result.current.dismiss(toastId);
      vi.runAllTimers();
    });

    expect(result.current.toasts).toHaveLength(0);
    vi.useRealTimers();
  });

  it("closing via onOpenChange dismisses the toast", () => {
    const { result } = renderHook(() => useToast());

    act(() => {
      result.current.toast({ title: "Closeable" });
    });

    const onOpenChange = result.current.toasts[0].onOpenChange!;
    act(() => {
      onOpenChange(false);
    });

    expect(result.current.toasts[0].open).toBe(false);
  });
});
