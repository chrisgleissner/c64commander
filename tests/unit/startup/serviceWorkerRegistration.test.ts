import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  registerServiceWorkerForEnvironment,
  shouldRegisterServiceWorkerForEnvironment,
} from "@/lib/startup/serviceWorkerRegistration";
import { addErrorLog } from "@/lib/logging";

const isNativePlatformMock = vi.fn(() => false);

vi.mock("@/lib/native/platform", () => ({
  isNativePlatform: () => isNativePlatformMock(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
}));

describe("serviceWorkerRegistration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isNativePlatformMock.mockReturnValue(false);
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: {
        serviceWorker: {
          register: vi.fn().mockResolvedValue(undefined),
        },
      },
    });
  });

  it("skips registration on native platforms", () => {
    isNativePlatformMock.mockReturnValue(true);

    expect(shouldRegisterServiceWorkerForEnvironment(false)).toBe(false);
    expect(registerServiceWorkerForEnvironment(false)).toBe(false);
  });

  it("registers on web platforms and logs failures", async () => {
    const registerMock = vi.fn().mockRejectedValue(new Error("registration failed"));
    Object.defineProperty(window, "navigator", {
      configurable: true,
      value: {
        serviceWorker: {
          register: registerMock,
        },
      },
    });

    expect(registerServiceWorkerForEnvironment(false)).toBe(true);

    window.dispatchEvent(new Event("load"));
    await Promise.resolve();

    expect(registerMock).toHaveBeenCalledWith("/sw.js");
    expect(vi.mocked(addErrorLog)).toHaveBeenCalledWith(
      "Service worker registration failed",
      expect.objectContaining({
        error: expect.objectContaining({ message: "registration failed" }),
      }),
    );
  });
});
