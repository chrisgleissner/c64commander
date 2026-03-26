/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_AUTO_ROTATION_ENABLED,
  clampNotificationDurationMs,
  DEFAULT_NOTIFICATION_DURATION_MS,
  DEFAULT_NOTIFICATION_VISIBILITY,
  loadAutoRotationEnabled,
  loadNotificationDurationMs,
  loadNotificationVisibility,
  NOTIFICATION_DURATION_MAX_MS,
  NOTIFICATION_DURATION_MIN_MS,
  saveAutoRotationEnabled,
  saveNotificationDurationMs,
  saveNotificationVisibility,
} from "@/lib/config/appSettings";

beforeEach(() => {
  localStorage.clear();
});

describe("loadNotificationVisibility", () => {
  it("returns errors-only by default", () => {
    expect(loadNotificationVisibility()).toBe(DEFAULT_NOTIFICATION_VISIBILITY);
    expect(loadNotificationVisibility()).toBe("errors-only");
  });

  it("returns all when saved as all", () => {
    saveNotificationVisibility("all");
    expect(loadNotificationVisibility()).toBe("all");
  });

  it("returns errors-only when saved as errors-only", () => {
    saveNotificationVisibility("errors-only");
    expect(loadNotificationVisibility()).toBe("errors-only");
  });

  it("falls back to errors-only for unknown stored values", () => {
    localStorage.setItem("c64u_notification_visibility", "bogus");
    expect(loadNotificationVisibility()).toBe("errors-only");
  });
});

describe("saveNotificationVisibility", () => {
  it("persists the value to localStorage", () => {
    saveNotificationVisibility("all");
    expect(localStorage.getItem("c64u_notification_visibility")).toBe("all");
  });

  it("broadcasts a settings-updated event", () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("c64u-app-settings-updated", handler);
    saveNotificationVisibility("all");
    window.removeEventListener("c64u-app-settings-updated", handler);
    expect(events).toHaveLength(1);
    expect(events[0].detail.key).toBe("c64u_notification_visibility");
    expect(events[0].detail.value).toBe("all");
  });
});

describe("clampNotificationDurationMs", () => {
  it("returns default for NaN", () => {
    expect(clampNotificationDurationMs(NaN)).toBe(DEFAULT_NOTIFICATION_DURATION_MS);
  });

  it("clamps to minimum", () => {
    expect(clampNotificationDurationMs(0)).toBe(NOTIFICATION_DURATION_MIN_MS);
    expect(clampNotificationDurationMs(1000)).toBe(NOTIFICATION_DURATION_MIN_MS);
  });

  it("clamps to maximum", () => {
    expect(clampNotificationDurationMs(99999)).toBe(NOTIFICATION_DURATION_MAX_MS);
  });

  it("rounds to nearest 500ms", () => {
    expect(clampNotificationDurationMs(3200)).toBe(3000);
    expect(clampNotificationDurationMs(3300)).toBe(3500);
    expect(clampNotificationDurationMs(4000)).toBe(4000);
  });

  it("accepts exact boundary values", () => {
    expect(clampNotificationDurationMs(NOTIFICATION_DURATION_MIN_MS)).toBe(NOTIFICATION_DURATION_MIN_MS);
    expect(clampNotificationDurationMs(NOTIFICATION_DURATION_MAX_MS)).toBe(NOTIFICATION_DURATION_MAX_MS);
  });
});

describe("loadNotificationDurationMs", () => {
  it("returns default when nothing stored", () => {
    expect(loadNotificationDurationMs()).toBe(DEFAULT_NOTIFICATION_DURATION_MS);
  });

  it("returns clamped value after save", () => {
    saveNotificationDurationMs(6000);
    expect(loadNotificationDurationMs()).toBe(6000);
  });
});

describe("saveNotificationDurationMs", () => {
  it("persists clamped value", () => {
    saveNotificationDurationMs(99999);
    expect(loadNotificationDurationMs()).toBe(NOTIFICATION_DURATION_MAX_MS);
  });

  it("broadcasts a settings-updated event with the clamped value", () => {
    const events: CustomEvent[] = [];
    const handler = (e: Event) => events.push(e as CustomEvent);
    window.addEventListener("c64u-app-settings-updated", handler);
    saveNotificationDurationMs(5000);
    window.removeEventListener("c64u-app-settings-updated", handler);
    expect(events).toHaveLength(1);
    expect(events[0].detail.key).toBe("c64u_notification_duration_ms");
    expect(events[0].detail.value).toBe(5000);
  });
});

describe("auto rotation", () => {
  it("defaults to disabled and persists changes", () => {
    expect(loadAutoRotationEnabled()).toBe(DEFAULT_AUTO_ROTATION_ENABLED);

    saveAutoRotationEnabled(true);
    expect(loadAutoRotationEnabled()).toBe(true);

    saveAutoRotationEnabled(false);
    expect(loadAutoRotationEnabled()).toBe(false);
  });
});

describe("notification settings without localStorage", () => {
  let originalLocalStorage: Storage;

  beforeEach(() => {
    originalLocalStorage = global.localStorage;
    // @ts-expect-error intentionally removing storage for fallback coverage
    delete global.localStorage;
  });

  afterEach(() => {
    global.localStorage = originalLocalStorage;
  });

  it("falls back cleanly when storage is unavailable", () => {
    expect(loadNotificationVisibility()).toBe(DEFAULT_NOTIFICATION_VISIBILITY);
    expect(loadNotificationDurationMs()).toBe(DEFAULT_NOTIFICATION_DURATION_MS);
    expect(loadAutoRotationEnabled()).toBe(DEFAULT_AUTO_ROTATION_ENABLED);

    expect(() => saveNotificationVisibility("all")).not.toThrow();
    expect(() => saveNotificationDurationMs(5000)).not.toThrow();
    expect(() => saveAutoRotationEnabled(true)).not.toThrow();
  });
});
