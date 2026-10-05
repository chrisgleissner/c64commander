import { afterEach, describe, expect, it, vi } from "vitest";
import {
  requestDeviceSwitcherOpen,
  subscribeDeviceSwitcherOpen,
  requestQuickMenuOpen,
  subscribeQuickMenuOpen,
} from "@/lib/input/keypadCommands";

describe("keypadCommands window-event bus", () => {
  afterEach(() => subscribeDeviceSwitcherOpen(() => {})());

  it("retains one request across a missing owner and lets only an active owner consume it", () => {
    requestDeviceSwitcherOpen();
    requestDeviceSwitcherOpen();
    const inactive = vi.fn(() => false);
    const offInactive = subscribeDeviceSwitcherOpen(inactive);
    const active = vi.fn(() => true);
    const offActive = subscribeDeviceSwitcherOpen(active);
    const later = vi.fn();
    const offLater = subscribeDeviceSwitcherOpen(later);
    expect(inactive).toHaveBeenCalledOnce();
    expect(active).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
    offInactive();
    offActive();
    offLater();
  });

  it("drops a device-switcher request that no owner answered within the request window", () => {
    vi.useFakeTimers();
    try {
      requestDeviceSwitcherOpen();
      vi.advanceTimersByTime(1500);
      const lateOwner = vi.fn(() => true);
      const off = subscribeDeviceSwitcherOpen(lateOwner);
      expect(lateOwner).not.toHaveBeenCalled();
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it("still delivers a device-switcher request to an owner that subscribes within the request window", () => {
    vi.useFakeTimers();
    try {
      requestDeviceSwitcherOpen();
      vi.advanceTimersByTime(1000);
      const owner = vi.fn(() => true);
      const off = subscribeDeviceSwitcherOpen(owner);
      expect(owner).toHaveBeenCalledOnce();
      off();
    } finally {
      vi.useRealTimers();
    }
  });

  it("delivers device-switcher open requests to subscribers and stops after unsubscribe", () => {
    const handler = vi.fn();
    const off = subscribeDeviceSwitcherOpen(handler);
    requestDeviceSwitcherOpen();
    expect(handler).toHaveBeenCalledTimes(1);
    off();
    requestDeviceSwitcherOpen();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("delivers quick-menu open requests to subscribers and stops after unsubscribe", () => {
    const handler = vi.fn();
    const off = subscribeQuickMenuOpen(handler);
    requestQuickMenuOpen();
    requestQuickMenuOpen();
    expect(handler).toHaveBeenCalledTimes(2);
    off();
    requestQuickMenuOpen();
    expect(handler).toHaveBeenCalledTimes(2);
  });

  it("keeps the device-switcher and quick-menu channels independent", () => {
    const deviceHandler = vi.fn();
    const menuHandler = vi.fn();
    const offA = subscribeDeviceSwitcherOpen(deviceHandler);
    const offB = subscribeQuickMenuOpen(menuHandler);
    requestDeviceSwitcherOpen();
    expect(deviceHandler).toHaveBeenCalledTimes(1);
    expect(menuHandler).not.toHaveBeenCalled();
    offA();
    offB();
  });
});
