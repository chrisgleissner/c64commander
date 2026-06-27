/*
 * C64 Commander - Configure and control your Commodore 64 Ultimate over your local network
 * Copyright (C) 2026 Christian Gleissner
 *
 * Licensed under the GNU General Public License v3.0 or later.
 * See <https://www.gnu.org/licenses/> for details.
 */

import {
  FTP_CONNECT_TIMEOUT_MS,
  listFtpDirectory,
  listFtpDirectoryRecursive,
  pingFtp,
  readFtpFile,
  writeFtpFile,
} from "@/lib/ftp/ftpClient";
import { FtpClient } from "@/lib/native/ftpClient";
import { withFtpInteraction } from "@/lib/deviceInteraction/deviceInteractionManager";
import { getActiveAction, runWithImplicitAction } from "@/lib/tracing/actionTrace";
import { recordFtpOperation, recordTraceError } from "@/lib/tracing/traceSession";
import { decrementFtpInFlight, incrementFtpInFlight } from "@/lib/diagnostics/diagnosticsActivity";
import { addErrorLog } from "@/lib/logging";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/native/ftpClient", () => ({
  FtpClient: {
    listDirectory: vi.fn(),
    listDirectoryRecursive: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    pingFtp: vi.fn(),
    cancelRead: vi.fn(async () => {}),
    addListener: vi.fn(async () => ({ remove: async () => {} })),
  },
}));
vi.mock("@/lib/deviceInteraction/deviceInteractionManager", () => ({
  withFtpInteraction: vi.fn(async (_ctx, fn) => fn()),
}));
vi.mock("@/lib/tracing/actionTrace", () => ({
  getActiveAction: vi.fn(),
  runWithImplicitAction: vi.fn(async (_name, fn) => fn({ id: "implicit-action" })),
}));
vi.mock("@/lib/tracing/traceSession");
vi.mock("@/lib/diagnostics/diagnosticsActivity");
vi.mock("@/lib/logging");

