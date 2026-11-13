/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { createRef } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AvMirrorImmersive, type AvMirrorImmersiveHandle } from "@/components/streams/AvMirrorImmersive";

const mirror = vi.hoisted(() => ({
  video: { videoLive: true, video: { state: "live" } } as { videoLive: boolean; video: { state: string } },
}));
const share = vi.hoisted(() => ({ shareFile: vi.fn() }));
const toasts = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("@/hooks/useAvMirror", () => ({ useAvMirror: () => mirror.video, useAvMirrorCanvas: vi.fn() }));
vi.mock("@/hooks/useMirrorViewport", () => ({
  useMirrorViewport: () => ({
    viewport: { scale: 2, cx: 0.5, cy: 0.5 },
    lock: { state: "idle", subject: null, confidence: 0 },
    zoomBy: vi.fn(),
    panBy: vi.fn(),
    centerOn: vi.fn(),
    setScale: vi.fn(),
    reset: vi.fn(),
    lockOn: vi.fn(),
    releaseLock: vi.fn(),
  }),
}));
vi.mock("@/components/streams/AvMirrorMinimap", () => ({ AvMirrorMinimap: () => null }));
vi.mock("@/lib/config/settingsExportShare", () => ({ shareFile: share.shareFile }));
vi.mock("@/hooks/use-toast", () => ({ toast: toasts.toast }));
vi.mock("@/lib/logging", () => ({ addLog: vi.fn() }));

const encodedFrom: HTMLCanvasElement[] = [];
const installToBlob = (blob: Blob | null) => {
  encodedFrom.length = 0;
  HTMLCanvasElement.prototype.toBlob = function (this: HTMLCanvasElement, callback: BlobCallback) {
    encodedFrom.push(this);
    callback(blob);
  };
};

describe("AvMirrorImmersive screenshot control", () => {
  beforeEach(() => {
    mirror.video = { videoLive: true, video: { state: "live" } };
    share.shareFile.mockReset().mockResolvedValue("downloaded");
    toasts.toast.mockReset();
    localStorage.clear();
  });

  it("saves the frame at its own size, not the zoomed size it is drawn at, and says it was saved", async () => {
    installToBlob(new Blob(["png"], { type: "image/png" }));
    render(<AvMirrorImmersive />);
    const canvas = screen.getByTestId("av-mirror-immersive-canvas") as HTMLCanvasElement;
    expect(canvas.style.transform).toContain("scale");

    fireEvent.click(screen.getByTestId("av-immersive-screenshot"));

    await waitFor(() => expect(share.shareFile).toHaveBeenCalledTimes(1));
    expect(encodedFrom).toEqual([canvas]);
    expect([canvas.width, canvas.height]).toEqual([384, 272]);
    const shared = share.shareFile.mock.calls[0][0];
    expect(shared.mimeType).toBe("image/png");
    expect(shared.filename).toMatch(/^c64-screen-\d{8}-\d{6}\.png$/);
    await waitFor(() =>
      expect(toasts.toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Screenshot saved" })),
    );
  });

  it("says nothing extra when the phone's share sheet took the file", async () => {
    installToBlob(new Blob(["png"], { type: "image/png" }));
    share.shareFile.mockResolvedValue("shared");
    render(<AvMirrorImmersive />);

    fireEvent.click(screen.getByTestId("av-immersive-screenshot"));

    await waitFor(() => expect(share.shareFile).toHaveBeenCalledTimes(1));
    expect(toasts.toast).not.toHaveBeenCalled();
  });

  it("reports a frame that could not be encoded instead of failing silently", async () => {
    installToBlob(null);
    render(<AvMirrorImmersive />);

    fireEvent.click(screen.getByTestId("av-immersive-screenshot"));

    await waitFor(() =>
      expect(toasts.toast).toHaveBeenCalledWith({ title: "Could not save the screenshot", variant: "destructive" }),
    );
    expect(share.shareFile).not.toHaveBeenCalled();
  });

  it("is a named control the size of the others, offered only while the picture is live", () => {
    render(<AvMirrorImmersive />);
    const button = screen.getByRole("button", { name: "Save screenshot" });
    expect(button.className).toContain("h-11 w-11");
  });

  it("offers no screenshot while there is no live picture", () => {
    mirror.video = { videoLive: false, video: { state: "off" } };
    render(<AvMirrorImmersive />);

    expect(screen.queryByTestId("av-immersive-screenshot")).not.toBeInTheDocument();
  });

  it("saves through the handle too, which is how the keypad menu reaches it", async () => {
    installToBlob(new Blob(["png"], { type: "image/png" }));
    const handle = createRef<AvMirrorImmersiveHandle>();
    render(<AvMirrorImmersive ref={handle} />);

    act(() => handle.current?.saveScreenshot());

    await waitFor(() => expect(share.shareFile).toHaveBeenCalledTimes(1));
    expect(share.shareFile.mock.calls[0][0].mimeType).toBe("image/png");
  });
});
