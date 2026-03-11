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

describe("test-data discovery", () => {
  let tempRoot = "";

  afterEach(async () => {
    if (tempRoot) {
      await rm(tempRoot, { recursive: true, force: true });
      tempRoot = "";
    }
    execFileMock.mockReset();
  });

  it("discovers the local mirror and the resolved HVSC target without following symlink loops", async () => {
    tempRoot = await mkdtemp(path.join(os.tmpdir(), "c64scope-discovery-"));
    const workspaceRoot = path.join(tempRoot, "workspace");
    const externalSidRoot = path.join(tempRoot, "sid", "hvsc");
    await mkdir(path.join(workspaceRoot, "test-data", "d64"), { recursive: true });
    await mkdir(path.join(workspaceRoot, "test-data", "sid"), { recursive: true });
    await mkdir(path.join(externalSidRoot, "C64Music", "GAMES"), { recursive: true });
    await writeFile(path.join(workspaceRoot, "test-data", "d64", "Disk 1.d64"), "disk\n", "utf-8");
    await writeFile(path.join(externalSidRoot, "C64Music", "GAMES", "Tune.sid"), "sid\n", "utf-8");
    await symlink(
      path.relative(path.join(workspaceRoot, "test-data", "sid"), externalSidRoot),
      path.join(workspaceRoot, "test-data", "sid", "hvsc"),
    );
    await symlink("../hvsc", path.join(externalSidRoot, "hvsc"));

    const { discoverLocalMirror } = await import("../src/testDataDiscovery.js");
    const discovery = await discoverLocalMirror(workspaceRoot);

    expect(discovery.mirror.fileCount).toBe(1);
    expect(discovery.mirror.symlinkCount).toBe(1);
    expect(discovery.mirror.topLevelEntries).toContain("sid");
    expect(discovery.hvscTarget?.fileCount).toBe(1);
    expect(discovery.hvscTarget?.symlinkCount).toBe(1);
    expect(discovery.hvscTarget?.symlinks[0]?.loopDetected).toBe(true);
    expect(discovery.hvscTarget?.formatCounts["sid"]).toBe(1);
  });

  it("discovers the device mirror and derives approximate counts from local parity", async () => {
    execFileMock
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "crt\nd64\nd71\nd81\nmod\nprg\nSID\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "last-ninja\nturrican2\nDisk 1.d64\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "10_Orbyte.sid\n12th_Sector_Music.sid\nHVSC\n" });
        },
      )
      .mockImplementationOnce(
        (_file: string, _args: string[], callback: (error: null, result: { stdout: string }) => void) => {
          callback(null, { stdout: "C64Music\n" });
        },
      );

    const { discoverDeviceMirror } = await import("../src/testDataDiscovery.js");
    const discovery = await discoverDeviceMirror("c64u", {
      mirror: {
        rootPath: "/tmp/test-data",
        resolvedRootPath: "/tmp/test-data",
        fileCount: 19,
        directoryCount: 12,
        symlinkCount: 1,
        maxDepth: 4,
        formatCounts: { d64: 9 },
        topLevelEntries: ["crt", "d64", "d71", "d81", "mod", "prg", "sid"],
        sampleFiles: [],
        sampleDirectories: [],
        symlinks: [],
      },
      hvscTarget: {
        rootPath: "/tmp/sid/hvsc",
        resolvedRootPath: "/tmp/sid/hvsc",
        fileCount: 60740,
        directoryCount: 1984,
        symlinkCount: 1,
        maxDepth: 6,
        formatCounts: { sid: 60572 },
        topLevelEntries: ["C64Music", "hvsc"],
        sampleFiles: [],
        sampleDirectories: [],
        symlinks: [],
      },
    });

    expect(discovery.sidPath).toBe("/USB2/test-data/SID");
    expect(discovery.sidCandidates).toEqual(["10_Orbyte.sid", "12th_Sector_Music.sid"]);
    expect(discovery.multiDiskDirectories).toEqual(["last-ninja", "turrican2"]);
    expect(discovery.approximateFileCount).toBe(60759);
    expect(discovery.approximateDirectoryCount).toBe(1996);
  });
});
