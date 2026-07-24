/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import { describe, expect, it, vi } from "vitest";
import { AV_SYNC_PRG_FILENAME, avSyncPrgBlob, avSyncPrgBytes, runAvSyncTest } from "@/lib/streams/avSyncPrg";
import type { C64API } from "@/lib/c64api";

describe("avSyncPrg", () => {
  it("decodes to the 415-byte av-sync-auto PRG loading at $0801", () => {
    const bytes = avSyncPrgBytes();
    expect(bytes.length).toBe(415);
    expect(bytes[0]).toBe(0x01); // load address low
    expect(bytes[1]).toBe(0x08); // load address high → $0801
  });

  it("wraps the bytes in an octet-stream Blob", () => {
    const blob = avSyncPrgBlob();
    expect(blob.size).toBe(415);
    expect(blob.type).toBe("application/octet-stream");
  });

  it("uploads and runs it via runPrgUpload with the bundled filename", async () => {
    const runPrgUpload = vi.fn().mockResolvedValue({ errors: [] });
    await runAvSyncTest({ runPrgUpload } as unknown as C64API);
    expect(runPrgUpload).toHaveBeenCalledTimes(1);
    const [blob, meta] = runPrgUpload.mock.calls[0];
    expect((blob as Blob).size).toBe(415);
    expect((meta as { filename: string }).filename).toBe(AV_SYNC_PRG_FILENAME);
  });
});
