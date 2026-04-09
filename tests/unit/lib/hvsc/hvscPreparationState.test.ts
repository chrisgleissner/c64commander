import { describe, expect, it } from "vitest";

import {
  describeHvscPreparationTransition,
  resolveHvscPreparationSnapshot,
  type HvscPreparationStateInput,
} from "@/lib/hvsc/hvscPreparationState";

const createInput = (overrides: Partial<HvscPreparationStateInput> = {}): HvscPreparationStateInput => ({
  available: true,
  installedVersion: 0,
  ingestionState: "idle",
  activeStage: null,
  downloadStatus: "idle",
  extractionStatus: "idle",
  metadataStatus: "idle",
  hasCachedArchive: false,
  inlineError: null,
  downloadErrorMessage: null,
  extractionErrorMessage: null,
  metadataErrorMessage: null,
  ingestionError: null,
  downloadFailureCategory: null,
  extractionFailureCategory: null,
  ...overrides,
});

describe("hvscPreparationState", () => {
  it("returns NOT_PRESENT when the bridge is unavailable", () => {
    expect(resolveHvscPreparationSnapshot(createInput({ available: false }))).toEqual({
      state: "NOT_PRESENT",
      phase: null,
      failedPhase: null,
      statusLabel: "Unavailable",
      errorReason: null,
    });
  });

  it("returns DOWNLOADING while the archive download is active", () => {
    expect(resolveHvscPreparationSnapshot(createInput({ downloadStatus: "in-progress" }))).toEqual(
      expect.objectContaining({
        state: "DOWNLOADING",
        phase: "download",
        failedPhase: null,
        statusLabel: "Downloading",
      }),
    );
  });

  it("returns DOWNLOADED when the archive is cached but the library is not ready", () => {
    expect(resolveHvscPreparationSnapshot(createInput({ hasCachedArchive: true }))).toEqual(
      expect.objectContaining({
        state: "DOWNLOADED",
        phase: null,
        failedPhase: null,
        statusLabel: "Downloaded",
      }),
    );
  });

  it("returns INGESTING while extraction or metadata indexing is active", () => {
    expect(
      resolveHvscPreparationSnapshot(
        createInput({
          metadataStatus: "in-progress",
          activeStage: "sid_metadata_hydration",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        state: "INGESTING",
        phase: "ingest",
        failedPhase: null,
        statusLabel: "Indexing",
      }),
    );
  });

  it("returns READY only after the installed library reports a ready ingestion state", () => {
    expect(
      resolveHvscPreparationSnapshot(
        createInput({
          installedVersion: 85,
          ingestionState: "ready",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        state: "READY",
        phase: null,
        failedPhase: null,
        statusLabel: "Ready",
        errorReason: null,
      }),
    );
  });

  it("marks download failures with the download phase and preserved reason", () => {
    expect(
      resolveHvscPreparationSnapshot(
        createInput({
          inlineError: "socket timeout",
          downloadStatus: "failure",
          downloadFailureCategory: "network",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        state: "ERROR",
        phase: "download",
        failedPhase: "download",
        statusLabel: "Download failed",
        errorReason: "socket timeout",
      }),
    );
  });

  it("marks indexing failures with the ingest phase when a cached archive exists", () => {
    expect(
      resolveHvscPreparationSnapshot(
        createInput({
          ingestionState: "error",
          ingestionError: "metadata parse failed",
          hasCachedArchive: true,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        state: "ERROR",
        phase: "ingest",
        failedPhase: "ingest",
        statusLabel: "Indexing failed",
        errorReason: "metadata parse failed",
      }),
    );
  });

  it("describes transitions using the previous and next states", () => {
    expect(
      describeHvscPreparationTransition(
        null,
        resolveHvscPreparationSnapshot(createInput({ downloadStatus: "in-progress" })),
      ),
    ).toBe("unknown -> DOWNLOADING");

    expect(
      describeHvscPreparationTransition(
        resolveHvscPreparationSnapshot(createInput({ downloadStatus: "in-progress" })),
        resolveHvscPreparationSnapshot(createInput({ installedVersion: 85, ingestionState: "ready" })),
      ),
    ).toBe("DOWNLOADING -> READY");
  });
});
