/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isNative: true,
  share: vi.fn(),
  toast: vi.fn(),
  addLog: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({ Capacitor: { isNativePlatform: () => mocks.isNative } }));
vi.mock("@capacitor/share", () => ({ Share: { share: mocks.share } }));
vi.mock("@capacitor/filesystem", () => ({ Directory: {}, Encoding: {}, Filesystem: {} }));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/logging", () => ({
  addLog: mocks.addLog,
  addErrorLog: (m: string, d?: unknown) => mocks.addLog("error", m, d),
}));

import { shareTune } from "@/lib/playback/shareTune";

const PAYLOAD = {
  title: "Commando",
  text: "Commando by Rob Hubbard (1985)\nTune 3 of 19",
  url: "https://deepsid.chordian.net/?file=/MUSICIANS/H/Hubbard_Rob/Commando.sid&subtune=3",
  path: "/MUSICIANS/H/Hubbard_Rob/Commando.sid",
};

const setNavigator = (value: Partial<Navigator>) => {
  for (const [key, member] of Object.entries(value)) {
    Object.defineProperty(navigator, key, { value: member, configurable: true });
  }
};

describe("shareTune", () => {
  beforeEach(() => {
    mocks.isNative = true;
    mocks.share.mockReset().mockResolvedValue(undefined);
    mocks.toast.mockReset();
    mocks.addLog.mockReset();
    setNavigator({ share: undefined, clipboard: undefined } as unknown as Partial<Navigator>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the system share sheet on a phone with the title, text, link and dialog title", async () => {
    await expect(shareTune(PAYLOAD)).resolves.toBe("shared");
    expect(mocks.share).toHaveBeenCalledTimes(1);
    expect(mocks.share).toHaveBeenCalledWith({
      title: PAYLOAD.title,
      text: PAYLOAD.text,
      url: PAYLOAD.url,
      dialogTitle: "Share tune",
    });
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("uses the browser's share sheet when there is one", async () => {
    mocks.isNative = false;
    const webShare = vi.fn().mockResolvedValue(undefined);
    setNavigator({ share: webShare });

    await expect(shareTune(PAYLOAD)).resolves.toBe("shared");
    expect(webShare).toHaveBeenCalledWith({ title: PAYLOAD.title, text: PAYLOAD.text, url: PAYLOAD.url });
    expect(mocks.share).not.toHaveBeenCalled();
  });

  it("copies the text and the link to the clipboard when the browser cannot share, and says so", async () => {
    mocks.isNative = false;
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator({ clipboard: { writeText } as unknown as Clipboard });

    await expect(shareTune(PAYLOAD)).resolves.toBe("copied");
    expect(writeText).toHaveBeenCalledWith(`${PAYLOAD.text}\n${PAYLOAD.url}`);
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Link copied" }));
  });

  it("reports a browser with neither share nor clipboard as a failure with the tune path", async () => {
    mocks.isNative = false;

    await expect(shareTune(PAYLOAD)).resolves.toBe("failed");
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not share this tune", variant: "destructive" }),
    );
    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      expect.any(String),
      expect.objectContaining({ path: PAYLOAD.path }),
    );
  });

  it.each([["Share canceled"], ["Share cancelled"]])(
    "logs a dismissed share sheet (%s) at info and shows no toast",
    async (message) => {
      mocks.share.mockRejectedValue(new Error(message));

      await expect(shareTune(PAYLOAD)).resolves.toBe("cancelled");
      expect(mocks.addLog).toHaveBeenCalledTimes(1);
      expect(mocks.addLog).toHaveBeenCalledWith(
        "info",
        expect.any(String),
        expect.objectContaining({ path: PAYLOAD.path }),
      );
      expect(mocks.toast).not.toHaveBeenCalled();
    },
  );

  it("treats the browser's AbortError, which is how a closed share dialog is reported, as a dismissal", async () => {
    mocks.isNative = false;
    const abort = new DOMException("Abort due to cancellation of share.", "AbortError");
    setNavigator({ share: vi.fn().mockRejectedValue(abort) });

    await expect(shareTune(PAYLOAD)).resolves.toBe("cancelled");
    expect(mocks.addLog).toHaveBeenCalledWith(
      "info",
      expect.any(String),
      expect.objectContaining({ path: PAYLOAD.path }),
    );
    expect(mocks.toast).not.toHaveBeenCalled();
  });

  it("logs any other share error at error level with the tune path and stack, and shows a toast", async () => {
    const failure = new Error("No activity found to handle Intent");
    mocks.share.mockRejectedValue(failure);

    await expect(shareTune(PAYLOAD)).resolves.toBe("failed");
    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      expect.any(String),
      expect.objectContaining({
        path: PAYLOAD.path,
        error: "No activity found to handle Intent",
        stack: failure.stack,
      }),
    );
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Could not share this tune", variant: "destructive" }),
    );
  });

  it("reports a clipboard that refuses the write", async () => {
    mocks.isNative = false;
    const writeText = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    setNavigator({ clipboard: { writeText } as unknown as Clipboard });

    await expect(shareTune(PAYLOAD)).resolves.toBe("failed");
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not share this tune" }));
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.objectContaining({ title: "Link copied" }));
    expect(mocks.addLog).toHaveBeenCalledWith(
      "error",
      expect.any(String),
      expect.objectContaining({ path: PAYLOAD.path }),
    );
  });

  it("never contacts a server", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await shareTune(PAYLOAD);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
