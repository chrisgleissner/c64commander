/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { shareFile } from "@/lib/config/settingsExportShare";

const pad = (value: number) => String(value).padStart(2, "0");

export const screenshotFilename = (now: Date) =>
  `c64-screen-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.png`;

/** Encodes the canvas at its own pixel size, which is the decoded frame's, not the size it is drawn at. */
export const canvasToPngBlob = (canvas: HTMLCanvasElement): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error(`The ${canvas.width}x${canvas.height} frame could not be encoded as PNG`));
    }, "image/png");
  });

/** Saves the frame on the canvas as a PNG: a download in a browser, the share sheet on a phone. */
export const shareFrameScreenshot = async (canvas: HTMLCanvasElement, now = new Date()) => {
  const filename = screenshotFilename(now);
  const outcome = await shareFile({
    filename,
    title: "C64 screenshot",
    mimeType: "image/png",
    content: await canvasToPngBlob(canvas),
  });
  return { filename, outcome };
};