describe("ftpClient", () => {
  const mockHost = "192.168.1.64";
  const mockListOptions = {
    host: mockHost,
    port: 21,
    user: "root",
    password: "",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("listFtpDirectory", () => {
    it("lists directory successfully", async () => {
      const mockEntries = [{ name: "test.d64", type: 1, size: 1024 }];
      vi.mocked(FtpClient.listDirectory).mockResolvedValue({
        entries: mockEntries,
      } as any);

      const result = await listFtpDirectory({
        ...mockListOptions,
        path: "/some/path",
      });

      expect(result.path).toBe("/some/path");
      expect(result.entries).toEqual(mockEntries);

      expect(incrementFtpInFlight).toHaveBeenCalled();
      expect(decrementFtpInFlight).toHaveBeenCalled();
      expect(recordFtpOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ result: "success" }),
      );
    });

    it("handles list failure", async () => {
      const error = new Error("FTP Error");
      vi.mocked(FtpClient.listDirectory).mockRejectedValue(error);

      await expect(listFtpDirectory({ ...mockListOptions, path: "/" })).rejects.toThrow("FTP Error");

      expect(addErrorLog).toHaveBeenCalled();
      expect(recordTraceError).toHaveBeenCalled();
      expect(decrementFtpInFlight).toHaveBeenCalled();
    });

    it("logs one list failure when the FTP gateway retry still fails", async () => {
      vi.mocked(withFtpInteraction).mockImplementationOnce(async (_ctx, fn) => {
        await expect(fn()).rejects.toThrow("FTP bridge request timed out");
        return await fn();
      });
      vi.mocked(FtpClient.listDirectory).mockRejectedValue(new Error("FTP bridge request timed out"));

      await expect(listFtpDirectory({ ...mockListOptions, path: "/USB2" })).rejects.toThrow(
        "FTP bridge request timed out",
      );

      expect(FtpClient.listDirectory).toHaveBeenCalledTimes(2);
      expect(addErrorLog).toHaveBeenCalledTimes(1);
      expect(recordTraceError).toHaveBeenCalledTimes(1);
    });

    it("uses existing active action if available", async () => {
      const mockAction = { id: "active" };
      vi.mocked(getActiveAction).mockReturnValue(mockAction as any);
      vi.mocked(FtpClient.listDirectory).mockResolvedValue({ entries: [] });

      await listFtpDirectory({ ...mockListOptions });

      expect(runWithImplicitAction).not.toHaveBeenCalled();
      expect(recordFtpOperation).toHaveBeenCalledWith(mockAction, expect.anything());
    });

    it("normalizes an empty path to the FTP root", async () => {
      vi.mocked(FtpClient.listDirectory).mockResolvedValue({ entries: [] });

      await listFtpDirectory({ ...mockListOptions, path: "" });

      expect(FtpClient.listDirectory).toHaveBeenCalledWith(expect.objectContaining({ path: "/" }));
    });

    it("passes the lower LAN connect timeout to the native FTP bridge by default", async () => {
      vi.mocked(FtpClient.listDirectory).mockResolvedValue({ entries: [] });

      await listFtpDirectory({ ...mockListOptions, path: "/" });

      expect(FtpClient.listDirectory).toHaveBeenCalledWith(
        expect.objectContaining({ connectTimeoutMs: FTP_CONNECT_TIMEOUT_MS }),
      );
      expect(FTP_CONNECT_TIMEOUT_MS).toBe(1_500);
    });
  });

  describe("readFtpFile", () => {
    const mockReadOptions = { ...mockListOptions, path: "/test.txt" };

    it("reads file successfully", async () => {
      const mockResponse = { data: "content", sizeBytes: 7 };
      vi.mocked(FtpClient.readFile).mockResolvedValue(mockResponse);

      const result = await readFtpFile(mockReadOptions);

      expect(result).toBe(mockResponse);
      expect(incrementFtpInFlight).toHaveBeenCalled();
      expect(recordFtpOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          operation: "read",
          result: "success",
          requestPayload: expect.objectContaining({ path: "/test.txt" }),
          requestPayloadPreview: expect.objectContaining({ byteCount: expect.any(Number) }),
        }),
      );
    });

    it("decodes base64 payload previews for FTP reads", async () => {
      vi.mocked(FtpClient.readFile).mockResolvedValue({ data: "QQ==", sizeBytes: 1 });

      await readFtpFile(mockReadOptions);

      expect(recordFtpOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          responsePayloadPreview: expect.objectContaining({
            byteCount: 1,
            hex: "41",
            ascii: "A",
          }),
        }),
      );
    });

    it("handles read failure", async () => {
      vi.mocked(FtpClient.readFile).mockRejectedValue(new Error("Read failed"));

      await expect(readFtpFile(mockReadOptions)).rejects.toThrow("Read failed");

      expect(addErrorLog).toHaveBeenCalled();
      expect(recordTraceError).toHaveBeenCalled();
    });

    it("uses an existing active action for FTP reads", async () => {
      const mockAction = { id: "read-active" };
      vi.mocked(getActiveAction).mockReturnValue(mockAction as any);
      vi.mocked(FtpClient.readFile).mockResolvedValue({ data: "QQ==", sizeBytes: 1 });

      await readFtpFile(mockReadOptions);

      expect(runWithImplicitAction).not.toHaveBeenCalled();
      expect(recordFtpOperation).toHaveBeenCalledWith(mockAction, expect.anything());
    });
  });

  describe("readFtpFile progress + cancellation", () => {
    const mockReadOptions = { ...mockListOptions, path: "/Songlengths.md5", totalBytes: 100 };

    it("forwards byte progress from ftpReadProgress events and tears the listener down", async () => {
      let progressCb: ((event: { requestId: string; bytesRead: number; totalBytes: number }) => void) | undefined;
      const remove = vi.fn(async () => {});
      vi.mocked(FtpClient.addListener).mockImplementation(async (_event: any, cb: any) => {
        progressCb = cb;
        return { remove } as any;
      });
      let resolveRead: (value: { data: string; sizeBytes: number }) => void = () => {};
      vi.mocked(FtpClient.readFile).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      );

      const onProgress = vi.fn();
      const promise = readFtpFile({ ...mockReadOptions, onProgress } as any);
      await vi.waitFor(() => expect(FtpClient.readFile).toHaveBeenCalled());

      const readArgs = vi.mocked(FtpClient.readFile).mock.calls[0]?.[0] as any;
      expect(typeof readArgs.requestId).toBe("string");
      expect(readArgs.totalBytes).toBe(100);

      // matching requestId is forwarded; mismatched events are ignored
      progressCb?.({ requestId: readArgs.requestId, bytesRead: 50, totalBytes: 100 });
      progressCb?.({ requestId: "someone-else", bytesRead: 999, totalBytes: 100 });
      expect(onProgress).toHaveBeenCalledTimes(1);
      expect(onProgress).toHaveBeenCalledWith({ bytesRead: 50, totalBytes: 100 });

      resolveRead({ data: "QQ==", sizeBytes: 1 });
      await promise;
      expect(remove).toHaveBeenCalled();
    });

    it("cancels the in-flight native read when the abort signal fires", async () => {
      let resolveRead: (value: { data: string; sizeBytes: number }) => void = () => {};
      vi.mocked(FtpClient.readFile).mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveRead = resolve;
          }),
      );
      const controller = new AbortController();

      const promise = readFtpFile({ ...mockReadOptions, onProgress: vi.fn(), signal: controller.signal } as any);
      await vi.waitFor(() => expect(FtpClient.readFile).toHaveBeenCalled());
      const readArgs = vi.mocked(FtpClient.readFile).mock.calls[0]?.[0] as any;

      controller.abort();
      expect(FtpClient.cancelRead).toHaveBeenCalledWith({ requestId: readArgs.requestId });

      resolveRead({ data: "QQ==", sizeBytes: 1 });
      await promise;
    });

    it("never registers a progress listener for a plain read (no onProgress/signal)", async () => {
      vi.mocked(FtpClient.readFile).mockResolvedValue({ data: "QQ==", sizeBytes: 1 });
      await readFtpFile(mockReadOptions);
      expect(FtpClient.addListener).not.toHaveBeenCalled();
      const readArgs = vi.mocked(FtpClient.readFile).mock.calls[0]?.[0] as any;
      expect(readArgs.requestId).toBeUndefined();
    });
  });

  describe("listFtpDirectoryRecursive", () => {
    const mockEntries = [
      { name: "demo.sid", path: "/HVSC/demo.sid", type: 1, size: 1024 },
      { name: "sub", path: "/HVSC/sub", type: 2 },
    ];

    it("lists recursively and returns entries plus partial failures", async () => {
      // clearAllMocks keeps implementations, so a leaked getActiveAction stub from an
      // earlier test could force the active-action path — pin the implicit path here.
      vi.mocked(getActiveAction).mockReturnValue(undefined as never);
      const partialFailures = [{ path: "/HVSC/locked", message: "permission denied" }];
      vi.mocked(FtpClient.listDirectoryRecursive).mockResolvedValue({
        entries: mockEntries,
        partialFailures,
      } as any);

      const result = await listFtpDirectoryRecursive({ ...mockListOptions, path: "/HVSC", maxDepth: 4 });

      expect(result.path).toBe("/HVSC");
      expect(result.entries).toEqual(mockEntries);
      expect(result.partialFailures).toEqual(partialFailures);
      expect(runWithImplicitAction).toHaveBeenCalledWith("ftp.list-recursive", expect.any(Function));
      expect(recordFtpOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ command: "LIST-RECURSIVE", result: "success" }),
      );
      expect(decrementFtpInFlight).toHaveBeenCalled();
    });

    it("defaults partialFailures to an empty array when the bridge omits them", async () => {
      vi.mocked(FtpClient.listDirectoryRecursive).mockResolvedValue({ entries: [] } as any);

      const result = await listFtpDirectoryRecursive({ ...mockListOptions, path: "" });

      // Empty path normalizes to the FTP root.
      expect(result.path).toBe("/");
      expect(result.partialFailures).toEqual([]);
      expect(FtpClient.listDirectoryRecursive).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/", connectTimeoutMs: FTP_CONNECT_TIMEOUT_MS }),
      );
    });

    it("uses an existing active action when available", async () => {
      const mockAction = { id: "recursive-active" };
      vi.mocked(getActiveAction).mockReturnValue(mockAction as any);
      vi.mocked(FtpClient.listDirectoryRecursive).mockResolvedValue({ entries: [], partialFailures: [] } as any);

      await listFtpDirectoryRecursive({ ...mockListOptions, path: "/" });

      expect(runWithImplicitAction).not.toHaveBeenCalled();
      expect(recordFtpOperation).toHaveBeenCalledWith(mockAction, expect.anything());
    });

    it("logs and rethrows recursive listing failures", async () => {
      vi.mocked(FtpClient.listDirectoryRecursive).mockRejectedValue(new Error("recursive boom"));

      await expect(listFtpDirectoryRecursive({ ...mockListOptions, path: "/HVSC" })).rejects.toThrow("recursive boom");

      expect(addErrorLog).toHaveBeenCalled();
      expect(recordTraceError).toHaveBeenCalled();
      expect(recordFtpOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ command: "LIST-RECURSIVE", result: "failure" }),
      );
      expect(decrementFtpInFlight).toHaveBeenCalled();
    });
  });

  describe("readFtpFile edge branches", () => {
    const mockReadOptions = { ...mockListOptions, path: "/Songlengths.md5", totalBytes: 100 };

    it("cancels immediately when the signal is already aborted before the read starts", async () => {
      vi.mocked(FtpClient.readFile).mockResolvedValue({ data: "QQ==", sizeBytes: 1 });
      const controller = new AbortController();
      controller.abort(); // pre-aborted

      await readFtpFile({ ...mockReadOptions, onProgress: vi.fn(), signal: controller.signal } as any);

      const readArgs = vi.mocked(FtpClient.readFile).mock.calls[0]?.[0] as any;
      expect(FtpClient.cancelRead).toHaveBeenCalledWith({ requestId: readArgs.requestId });
    });

    it("logs when the native cancelRead itself rejects", async () => {
      vi.mocked(FtpClient.cancelRead).mockRejectedValueOnce(new Error("cancel failed"));
      vi.mocked(FtpClient.readFile).mockResolvedValue({ data: "QQ==", sizeBytes: 1 });
      const controller = new AbortController();
      controller.abort();

      await readFtpFile({ ...mockReadOptions, onProgress: vi.fn(), signal: controller.signal } as any);

      // buildErrorLogDetails is automocked → second arg is undefined.
      await vi.waitFor(() => expect(addErrorLog).toHaveBeenCalledWith("FTP cancelRead failed", undefined));
    });

    it("logs when tearing down the progress listener fails", async () => {
      vi.mocked(FtpClient.addListener).mockResolvedValueOnce({
        remove: vi.fn(async () => {
          throw new Error("remove failed");
        }),
      } as any);
      vi.mocked(FtpClient.readFile).mockResolvedValue({ data: "QQ==", sizeBytes: 1 });

      await readFtpFile({ ...mockReadOptions, onProgress: vi.fn() } as any);

      expect(addErrorLog).toHaveBeenCalledWith("FTP progress listener cleanup failed", undefined);
    });
  });

  describe("writeFtpFile", () => {
    const mockWriteOptions = { ...mockListOptions, path: "/Temp/test.reu", data: "QUJDRA==" };

    it("writes file successfully", async () => {
      vi.mocked(FtpClient.writeFile).mockResolvedValue({ sizeBytes: 4 });

      const result = await writeFtpFile(mockWriteOptions);

      expect(result).toEqual({ sizeBytes: 4 });
      expect(recordFtpOperation).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          operation: "write",
          command: "STOR",
          result: "success",
          requestPayloadPreview: expect.objectContaining({ byteCount: 4, ascii: "ABCD" }),
        }),
      );
    });

    it("handles write failure", async () => {
      vi.mocked(FtpClient.writeFile).mockRejectedValue(new Error("Write failed"));

      await expect(writeFtpFile(mockWriteOptions)).rejects.toThrow("Write failed");

      expect(addErrorLog).toHaveBeenCalled();
      expect(recordTraceError).toHaveBeenCalled();
    });

    it("uses an existing active action for FTP writes", async () => {
      const mockAction = { id: "write-active" };
      vi.mocked(getActiveAction).mockReturnValue(mockAction as any);
      vi.mocked(FtpClient.writeFile).mockResolvedValue({ sizeBytes: 4 });

      await writeFtpFile(mockWriteOptions);

      expect(runWithImplicitAction).not.toHaveBeenCalled();
      expect(recordFtpOperation).toHaveBeenCalledWith(mockAction, expect.anything());
    });
  });

  describe("pingFtp", () => {
    const mockPingOptions = {
      host: mockHost,
      port: 21,
      username: "root",
      password: "",
    };

    it("pings FTP through the implicit health action with the default connect timeout", async () => {
      vi.mocked(FtpClient.pingFtp).mockResolvedValue({ ok: true });

      const result = await pingFtp(mockPingOptions);

      expect(result).toEqual({ ok: true });
      expect(runWithImplicitAction).toHaveBeenCalledWith("ftp.ping", expect.any(Function));
      expect(withFtpInteraction).toHaveBeenCalledWith(
        expect.objectContaining({
          operation: "ping",
          path: "/",
          // A bare ping (no explicit __c64uIntent) falls back to the valid "system"
          // probe intent; "health" is not a recognised InteractionIntent.
          intent: "system",
          host: mockHost,
          port: 21,
        }),
        expect.any(Function),
      );
      expect(FtpClient.pingFtp).toHaveBeenCalledWith(
        expect.objectContaining({
          host: mockHost,
          port: 21,
          connectTimeoutMs: FTP_CONNECT_TIMEOUT_MS,
          traceContext: expect.any(Object),
        }),
      );
      expect(incrementFtpInFlight).toHaveBeenCalledTimes(1);
      expect(decrementFtpInFlight).toHaveBeenCalledTimes(1);
    });

    it("logs FTP ping failures and releases in-flight state", async () => {
      vi.mocked(FtpClient.pingFtp).mockRejectedValue(new Error("ping failed"));

      await expect(pingFtp(mockPingOptions)).rejects.toThrow("ping failed");

      expect(addErrorLog).toHaveBeenCalledWith("FTP ping failed", undefined);
      expect(decrementFtpInFlight).toHaveBeenCalledTimes(1);
    });
  });
});
