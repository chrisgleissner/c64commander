import { describe, expect, it } from "vitest";
import type { HvscPreparationStateInput } from "@/lib/hvsc/hvscPreparationState";
import { describeHvscPreparationTransition, resolveHvscPreparationSnapshot } from "@/lib/hvsc/hvscPreparationState";

const base: HvscPreparationStateInput = {
  available: true,
  installedVersion: 0,
  ingestionState: null,
  activeStage: null,
  downloadStatus: "idle",
  extractionStatus: "idle",
  metadataStatus: "idle",
  hasCachedArchive: false,
  inlineError: null,
};

describe("resolveHvscPreparationSnapshot", () => {
  it("returns NOT_PRESENT with Unavailable label when available is false", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, available: false });
    expect(snap.state).toBe("NOT_PRESENT");
    expect(snap.statusLabel).toBe("Unavailable");
    expect(snap.errorReason).toBeNull();
    expect(snap.phase).toBeNull();
    expect(snap.failedPhase).toBeNull();
  });

  it("returns READY when installedVersion > 0 and ingestionState is ready", () => {
    const snap = resolveHvscPreparationSnapshot({
      ...base,
      installedVersion: 80,
      ingestionState: "ready",
    });
    expect(snap.state).toBe("READY");
    expect(snap.statusLabel).toBe("Ready");
    expect(snap.errorReason).toBeNull();
  });

  it("returns DOWNLOADING when downloadStatus is in-progress", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, downloadStatus: "in-progress" });
    expect(snap.state).toBe("DOWNLOADING");
    expect(snap.phase).toBe("download");
    expect(snap.statusLabel).toBe("Downloading");
  });

  it("returns DOWNLOADING when activeStage is download", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, activeStage: "download" });
    expect(snap.state).toBe("DOWNLOADING");
    expect(snap.phase).toBe("download");
  });

  it("returns INGESTING when extractionStatus is in-progress", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, extractionStatus: "in-progress" });
    expect(snap.state).toBe("INGESTING");
    expect(snap.phase).toBe("ingest");
    expect(snap.statusLabel).toBe("Indexing");
  });

  it("returns INGESTING when metadataStatus is in-progress", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, metadataStatus: "in-progress" });
    expect(snap.state).toBe("INGESTING");
  });

  it("returns INGESTING when ingestionState is installing", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, ingestionState: "installing" });
    expect(snap.state).toBe("INGESTING");
  });

  it("returns INGESTING when ingestionState is updating", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, ingestionState: "updating" });
    expect(snap.state).toBe("INGESTING");
  });

  it("returns INGESTING when activeStage is a known ingestion stage", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, activeStage: "sid_enumeration" });
    expect(snap.state).toBe("INGESTING");
    expect(snap.phase).toBe("ingest");
  });

  it("returns DOWNLOADED when hasCachedArchive is true", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, hasCachedArchive: true });
    expect(snap.state).toBe("DOWNLOADED");
    expect(snap.statusLabel).toBe("Downloaded");
  });

  it("returns DOWNLOADED when downloadStatus is success", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, downloadStatus: "success" });
    expect(snap.state).toBe("DOWNLOADED");
  });

  it("returns NOT_PRESENT with Not installed label when no state applies", () => {
    const snap = resolveHvscPreparationSnapshot(base);
    expect(snap.state).toBe("NOT_PRESENT");
    expect(snap.statusLabel).toBe("Not installed");
  });

  it("returns ERROR with download failedPhase when inlineError is set and downloadStatus failed", () => {
    const snap = resolveHvscPreparationSnapshot({
      ...base,
      inlineError: "disk full",
      downloadStatus: "failure",
    });
    expect(snap.state).toBe("ERROR");
    expect(snap.errorReason).toBe("disk full");
    expect(snap.failedPhase).toBe("download");
    expect(snap.statusLabel).toBe("Download failed");
  });

  it("returns ERROR with ingest failedPhase when extractionStatus failed", () => {
    const snap = resolveHvscPreparationSnapshot({
      ...base,
      inlineError: "corrupt archive",
      extractionStatus: "failure",
    });
    expect(snap.state).toBe("ERROR");
    expect(snap.failedPhase).toBe("ingest");
    expect(snap.statusLabel).toBe("Indexing failed");
  });

  it("returns ERROR and uses extractionErrorMessage as errorReason when present", () => {
    const snap = resolveHvscPreparationSnapshot({
      ...base,
      extractionStatus: "failure",
      extractionErrorMessage: "bad zip",
    });
    expect(snap.state).toBe("ERROR");
    expect(snap.errorReason).toBe("bad zip");
  });

  it("returns ERROR and uses downloadErrorMessage when other errors are absent", () => {
    const snap = resolveHvscPreparationSnapshot({
      ...base,
      downloadStatus: "failure",
      downloadErrorMessage: "timeout",
    });
    expect(snap.state).toBe("ERROR");
    expect(snap.errorReason).toBe("timeout");
  });

  // Covers L107 binary-expr: ingestionState === "error" — right side evaluated (errorReason is null)
  it("returns ERROR when ingestionState is error and errorReason is absent", () => {
    const snap = resolveHvscPreparationSnapshot({ ...base, ingestionState: "error" });
    expect(snap.state).toBe("ERROR");
    expect(snap.errorReason).toBe("HVSC preparation failed");
    expect(snap.failedPhase).toBe("download");
  });

  describe("resolveFailedPhase via ERROR state", () => {
    // Covers L53 if TRUE + binary-expr right side: downloadFailureCategory in the set
    it("resolves failedPhase to download when downloadFailureCategory is network", () => {
      const snap = resolveHvscPreparationSnapshot({
        ...base,
        ingestionState: "error",
        downloadFailureCategory: "network",
      });
      expect(snap.state).toBe("ERROR");
      expect(snap.failedPhase).toBe("download");
      expect(snap.statusLabel).toBe("Download failed");
    });

    // Covers L53 binary-expr right side evaluated for "download" category
    it("resolves failedPhase to download when downloadFailureCategory is download", () => {
      const snap = resolveHvscPreparationSnapshot({
        ...base,
        ingestionState: "error",
        downloadFailureCategory: "download",
      });
      expect(snap.state).toBe("ERROR");
      expect(snap.failedPhase).toBe("download");
    });

    // Covers L59 if TRUE: activeStage === "download" inside resolveFailedPhase
    it("resolves failedPhase to download when activeStage is download inside error state", () => {
      const snap = resolveHvscPreparationSnapshot({
        ...base,
        ingestionState: "error",
        activeStage: "download",
      });
      expect(snap.state).toBe("ERROR");
      expect(snap.failedPhase).toBe("download");
    });

    // Covers L62 if TRUE + binary-expr right side: activeStage in INGESTION_STAGES
    it("resolves failedPhase to ingest when activeStage is a known ingestion stage inside error state", () => {
      const snap = resolveHvscPreparationSnapshot({
        ...base,
        ingestionState: "error",
        activeStage: "database_insertion",
      });
      expect(snap.state).toBe("ERROR");
      expect(snap.failedPhase).toBe("ingest");
      expect(snap.statusLabel).toBe("Indexing failed");
    });

    it("resolves failedPhase to ingest when extractionFailureCategory is set", () => {
      const snap = resolveHvscPreparationSnapshot({
        ...base,
        ingestionState: "error",
        extractionFailureCategory: "corrupt-archive",
      });
      expect(snap.state).toBe("ERROR");
      expect(snap.failedPhase).toBe("ingest");
    });

    it("resolves failedPhase to ingest when hasCachedArchive is true inside error state", () => {
      const snap = resolveHvscPreparationSnapshot({
        ...base,
        ingestionState: "error",
        hasCachedArchive: true,
      });
      expect(snap.state).toBe("ERROR");
      expect(snap.failedPhase).toBe("ingest");
    });
  });
});

describe("describeHvscPreparationTransition", () => {
  it("returns unknown arrow when previous is null", () => {
    const next = resolveHvscPreparationSnapshot({ ...base, installedVersion: 80, ingestionState: "ready" });
    expect(describeHvscPreparationTransition(null, next)).toBe("unknown -> READY");
  });

  it("returns state arrow when both previous and next are known", () => {
    const prev = resolveHvscPreparationSnapshot({ ...base, downloadStatus: "in-progress" });
    const next = resolveHvscPreparationSnapshot({ ...base, installedVersion: 80, ingestionState: "ready" });
    expect(describeHvscPreparationTransition(prev, next)).toBe("DOWNLOADING -> READY");
  });
});
