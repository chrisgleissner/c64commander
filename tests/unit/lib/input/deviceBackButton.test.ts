import { beforeEach, describe, expect, it, vi } from "vitest";

import { installDeviceBackButton } from "@/lib/input/deviceBackButton";
import { isDeviceBackKey } from "@/lib/input/keyEvent";
import { addLog } from "@/lib/logging";

const appListener = vi.hoisted(() => ({
  backButton: null as null | (() => void),
  remove: vi.fn(async () => undefined),
  addListener: vi.fn(),
}));

vi.mock("@capacitor/app", () => ({
  App: { addListener: appListener.addListener },
}));

vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

const addLogMock = vi.mocked(addLog);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("the Android Back key", () => {
  beforeEach(() => {
    appListener.backButton = null;
    appListener.remove.mockClear();
    addLogMock.mockClear();
    appListener.addListener.mockReset();
    appListener.addListener.mockImplementation(async (_event: string, listener: () => void) => {
      appListener.backButton = listener;
      return { remove: appListener.remove };
    });
  });

  it("reaches the page as a key event, which it does not do on its own", async () => {
    const uninstall = installDeviceBackButton(vi.fn());
    await flush();
    const seen: KeyboardEvent[] = [];
    const handler = (event: Event) => seen.push(event as KeyboardEvent);
    document.addEventListener("keydown", handler);

    appListener.backButton?.();

    document.removeEventListener("keydown", handler);
    expect(seen).toHaveLength(1);
    expect(seen[0].key).toBe("Escape");
    // The shape the app recognises it by: no key code, so it matches no keymap binding.
    expect(isDeviceBackKey(seen[0])).toBe(true);
    uninstall();
  });

  it("delivers the key to the focused element, as a real key would be", async () => {
    const uninstall = installDeviceBackButton(vi.fn());
    await flush();
    const field = document.createElement("input");
    document.body.appendChild(field);
    field.focus();
    const targets: EventTarget[] = [];
    const handler = (event: Event) => targets.push(event.target as EventTarget);
    window.addEventListener("keydown", handler, true);

    appListener.backButton?.();

    window.removeEventListener("keydown", handler, true);
    field.remove();
    expect(targets).toEqual([field]);
    uninstall();
  });

  it("falls back to leaving the route when nothing on the page consumed the key", async () => {
    const onUnhandled = vi.fn();
    const uninstall = installDeviceBackButton(onUnhandled);
    await flush();

    appListener.backButton?.();

    expect(onUnhandled).toHaveBeenCalledTimes(1);
    uninstall();
  });

  it("does not leave the route when the page consumed the key, for example to close a dialog", async () => {
    const onUnhandled = vi.fn();
    const uninstall = installDeviceBackButton(onUnhandled);
    await flush();
    const consume = (event: Event) => event.preventDefault();
    document.addEventListener("keydown", consume);

    appListener.backButton?.();

    document.removeEventListener("keydown", consume);
    expect(onUnhandled).not.toHaveBeenCalled();
    uninstall();
  });

  it("registers exactly one listener and removes it again", async () => {
    const uninstall = installDeviceBackButton(vi.fn());
    await flush();

    expect(appListener.addListener).toHaveBeenCalledTimes(1);
    expect(appListener.addListener).toHaveBeenCalledWith("backButton", expect.any(Function));

    uninstall();
    expect(appListener.remove).toHaveBeenCalledTimes(1);
  });

  it("removes a listener that arrives after it was uninstalled", async () => {
    let resolveHandle: ((handle: { remove: () => Promise<void> }) => void) | null = null;
    appListener.addListener.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveHandle = resolve;
        }),
    );

    const uninstall = installDeviceBackButton(vi.fn());
    uninstall();
    resolveHandle?.({ remove: appListener.remove });
    await flush();

    expect(appListener.remove).toHaveBeenCalledTimes(1);
  });

  it("says so when it cannot register, rather than leaving Back silently dead", async () => {
    appListener.addListener.mockRejectedValueOnce(new Error("listener unavailable"));

    installDeviceBackButton(vi.fn());
    await flush();

    expect(addLogMock).toHaveBeenCalledWith(
      "warn",
      "Failed to register the Android Back handler; the Back key will do nothing",
      { error: "listener unavailable" },
    );
  });
});
