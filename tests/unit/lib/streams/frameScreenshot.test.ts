/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const share = vi.hoisted(() => ({ shareFile: vi.fn() }));
vi.mock("@/lib/config/settingsExportShare", () => ({ shareFile: share.shareFile }));

import { canvasToPngBlob, screenshotFilename, shareFrameScreenshot } from "@/lib/streams/frameScreenshot";

const buildCanvas = (width: number, height: number, blob: Blob | null) => {
  const toBlob = vi.fn((callback: BlobCallback) => callback(blob));
  return { canvas: { width, height, toBlob } as unknown as HTMLCanvasElement, toBlob };
};

describe("screenshotFilename", () => {
  it("names the file from the local date and time, padded", () => {
    expect(screenshotFilename(new Date(2026, 0, 5, 3, 4, 9))).toBe("c64-screen-20260105-030409.png");
  });
});

describe("canvasToPngBlob", () => {
  it("encodes as PNG through the canvas, whose own size is the decoded frame's", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const { canvas, toBlob } = buildCanvas(384, 272, png);

    await expect(canvasToPngBlob(canvas)).resolves.toBe(png);

    expect(toBlob).toHaveBeenCalledWith(expect.any(Function), "image/png");
  });

  it("rejects with the frame size when the browser cannot encode it", async () => {
    const { canvas } = buildCanvas(384, 272, null);

    await expect(canvasToPngBlob(canvas)).rejects.toThrow("The 384x272 frame could not be encoded as PNG");
  });
});

describe("shareFrameScreenshot", () => {
  beforeEach(() => share.shareFile.mockReset().mockResolvedValue("shared"));

  it("hands the PNG to the file share with a dated name and reports the outcome", async () => {
    const png = new Blob(["png"], { type: "image/png" });
    const { canvas } = buildCanvas(384, 272, png);

    const result = await shareFrameScreenshot(canvas, new Date(2026, 10, 12, 18, 30, 0));

    expect(share.shareFile).toHaveBeenCalledWith({
      filename: "c64-screen-20261112-183000.png",
      title: "C64 screenshot",
      mimeType: "image/png",
      content: png,
    });
    expect(result).toEqual({ filename: "c64-screen-20261112-183000.png", outcome: "shared" });
  });

  it("does not share anything when encoding fails", async () => {
    const { canvas } = buildCanvas(384, 272, null);

    await expect(shareFrameScreenshot(canvas)).rejects.toThrow("could not be encoded");
    expect(share.shareFile).not.toHaveBeenCalled();
  });
});
