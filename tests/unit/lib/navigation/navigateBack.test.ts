/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { navigateBackOrLeave } from "@/lib/navigation/navigateBack";
import { addLog } from "@/lib/logging";
import { getPlatform } from "@/lib/native/platform";

const minimizeApp = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@capacitor/app", () => ({ App: { minimizeApp } }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));
vi.mock("@/lib/native/platform", () => ({ getPlatform: vi.fn(() => "android") }));

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("navigateBackOrLeave", () => {
  beforeEach(() => {
    minimizeApp.mockClear();
    vi.mocked(addLog).mockClear();
    vi.mocked(getPlatform).mockReturnValue("android");
    window.history.replaceState({ idx: 0 }, "");
  });

  it("returns to the previous route when the session has one", () => {
    window.history.replaceState({ idx: 2 }, "");
    const navigate = vi.fn();

    navigateBackOrLeave(navigate);

    expect(navigate).toHaveBeenCalledWith(-1);
    expect(minimizeApp).not.toHaveBeenCalled();
  });

  it("sends the app to the background from the first route on Android", () => {
    const navigate = vi.fn();

    navigateBackOrLeave(navigate);

    expect(navigate).not.toHaveBeenCalled();
    expect(minimizeApp).toHaveBeenCalledTimes(1);
  });

  it("does nothing from the first route in a browser, where there is no app to background", () => {
    vi.mocked(getPlatform).mockReturnValue("web");
    const navigate = vi.fn();

    navigateBackOrLeave(navigate);

    expect(navigate).not.toHaveBeenCalled();
    expect(minimizeApp).not.toHaveBeenCalled();
  });

  it("logs a warning when the app cannot be sent to the background", async () => {
    minimizeApp.mockRejectedValueOnce(new Error("not implemented"));

    navigateBackOrLeave(vi.fn());
    await flush();

    expect(addLog).toHaveBeenCalledWith("warn", "Failed to send the app to the background on Back", {
      error: "not implemented",
    });
  });

  it("treats a history entry without a router index as the first route", () => {
    window.history.replaceState(null, "");
    const navigate = vi.fn();

    navigateBackOrLeave(navigate);

    expect(navigate).not.toHaveBeenCalled();
    expect(minimizeApp).toHaveBeenCalledTimes(1);
  });

  it("logs a rejection that is not an Error by its text", async () => {
    minimizeApp.mockRejectedValueOnce("plugin missing");

    navigateBackOrLeave(vi.fn());
    await flush();

    expect(addLog).toHaveBeenCalledWith("warn", "Failed to send the app to the background on Back", {
      error: "plugin missing",
    });
  });
});
