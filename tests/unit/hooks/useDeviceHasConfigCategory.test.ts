/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDeviceHasConfigCategory } from "@/hooks/useDeviceHasConfigCategory";

const categories = vi.hoisted(() => ({ result: { data: undefined as unknown, isPlaceholderData: false } }));
vi.mock("@/hooks/useC64Connection", () => ({ useC64Categories: () => categories.result }));

const hasKeyboardLighting = () => renderHook(() => useDeviceHasConfigCategory("Keyboard Lighting")).result.current;

describe("useDeviceHasConfigCategory", () => {
  it("is true when the connected device lists the category", () => {
    categories.result = { data: { categories: ["Audio Mixer", "Keyboard Lighting"] }, isPlaceholderData: false };
    expect(hasKeyboardLighting()).toBe(true);
  });

  it("is false when the device does not list it, as an Ultimate 64 does not list Keyboard Lighting", () => {
    categories.result = { data: { categories: ["Audio Mixer", "LED Strip Settings"] }, isPlaceholderData: false };
    expect(hasKeyboardLighting()).toBe(false);
  });

  it("is false while the list has not loaded, and while the previous device's list stands in", () => {
    categories.result = { data: undefined, isPlaceholderData: false };
    expect(hasKeyboardLighting()).toBe(false);
    categories.result = { data: { categories: ["Keyboard Lighting"] }, isPlaceholderData: true };
    expect(hasKeyboardLighting()).toBe(false);
  });
});
