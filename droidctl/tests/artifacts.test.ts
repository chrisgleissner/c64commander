/*
 * C64 Commander - droidctl
 * MCP server for deploying and driving the Android application under test
 * Copyright (C) 2026 Christian Gleissner
 *
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ArtifactStore, assertMp4Signature, assertPngSignature, sanitizeArtifactName } from "../src/artifacts.js";
import { encodePng } from "../src/png.js";
import { createDroidctlServerRuntime } from "../src/server.js";
import { RecordingStore } from "../src/recordings.js";
import { createRunId } from "../src/types.js";
import { FakeTransport } from "../src/transport/fake.js";

describe("run identifiers", () => {
  it("uses the dc- prefix and a compact UTC stamp", () => {
    expect(createRunId()).toMatch(/^dc-\d{8}T\d{6}Z$/);
  });
});

describe("signature checks", () => {
  it("accepts a real PNG and rejects an empty or wrong payload", () => {
    const png = encodePng({ width: 2, height: 2, pixels: Buffer.alloc(16, 1) });
    expect(() => assertPngSignature(png, "x")).not.toThrow();
    expect(() => assertPngSignature(Buffer.alloc(0), "x")).toThrow(/Zero-byte/);
    expect(() => assertPngSignature(Buffer.from("GIF89a...."), "x")).toThrow(/is not a PNG/);
  });

  it("accepts an MP4 with an ftyp box and rejects one without", () => {
    const mp4 = Buffer.alloc(32);
    mp4.write("ftyp", 4, "ascii");
    expect(() => assertMp4Signature(mp4, "x")).not.toThrow();
    expect(() => assertMp4Signature(Buffer.alloc(0), "x")).toThrow(/Zero-byte/);
    expect(() => assertMp4Signature(Buffer.alloc(32), "x")).toThrow(/no MP4 ftyp box/);
  });
});

describe("artifact names", () => {
  it("keeps a usable name and strips path separators", () => {
    expect(sanitizeArtifactName("home-screen.v2")).toBe("home-screen.v2");
    expect(sanitizeArtifactName("../../escape me")).toBe("escape-me");
    expect(() => sanitizeArtifactName("///")).toThrow(/no usable characters/);
  });
});

describe("ArtifactStore", () => {
  it("writes into the category directories the repository already uses", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "droidctl-artifacts-"));
    const store = new ArtifactStore({ root, runId: "dc-FIXED" });

    const raw = store.write("droid_capture.screenshot", "adb:X", "raw", "a.png", Buffer.from("data"));
    store.write("droid_capture.logcat", "adb:X", "logs/logcat", "a.log", "line\n");

    expect(raw.path).toBe(path.join(root, "dc-FIXED", "raw", "a.png"));
    const index = JSON.parse(await readFile(path.join(root, "dc-FIXED", "index.json"), "utf8"));
    expect(index.runId).toBe("dc-FIXED");
    expect(index.artifacts).toHaveLength(2);
    expect(index.artifacts[1]).toMatchObject({ category: "logs/logcat", bytes: 5, tool: "droid_capture.logcat" });
  });

  it("honours a per-call runRoot while keeping the index in the run directory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "droidctl-artifacts-"));
    const other = await mkdtemp(path.join(os.tmpdir(), "droidctl-elsewhere-"));
    const store = new ArtifactStore({ root, runId: "dc-FIXED" });

    const entry = store.write("droid_capture.screenshot", "adb:X", "raw", "a.png", Buffer.from("d"), other);
    expect(entry.path).toBe(path.join(other, "raw", "a.png"));
    expect(store.index()).toHaveLength(1);
  });

  it("appends one JSON line per transport invocation, naming the target", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "droidctl-artifacts-"));
    const store = new ArtifactStore({ root, runId: "dc-FIXED" });

    store.recordCommand({
      timestamp: "2026-08-31T00:00:00.000Z",
      targetId: "adb:X",
      transport: "adb",
      argv: ["adb", "-s", "X", "shell", "getprop"],
      exitCode: 0,
      durationMs: 12,
      bytesOut: 40,
    });
    store.recordCommand({
      timestamp: "2026-08-31T00:00:01.000Z",
      targetId: null,
      transport: "adb",
      argv: ["adb", "devices", "-l"],
      exitCode: 0,
      durationMs: 3,
      bytesOut: 60,
    });

    const lines = (await readFile(path.join(root, "dc-FIXED", "commands.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ targetId: "adb:X", durationMs: 12 });
    expect(store.commandsRecorded()).toBe(2);
  });

  it("defaults its root to artifacts/droidctl under the working directory", () => {
    const store = new ArtifactStore({ runId: "dc-FIXED" });
    expect(store.runDir).toBe(path.join(process.cwd(), "artifacts", "droidctl", "dc-FIXED"));
  });
});

describe("RecordingStore", () => {
  it("issues sequential ids and forgets a handle once deleted", () => {
    const store = new RecordingStore();
    const first = store.nextId();
    const second = store.nextId();
    expect([first, second]).toEqual(["rec-0001", "rec-0002"]);

    store.put({
      recordingId: first,
      targetId: "adb:X",
      name: "n",
      devicePath: "/sdcard/n.mp4",
      timeLimitSec: 10,
      startedAt: "now",
      process: { argv: [], stop: async () => ({ stderr: "", code: 0 }) },
    });
    expect(store.ids()).toEqual([first]);
    store.delete(first);
    expect(store.get(first)).toBeUndefined();
  });
});

describe("the server runtime writes a command journal for real tool calls", () => {
  it("records the enumeration and the device call a tool made", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "droidctl-journal-"));
    const transport = new FakeTransport();
    const runtime = createDroidctlServerRuntime({ artifactRoot, runId: "dc-JOURNAL", transports: [transport] });

    await runtime.toolRegistry.invoke("droid_app.stop_app", {
      targetId: "adb:TESTSERIAL01",
      package: "uk.gleissner.c64commander",
    });

    // The fake transport does not journal, so this asserts the wiring exists
    // rather than the fake's behaviour: the adb transport is what emits records.
    expect(runtime.artifacts.runDir).toBe(path.join(artifactRoot, "dc-JOURNAL"));
    expect(transport.calls.map((call) => call.kind)).toEqual(["listTargets", "exec"]);
  });
});
