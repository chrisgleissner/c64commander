import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-toast", () => ({
  toast: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
  addErrorLog: vi.fn(),
  addLog: vi.fn(),
  buildErrorLogDetails: (error: Error, details: Record<string, unknown> = {}) => ({
    ...details,
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    errorName: error.name,
    errorStack: error.stack,
  }),
}));

import { toast } from "@/hooks/use-toast";
import { addErrorLog } from "@/lib/logging";
import { C64API } from "@/lib/c64api";

const ascii = (value: string) => new TextEncoder().encode(value);

const setBE16 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
};

const setBE32 = (bytes: Uint8Array, offset: number, value: number) => {
  bytes[offset] = (value >>> 24) & 0xff;
  bytes[offset + 1] = (value >>> 16) & 0xff;
  bytes[offset + 2] = (value >>> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
};

const createValidCrtFile = () => {
  const bytes = new Uint8Array(80);
  bytes.set(ascii("C64 CARTRIDGE   "), 0);
  setBE32(bytes, 16, 64);
  setBE16(bytes, 20, 0x0100);
  bytes.set(ascii("CHIP"), 64);
  setBE32(bytes, 68, 16);
  return new File([bytes], "Demo.crt", { type: "application/octet-stream" });
};

describe("C64API file validation boundary", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 200, headers: { "content-type": "text/plain" } })),
    );
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.fetch = originalFetch;
  });

  it("blocks invalid cartridge uploads before fetch and reports the rejection", async () => {
    const api = new C64API("http://127.0.0.1");
    const invalidFile = new File([new Uint8Array(64)], "Broken.crt", { type: "application/octet-stream" });

    await expect(api.runCartridgeUpload(invalidFile)).rejects.toMatchObject({
      name: "FileValidationError",
      code: "INVALID_MAGIC",
      filename: "Broken.crt",
    });

    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    expect(addErrorLog).toHaveBeenCalledWith(
      "FILE_VALIDATION_FAILED",
      expect.objectContaining({
        filename: "Broken.crt",
        attemptedOperation: "CRT_RUN_UPLOAD",
        validationCode: "INVALID_MAGIC",
      }),
    );
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Upload blocked",
        description: expect.stringContaining("Broken.crt is structurally invalid"),
      }),
    );
  });

  it("blocks invalid disk uploads before fetch and reports the operation context", async () => {
    const api = new C64API("http://127.0.0.1");
    const invalidDisk = new File([new Uint8Array(1024)], "Broken.d64", { type: "application/octet-stream" });

    await expect(api.mountDriveUpload("a", invalidDisk, "d64", "readwrite")).rejects.toMatchObject({
      name: "FileValidationError",
      code: "INVALID_SIZE",
      filename: "Broken.d64",
    });

    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    expect(addErrorLog).toHaveBeenCalledWith(
      "FILE_VALIDATION_FAILED",
      expect.objectContaining({
        filename: "Broken.d64",
        attemptedOperation: "DRIVE_MOUNT_UPLOAD",
        endpoint: "/v1/drives/a:mount?type=d64&mode=readwrite",
      }),
    );
  });

  it("still allows valid uploads to reach fetch", async () => {
    const api = new C64API("http://127.0.0.1");

    await api.runCartridgeUpload(createValidCrtFile());

    expect(vi.mocked(globalThis.fetch)).toHaveBeenCalledTimes(1);
    expect(addErrorLog).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it("rejects nameless cartridge blobs before validation so filename context is preserved", async () => {
    const api = new C64API("http://127.0.0.1");
    const namelessBlob = new Blob([new Uint8Array(80)], { type: "application/octet-stream" });

    await expect(api.runCartridgeUpload(namelessBlob)).rejects.toThrow(
      "CRT_RUN_UPLOAD requires a File upload or explicit metadata.filename for Blob uploads",
    );

    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
    expect(addErrorLog).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });
});
