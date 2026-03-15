/*
 * C64 Commander - C64 Scope
 * Autonomous testing MCP server for session capture and audio/video verification
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const execFileMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFile: execFileMock,
}));

describe("test-data discovery additional branches", () => {
  let tempRoot = "";
  const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
    execFileMock.mockReset();
    consoleErrorSpy.mockClear();
  });

  it("returns a null hvsc target when the mirror has no hvsc symlink", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-discovery-nohvsc-"));
    const workspaceRoot = path.join(tempRoot, "workspace");
    await mkdir(path.join(workspaceRoot, "test-data", "prg"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "test-data", "prg", "demo.prg"), "prg\n", "utf-8");

    const { discoverLocalMirror } = await import("../src/testDataDiscovery.js");
    const discovery = await discoverLocalMirror(workspaceRoot);

    expect(discovery.mirror.fileCount).toBe(1);
    expect(discovery.mirror.formatCounts["prg"]).toBe(1);
    expect(discovery.hvscTarget).toBeNull();
  });

  it("handles device discovery without local parity and preserves lowercase sid roots", async () => {
    execFileMock
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "sid\nd64\nnotes.txt\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "diskA.d64\nfolder\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "Example.sid\nREADME\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "C64Music\n" });
        },
      );

    const { discoverDeviceMirror } = await import("../src/testDataDiscovery.js");
    const discovery = await discoverDeviceMirror("c64u");

    expect(discovery.sidPath).toBe("/USB2/test-data/sid");
    expect(discovery.sidCandidates).toEqual(["Example.sid"]);
    expect(discovery.multiDiskDirectories).toEqual(["folder"]);
    expect(discovery.approximateFileCount).toBeNull();
    expect(discovery.approximationBasis).toContain("No local parity model was available");
  });

  it("falls back from USB2 to USB1 when the mirrored corpus is mounted on USB1", async () => {
    execFileMock
      .mockImplementationOnce((_file: string, _args: string[], callback: (error: Error) => void) => {
        callback(new Error("USB2 missing"));
      })
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "SID\nd64\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "diskA.d64\nfolder\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "Example.sid\nREADME\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "C64Music\n" });
        },
      );

    const { discoverDeviceMirror } = await import("../src/testDataDiscovery.js");
    const discovery = await discoverDeviceMirror("c64u");

    expect(discovery.rootPath).toBe("/USB1/test-data");
    expect(discovery.sidPath).toBe("/USB1/test-data/SID");
    expect(discovery.sidCandidates).toEqual(["Example.sid"]);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[testDataDiscovery] FTP probe failed for candidate test-data root"),
    );
  });

  it("logs unreadable device roots before continuing the mirrored corpus scan", async () => {
    execFileMock
      .mockImplementationOnce((_file: string, _args: string[], callback: (error: Error) => void) => {
        callback(new Error("USB2 missing"));
      })
      .mockImplementationOnce((_file: string, _args: string[], callback: (error: Error) => void) => {
        callback(new Error("USB1 missing"));
      })
      .mockImplementationOnce((_file: string, _args: string[], callback: (error: Error) => void) => {
        callback(new Error("SD missing"));
      })
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "USB0\nUSB1\n" });
        },
      )
      .mockImplementationOnce((_file: string, _args: string[], callback: (error: Error) => void) => {
        callback(new Error("USB0 unreadable"));
      })
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "test-data\nnotes\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "SID\nd64\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "diskA.d64\nfolder\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "Example.sid\nREADME\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "C64Music\n" });
        },
      );

    const { discoverDeviceMirror } = await import("../src/testDataDiscovery.js");
    const discovery = await discoverDeviceMirror("c64u");

    expect(discovery.rootPath).toBe("/USB1/test-data");
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[testDataDiscovery] FTP probe failed while scanning device roots for mirrored corpus"),
    );
  });

  it("discovers mirrored corpora by composing local and device discovery", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-discovery-compose-"));
    const workspaceRoot = path.join(tempRoot, "workspace");
    const hvscRoot = path.join(tempRoot, "hvsc-root");
    await mkdir(path.join(workspaceRoot, "test-data", "sid"), { recursive: true });
    await mkdir(path.join(hvscRoot, "MUSICIANS", "A"), { recursive: true });
    await writeFile(path.join(hvscRoot, "MUSICIANS", "A", "Artist.sid"), "sid\n", "utf-8");
    await symlink(
      path.relative(path.join(workspaceRoot, "test-data", "sid"), hvscRoot),
      path.join(workspaceRoot, "test-data", "sid", "hvsc"),
    );

    execFileMock
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "SID\nd64\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "double-disk\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "Artist.sid\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "C64Music\n" });
        },
      );

    const { discoverMirroredCorpora } = await import("../src/testDataDiscovery.js");
    const discovery = await discoverMirroredCorpora(workspaceRoot, "c64u");

    expect(discovery.local.hvscTarget?.fileCount).toBe(1);
    expect(discovery.device.sidCandidates).toEqual(["Artist.sid"]);
    expect(discovery.device.approximateFileCount).toBe(1);
  });
});
