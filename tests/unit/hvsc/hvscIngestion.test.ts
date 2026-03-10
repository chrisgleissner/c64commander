import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestHvscMock = vi.fn();
const cancelIngestionMock = vi.fn();
const getIngestionStatsMock = vi.fn();
const readArchiveChunkMock = vi.fn();
const addListenerMock = vi.fn();
const getActiveActionMock = vi.fn(() => ({ id: "action-1" }));
const resolveNativeTraceContextMock = vi.fn(() => ({ correlationId: "corr-1" }));

const loadModule = async () => {
  vi.resetModules();
  vi.doMock("@capacitor/core", () => ({
    registerPlugin: vi.fn(() => ({
      ingestHvsc: ingestHvscMock,
      cancelIngestion: cancelIngestionMock,
      getIngestionStats: getIngestionStatsMock,
      readArchiveChunk: readArchiveChunkMock,
      addListener: addListenerMock,
    })),
  }));
  vi.doMock("@/lib/tracing/actionTrace", () => ({
    getActiveAction: getActiveActionMock,
  }));
  vi.doMock("@/lib/native/nativeTraceContext", () => ({
    resolveNativeTraceContext: resolveNativeTraceContextMock,
  }));
  return import("@/lib/native/hvscIngestion");
};

describe("HvscIngestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getActiveActionMock.mockReturnValue({ id: "action-1" });
    resolveNativeTraceContextMock.mockReturnValue({ correlationId: "corr-1" });
  });

  it("forwards ingest requests with resolved trace context", async () => {
    const { HvscIngestion } = await loadModule();
    ingestHvscMock.mockResolvedValue({ totalEntries: 10 });

    await HvscIngestion.ingestHvsc({
      relativeArchivePath: "hvsc/cache/HVSC.7z",
      mode: "baseline",
      resetLibrary: true,
      dbBatchSize: 250,
    });

    expect(resolveNativeTraceContextMock).toHaveBeenCalledWith({ id: "action-1" });
    expect(ingestHvscMock).toHaveBeenCalledWith({
      relativeArchivePath: "hvsc/cache/HVSC.7z",
      mode: "baseline",
      resetLibrary: true,
      dbBatchSize: 250,
      traceContext: { correlationId: "corr-1" },
    });
  });

  it("forwards cancel and stats requests with resolved trace context", async () => {
    const { HvscIngestion } = await loadModule();
    cancelIngestionMock.mockResolvedValue(undefined);
    getIngestionStatsMock.mockResolvedValue({ metadataRows: 42 });

    await HvscIngestion.cancelIngestion();
    await HvscIngestion.getIngestionStats();

    expect(cancelIngestionMock).toHaveBeenCalledWith({ traceContext: { correlationId: "corr-1" } });
    expect(getIngestionStatsMock).toHaveBeenCalledWith({ traceContext: { correlationId: "corr-1" } });
  });

  it("forwards archive chunk reads and progress listeners", async () => {
    const { HvscIngestion } = await loadModule();
    const listener = vi.fn();
    const remove = vi.fn(async () => undefined);
    readArchiveChunkMock.mockResolvedValue({ data: "abc", sizeBytes: 3, eof: true });
    addListenerMock.mockResolvedValue({ remove });

    const chunk = await HvscIngestion.readArchiveChunk({
      relativeArchivePath: "hvsc/cache/HVSC.7z",
      offsetBytes: 1024,
      lengthBytes: 2048,
    });
    const subscription = await HvscIngestion.addProgressListener(listener);

    expect(readArchiveChunkMock).toHaveBeenCalledWith({
      relativeArchivePath: "hvsc/cache/HVSC.7z",
      offsetBytes: 1024,
      lengthBytes: 2048,
      traceContext: { correlationId: "corr-1" },
    });
    expect(addListenerMock).toHaveBeenCalledWith("hvscProgress", listener);
    expect(chunk).toEqual({ data: "abc", sizeBytes: 3, eof: true });
    await subscription.remove();
    expect(remove).toHaveBeenCalledTimes(1);
  });
});
