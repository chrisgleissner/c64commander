import { describe, expect, it, vi } from "vitest";
import {
  requestDeviceSwitcherOpen,
  subscribeDeviceSwitcherOpen,
  requestQuickMenuOpen,
  subscribeQuickMenuOpen,
} from "@/lib/input/keypadCommands";

describe("keypadCommands window-event bus", () => {
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
